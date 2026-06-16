const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 18000);
const MAX_PROXY_REDIRECTS = 5;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) return true;
  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));

  const firstSegment = parseInt(normalized.split(":")[0] || "0", 16);
  return (
    normalized === "::" ||
    (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) ||
    (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) ||
    (firstSegment >= 0xff00 && firstSegment <= 0xffff)
  );
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicTarget(target) {
  const hostname = target.hostname.replace(/\.$/, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost URLs are not supported.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Private network URLs are not supported.");
    }
    return;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error("Could not resolve that URL.");
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Private network URLs are not supported.");
  }
}

function normalizeTarget(input) {
  const target = new URL(input);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  return target;
}

function stripMetaCsp(html) {
  return html.replace(
    /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi,
    ""
  );
}

function injectPreviewBridge(html, targetUrl) {
  const escapedUrl = JSON.stringify(targetUrl);
  const bridge = `
<base href=${escapedUrl}>
<script>
(() => {
  const TARGET_URL = ${escapedUrl};
  let lastScrollSent = 0;
  let scrollLock = false;

  function send(message) {
    try {
      window.parent.postMessage({ source: "viewframe", ...message }, "*");
    } catch (error) {}
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, TARGET_URL).href;
    } catch (error) {
      return null;
    }
  }

  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest && event.target.closest("a[href]");
    if (!anchor) return;
    const href = absoluteUrl(anchor.getAttribute("href"));
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (anchor.target && anchor.target !== "_self") return;
    event.preventDefault();
    send({ type: "navigate", href });
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form || !form.action) return;
    const href = absoluteUrl(form.action);
    if (!href) return;
    event.preventDefault();
    send({ type: "navigate", href });
  }, true);

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source !== "viewframe-parent" || data.type !== "setScroll") return;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scrollLock = true;
    window.scrollTo({ top: maxScroll * Math.max(0, Math.min(1, data.percent)), behavior: "instant" });
    window.setTimeout(() => {
      scrollLock = false;
    }, 80);
  });

  window.addEventListener("scroll", () => {
    if (scrollLock) return;
    const now = Date.now();
    if (now - lastScrollSent < 80) return;
    lastScrollSent = now;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    send({ type: "scroll", percent: window.scrollY / maxScroll });
  }, { passive: true });

  window.addEventListener("load", () => {
    send({ type: "loaded", href: location.href });
  });
})();
</script>`;

  const cleaned = stripMetaCsp(html);
  if (/<head[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
  }
  if (/<html[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<html([^>]*)>/i, `<html$1><head>${bridge}</head>`);
  }
  return `<!doctype html><html><head>${bridge}</head><body>${cleaned}</body></html>`;
}

async function fetchPublicTarget(target, options, redirects = 0) {
  await assertPublicTarget(target);

  const response = await fetch(target.href, {
    ...options,
    redirect: "manual"
  });

  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_PROXY_REDIRECTS) {
      throw new Error("Too many redirects.");
    }
    const redirectedTarget = normalizeTarget(new URL(location, target.href).href);
    return fetchPublicTarget(redirectedTarget, options, redirects + 1);
  }

  return {
    response,
    finalUrl: target.href
  };
}

async function handleProxy(req, res, requestUrl) {
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    send(res, 405, "Method not allowed.", {
      "Allow": "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8"
    });
    return;
  }

  const rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) {
    send(res, 400, "Missing url parameter.", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  let target;
  try {
    target = normalizeTarget(rawTarget);
  } catch (error) {
    send(res, 400, error.message, { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const { response: upstream, finalUrl } = await fetchPublicTarget(target, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
      }
    });

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (contentType.includes("text/html")) {
      const html = await upstream.text();
      const body = injectPreviewBridge(html, finalUrl);
      send(res, upstream.status, body, {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer-when-downgrade"
      });
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    send(res, upstream.status, buffer, {
      "Content-Type": contentType
    });
  } catch (error) {
    const message = error.name === "AbortError" ? "Preview request timed out." : error.message;
    send(
      res,
      502,
      `<!doctype html><html><head><style>
        body{font-family:Inter,system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f8fafc;color:#1f2937}
        main{max-width:520px;padding:28px;text-align:center}
        h1{font-size:18px;margin:0 0 10px}
        p{font-size:14px;line-height:1.5;margin:0;color:#64748b}
        code{display:block;margin-top:14px;word-break:break-all;color:#0f766e}
      </style></head><body><main><h1>Preview unavailable</h1><p>${escapeHtml(message)}</p><code>${escapeHtml(target.href)}</code></main></body></html>`,
      { "Content-Type": "text/html; charset=utf-8" }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function handleStatic(req, res, requestUrl) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(ROOT, pathname));
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    send(res, 200, data, { "Content-Type": type });
  });
}

function requestUrlFor(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  return new URL(req.url || "/", `${protocol}://${req.headers.host || "localhost"}`);
}

function handleVercelProxy(req, res) {
  return handleProxy(req, res, requestUrlFor(req));
}

function createServer() {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/proxy") {
      handleProxy(req, res, requestUrl);
      return;
    }
    handleStatic(req, res, requestUrl);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Viewframe running at http://localhost:${PORT}`);
  });
}

module.exports = {
  createServer,
  handleProxy,
  handleVercelProxy,
  injectPreviewBridge,
  normalizeTarget
};
