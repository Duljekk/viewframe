const presets = [
  {
    category: "Tablets",
    items: [
      { name: "iPad Mini", width: 744, height: 1133, kind: "tablet" },
      { name: "iPad Air", width: 834, height: 1194, kind: "tablet" },
      { name: "iPad Pro", width: 1024, height: 1366, kind: "tablet" },
      { name: "Surface Pro", width: 912, height: 1368, kind: "tablet" }
    ]
  },
  {
    category: "Laptops",
    items: [
      { name: "MacBook Air", width: 1440, height: 900, kind: "laptop" },
      { name: "MacBook Pro", width: 1512, height: 982, kind: "laptop" },
      { name: "Surface Laptop", width: 1536, height: 1024, kind: "laptop" }
    ]
  },
  {
    category: "Desktops",
    items: [
      { name: "Small Desktop", width: 1280, height: 720, kind: "desktop" },
      { name: "Desktop HD", width: 1366, height: 768, kind: "desktop" },
      { name: "Desktop Full HD", width: 1920, height: 1080, kind: "desktop" }
    ]
  }
];

const state = {
  url: "https://example.com",
  devices: [],
  selectedIds: new Set(),
  visibleIds: new Set(),
  pan: { x: 380, y: 170 },
  zoom: 0.72,
  scaling: "fit",
  navSync: true,
  scrollSync: false,
  suppressScroll: false,
  fullscreenId: null,
  nextGroup: 1
};

const nodes = {
  stage: document.getElementById("canvasStage"),
  grid: document.getElementById("canvasGrid"),
  world: document.getElementById("canvasWorld"),
  library: document.getElementById("deviceLibrary"),
  inspector: document.getElementById("inspector"),
  urlForm: document.getElementById("urlForm"),
  urlInput: document.getElementById("urlInput"),
  zoomOut: document.getElementById("zoomOut"),
  zoomIn: document.getElementById("zoomIn"),
  zoomReset: document.getElementById("zoomReset"),
  fitBoard: document.getElementById("fitBoard"),
  fitScaleButton: document.getElementById("fitScaleButton"),
  actualScaleButton: document.getElementById("actualScaleButton"),
  navSync: document.getElementById("navSync"),
  scrollSync: document.getElementById("scrollSync"),
  exportBoard: document.getElementById("exportBoard"),
  exportSelected: document.getElementById("exportSelected"),
  clearBoard: document.getElementById("clearBoard"),
  customDeviceForm: document.getElementById("customDeviceForm"),
  customName: document.getElementById("customName"),
  customWidth: document.getElementById("customWidth"),
  customHeight: document.getElementById("customHeight"),
  customKind: document.getElementById("customKind"),
  groupSelection: document.getElementById("groupSelection"),
  ungroupSelection: document.getElementById("ungroupSelection"),
  selectionCount: document.getElementById("selectionCount"),
  frameCount: document.getElementById("frameCount"),
  currentUrl: document.getElementById("currentUrl"),
  currentMode: document.getElementById("currentMode"),
  toast: document.getElementById("toast")
};

const frameRefs = new Map();
const previewKeys = new Map();
let dragging = null;
let panning = null;
let toastTimer = null;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `vf-${Date.now()}-${Math.random()}`;
}

function safeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch (error) {
    return null;
  }
}

function deviceDims(device) {
  if (device.orientation === "landscape") {
    return {
      width: Math.max(device.baseWidth, device.baseHeight),
      height: Math.min(device.baseWidth, device.baseHeight)
    };
  }
  return {
    width: Math.min(device.baseWidth, device.baseHeight),
    height: Math.max(device.baseWidth, device.baseHeight)
  };
}

function displayScaleFor(device) {
  if (state.scaling === "actual") return 1;
  const { width, height } = deviceDims(device);
  const maxWidth = device.kind === "desktop" ? 560 : device.kind === "laptop" ? 500 : 320;
  const maxHeight = device.kind === "desktop" ? 340 : device.kind === "laptop" ? 340 : 430;
  return Math.min(1, maxWidth / width, maxHeight / height);
}

function estimateOuterSize(device) {
  const dims = deviceDims(device);
  const scale = displayScaleFor(device);
  const padding = device.mockup === "realistic" ? (device.kind === "tablet" ? 56 : 32) : 20;
  return {
    width: dims.width * scale + padding,
    height: dims.height * scale + padding + 36
  };
}

function proxyUrl(url) {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

function previewKeyFor(device) {
  const dims = deviceDims(device);
  return `${state.url}|${dims.width}x${dims.height}|${device.reloadKey}`;
}

function isDeviceLive(device) {
  if (state.fullscreenId) return false;
  return state.selectedIds.size === 1 && state.selectedIds.has(device.id) && state.visibleIds.has(device.id);
}

function isDeviceInViewport(device) {
  const size = estimateOuterSize(device);
  const left = state.pan.x + device.x * state.zoom;
  const top = state.pan.y + (device.y - 44) * state.zoom;
  const right = left + size.width * state.zoom;
  const bottom = top + size.height * state.zoom;
  const rect = nodes.stage.getBoundingClientRect();
  const margin = 220;

  return (
    right >= -margin &&
    bottom >= -margin &&
    left <= rect.width + margin &&
    top <= rect.height + margin
  );
}

function updateVisibleIds() {
  state.visibleIds = new Set(
    state.devices
      .filter((device) => isDeviceInViewport(device))
      .map((device) => device.id)
  );
}

function createDevice(preset, position = {}) {
  return {
    id: uid(),
    name: preset.name,
    kind: preset.kind,
    baseWidth: preset.width,
    baseHeight: preset.height,
    orientation: preset.width > preset.height ? "landscape" : "portrait",
    mockup: "realistic",
    x: position.x ?? 160,
    y: position.y ?? 120,
    groupId: null,
    reloadKey: 0
  };
}

function seedBoard() {
  state.devices = [
    createDevice({ name: "iPad Air", width: 834, height: 1194, kind: "tablet" }, { x: 80, y: 120 }),
    createDevice({ name: "iPad Air", width: 834, height: 1194, kind: "tablet" }, { x: 500, y: 120 }),
    createDevice({ name: "Small Desktop", width: 1280, height: 720, kind: "desktop" }, { x: 940, y: 120 })
  ];
  state.devices[1].orientation = "landscape";
  state.selectedIds = new Set([state.devices[0].id]);
}

function renderLibrary() {
  nodes.library.innerHTML = "";
  presets.forEach((group) => {
    const groupEl = document.createElement("div");
    const title = document.createElement("h3");
    const options = document.createElement("div");
    title.className = "device-group-title";
    title.textContent = group.category;
    options.className = "device-options";

    group.items.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "device-option";
      button.innerHTML = `
        <span><strong>${preset.name}</strong><span>${preset.width} x ${preset.height}</span></span>
        <span class="device-chip">${preset.kind}</span>
      `;
      button.addEventListener("click", () => {
        addDeviceToBoard(preset);
      });
      options.appendChild(button);
    });

    groupEl.append(title, options);
    nodes.library.appendChild(groupEl);
  });
}

function addDeviceToBoard(preset) {
  const index = state.devices.length;
  const device = createDevice(preset, {
    x: 120 + (index % 3) * 420,
    y: 120 + Math.floor(index / 3) * 520
  });
  state.devices.push(device);
  state.selectedIds = new Set([device.id]);
  render();
  toast(`${device.name} added`);
}

function applyTransforms() {
  const transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  nodes.world.style.transform = transform;
  nodes.grid.style.transform = transform;
  nodes.grid.style.backgroundPosition = `${state.pan.x}px ${state.pan.y}px`;
  nodes.grid.style.backgroundSize = `${32 * state.zoom}px ${32 * state.zoom}px`;
  nodes.zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
}

function refreshVisiblePreviews() {
  updateVisibleIds();
  state.devices.forEach((device) => {
    const el = nodes.world.querySelector(`[data-id="${device.id}"]`);
    if (el) updateDeviceElement(el, device);
  });
}

function render() {
  updateVisibleIds();

  const activeIds = new Set(state.devices.map((device) => device.id));
  nodes.world.querySelectorAll(".board-device").forEach((el) => {
    if (!activeIds.has(el.dataset.id)) {
      frameRefs.delete(el.dataset.id);
      previewKeys.delete(el.dataset.id);
      el.remove();
    }
  });

  state.devices.forEach((device) => {
    let el = nodes.world.querySelector(`[data-id="${device.id}"]`);
    if (!el) {
      el = createDeviceElement(device);
      nodes.world.appendChild(el);
    }
    updateDeviceElement(el, device);
  });

  renderInspector();
  renderStats();
  renderFullscreen();
  applyTransforms();
}

function createDeviceElement(device) {
  const el = document.createElement("article");
  el.dataset.id = device.id;
  el.innerHTML = `
    <div class="device-header">
      <strong></strong>
      <span></span>
    </div>
    <div class="device-actions">
      <button type="button" data-action="fullscreen" title="Fullscreen mockup" aria-label="Fullscreen mockup">Full</button>
      <button type="button" data-action="rotate" title="Rotate" aria-label="Rotate">R</button>
      <button type="button" data-action="duplicate" title="Duplicate" aria-label="Duplicate">+</button>
      <button type="button" data-action="remove" title="Remove" aria-label="Remove">x</button>
    </div>
    <div class="device-shell">
      <span class="device-camera"></span>
      <div class="device-screen"></div>
      <span class="device-base"></span>
    </div>
  `;

  el.addEventListener("pointerdown", onDevicePointerDown);
  el.querySelector(".device-actions").addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  el.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handleDeviceAction(device.id, button.dataset.action);
    });
  });

  return el;
}

function updateDeviceElement(el, device) {
  const dims = deviceDims(device);
  const scale = displayScaleFor(device);
  const key = previewKeyFor(device);
  const live = isDeviceLive(device);
  const visible = state.visibleIds.has(device.id);
  const shell = el.querySelector(".device-shell");
  const screen = el.querySelector(".device-screen");

  el.className = `board-device ${state.selectedIds.has(device.id) ? "selected" : ""} ${device.groupId ? "grouped" : ""}`;
  el.style.left = `${device.x}px`;
  el.style.top = `${device.y}px`;
  el.querySelector(".device-header strong").textContent = device.name;
  el.querySelector(".device-header span").textContent = `${dims.width} x ${dims.height}`;
  shell.className = `device-shell ${device.kind} ${device.mockup}`;
  screen.style.width = `${dims.width * scale}px`;
  screen.style.height = `${dims.height * scale}px`;

  if (live) {
    let iframe = screen.querySelector("iframe.preview-frame");
    if (!iframe) {
      screen.innerHTML = "";
      iframe = document.createElement("iframe");
      iframe.className = "preview-frame";
      iframe.loading = "eager";
      iframe.allow = "fullscreen";
      iframe.setAttribute("fetchpriority", "high");
      iframe.referrerPolicy = "no-referrer-when-downgrade";
      screen.appendChild(iframe);
      frameRefs.set(device.id, iframe);
    }
    iframe.title = `${device.name} preview`;
    iframe.style.width = `${dims.width}px`;
    iframe.style.height = `${dims.height}px`;
    iframe.style.transform = `scale(${scale})`;
    if (previewKeys.get(device.id) !== key) {
      iframe.src = `${proxyUrl(state.url)}&frame=${device.id}&r=${device.reloadKey}`;
      previewKeys.set(device.id, key);
    }
    return;
  }

  frameRefs.delete(device.id);
  previewKeys.delete(device.id);
  const mode = visible ? "snapshot" : "lazy";
  if (screen.dataset.mode === mode && screen.dataset.key === key) return;
  screen.dataset.mode = mode;
  screen.dataset.key = key;
  screen.innerHTML = visible
    ? staticPreviewMarkup(dims)
    : lazyPreviewMarkup(dims);
}

function staticPreviewMarkup(dims) {
  return `
    <div class="snapshot-preview">
      <div class="snapshot-topbar">
        <span></span><span></span><span></span>
      </div>
      <div class="snapshot-hero"></div>
      <div class="snapshot-line strong"></div>
      <div class="snapshot-line"></div>
      <div class="snapshot-grid">
        <span></span><span></span><span></span>
      </div>
      <div class="snapshot-badge">
        <strong>Snapshot</strong>
        <span>${new URL(state.url).host} - ${dims.width} x ${dims.height}</span>
      </div>
    </div>
  `;
}

function lazyPreviewMarkup(dims) {
  return `
    <div class="lazy-preview">
      <strong>Offscreen</strong>
      <span>${dims.width} x ${dims.height}</span>
    </div>
  `;
}

function renderStats() {
  nodes.frameCount.textContent = String(state.devices.length);
  nodes.currentUrl.textContent = new URL(state.url).host;
  nodes.currentMode.textContent = state.scaling === "fit" ? "Fit" : "Actual";
  nodes.fitScaleButton.classList.toggle("active", state.scaling === "fit");
  nodes.actualScaleButton.classList.toggle("active", state.scaling === "actual");
  nodes.selectionCount.textContent = `${state.selectedIds.size} selected`;
  nodes.navSync.checked = state.navSync;
  nodes.scrollSync.checked = state.scrollSync;
}

function renderInspector() {
  const selected = state.devices.find((device) => state.selectedIds.has(device.id));
  if (!selected || state.selectedIds.size !== 1) {
    nodes.inspector.className = "inspector-empty";
    nodes.inspector.textContent = state.selectedIds.size > 1 ? "Multiple frames" : "Select a frame";
    return;
  }

  const dims = deviceDims(selected);
  nodes.inspector.className = "inspector-form";
  nodes.inspector.innerHTML = `
    <div class="field">
      <label for="inspectName">Name</label>
      <input id="inspectName" value="${selected.name}">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="inspectWidth">Width</label>
        <input id="inspectWidth" type="number" min="240" max="3840" value="${dims.width}">
      </div>
      <div class="field">
        <label for="inspectHeight">Height</label>
        <input id="inspectHeight" type="number" min="240" max="2400" value="${dims.height}">
      </div>
    </div>
    <div class="field">
      <label for="inspectOrientation">Orientation</label>
      <select id="inspectOrientation">
        <option value="portrait" ${selected.orientation === "portrait" ? "selected" : ""}>Portrait</option>
        <option value="landscape" ${selected.orientation === "landscape" ? "selected" : ""}>Landscape</option>
      </select>
    </div>
    <div class="field">
      <label for="inspectMockup">Mockup</label>
      <select id="inspectMockup">
        <option value="realistic" ${selected.mockup === "realistic" ? "selected" : ""}>Realistic</option>
        <option value="minimal" ${selected.mockup === "minimal" ? "selected" : ""}>Minimal</option>
        <option value="wireframe" ${selected.mockup === "wireframe" ? "selected" : ""}>Wireframe</option>
      </select>
    </div>
    <button id="inspectFullscreen" type="button">Fullscreen mockup</button>
  `;

  document.getElementById("inspectName").addEventListener("input", (event) => {
    selected.name = event.target.value || "Untitled";
    render();
  });
  document.getElementById("inspectWidth").addEventListener("change", (event) => {
    const width = clamp(Number(event.target.value), 240, 3840);
    const dimsNow = deviceDims(selected);
    selected.baseWidth = selected.orientation === "landscape" ? Math.max(width, dimsNow.height) : Math.min(width, dimsNow.height);
    selected.baseHeight = selected.orientation === "landscape" ? Math.min(width, dimsNow.height) : Math.max(width, dimsNow.height);
    selected.reloadKey += 1;
    render();
  });
  document.getElementById("inspectHeight").addEventListener("change", (event) => {
    const height = clamp(Number(event.target.value), 240, 2400);
    const dimsNow = deviceDims(selected);
    selected.baseWidth = selected.orientation === "landscape" ? Math.max(dimsNow.width, height) : Math.min(dimsNow.width, height);
    selected.baseHeight = selected.orientation === "landscape" ? Math.min(dimsNow.width, height) : Math.max(dimsNow.width, height);
    selected.reloadKey += 1;
    render();
  });
  document.getElementById("inspectOrientation").addEventListener("change", (event) => {
    selected.orientation = event.target.value;
    selected.reloadKey += 1;
    render();
  });
  document.getElementById("inspectMockup").addEventListener("change", (event) => {
    selected.mockup = event.target.value;
    render();
  });
  document.getElementById("inspectFullscreen").addEventListener("click", () => {
    openFullscreen(selected.id);
  });
}

function renderFullscreen() {
  let overlay = document.querySelector(".fullscreen-review");
  if (!state.fullscreenId) {
    overlay?.remove();
    document.body.classList.remove("fullscreen-active");
    return;
  }
  document.body.classList.add("fullscreen-active");

  const device = state.devices.find((entry) => entry.id === state.fullscreenId);
  if (!device) {
    state.fullscreenId = null;
    overlay?.remove();
    document.body.classList.remove("fullscreen-active");
    return;
  }

  const dims = deviceDims(device);
  const viewportWidth = window.innerWidth - 96;
  const viewportHeight = window.innerHeight - 132;
  const chromePadding = device.mockup === "realistic" ? (device.kind === "tablet" ? 56 : 34) : 22;
  const scale = Math.min(
    1,
    (viewportWidth - chromePadding) / dims.width,
    (viewportHeight - chromePadding) / dims.height
  );
  const key = `${previewKeyFor(device)}|fullscreen|${scale}|${device.mockup}`;

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "fullscreen-review";
    overlay.innerHTML = `
      <div class="fullscreen-bar">
        <div>
          <strong></strong>
          <span></span>
        </div>
        <button type="button" id="closeFullscreen">Close</button>
      </div>
      <div class="fullscreen-device">
        <div class="device-shell">
          <span class="device-camera"></span>
          <div class="device-screen">
            <iframe
              class="preview-frame"
              loading="eager"
              allow="fullscreen"
              fetchpriority="high"
              referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
          <span class="device-base"></span>
        </div>
      </div>
    `;
    overlay.querySelector("#closeFullscreen").addEventListener("click", closeFullscreen);
    document.body.appendChild(overlay);
  }

  overlay.querySelector(".fullscreen-bar strong").textContent = device.name;
  overlay.querySelector(".fullscreen-bar span").textContent = `${dims.width} x ${dims.height}`;

  const shell = overlay.querySelector(".device-shell");
  const screen = overlay.querySelector(".device-screen");
  const iframe = overlay.querySelector("iframe.preview-frame");

  shell.className = `device-shell ${device.kind} ${device.mockup}`;
  screen.style.width = `${dims.width * scale}px`;
  screen.style.height = `${dims.height * scale}px`;
  iframe.title = `${device.name} fullscreen preview`;
  iframe.style.width = `${dims.width}px`;
  iframe.style.height = `${dims.height}px`;
  iframe.style.transform = `scale(${scale})`;

  if (overlay.dataset.key !== key) {
    iframe.src = `${proxyUrl(state.url)}&frame=${device.id}&fullscreen=1&r=${device.reloadKey}`;
    overlay.dataset.key = key;
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function onDevicePointerDown(event) {
  if (event.button !== 0) return;
  const deviceEl = event.currentTarget;
  const id = deviceEl.dataset.id;
  const clickedSelected = state.selectedIds.has(id);

  if (event.shiftKey) {
    if (clickedSelected) {
      state.selectedIds.delete(id);
    } else {
      state.selectedIds.add(id);
    }
  } else if (!clickedSelected) {
    state.selectedIds = new Set([id]);
  }

  dragging = {
    startX: event.clientX,
    startY: event.clientY,
    originals: state.devices
      .filter((device) => state.selectedIds.has(device.id))
      .map((device) => ({ id: device.id, x: device.x, y: device.y }))
  };

  deviceEl.setPointerCapture(event.pointerId);
  render();
}

function onPointerMove(event) {
  if (dragging) {
    const dx = (event.clientX - dragging.startX) / state.zoom;
    const dy = (event.clientY - dragging.startY) / state.zoom;
    dragging.originals.forEach((item) => {
      const device = state.devices.find((entry) => entry.id === item.id);
      if (device) {
        device.x = Math.round(item.x + dx);
        device.y = Math.round(item.y + dy);
      }
    });
    updateDevicePositions();
    return;
  }

  if (panning) {
    state.pan.x = panning.x + event.clientX - panning.startX;
    state.pan.y = panning.y + event.clientY - panning.startY;
    applyTransforms();
  }
}

function onPointerUp() {
  dragging = null;
  panning = null;
  nodes.stage.classList.remove("panning");
  refreshVisiblePreviews();
}

function updateDevicePositions() {
  state.devices.forEach((device) => {
    const el = nodes.world.querySelector(`[data-id="${device.id}"]`);
    if (!el) return;
    el.style.left = `${device.x}px`;
    el.style.top = `${device.y}px`;
  });
}

function handleDeviceAction(id, action) {
  const device = state.devices.find((entry) => entry.id === id);
  if (!device) return;

  if (action === "fullscreen") {
    openFullscreen(id);
    return;
  }

  if (action === "rotate") {
    device.orientation = device.orientation === "portrait" ? "landscape" : "portrait";
    device.reloadKey += 1;
  }

  if (action === "duplicate") {
    const copy = { ...device, id: uid(), x: device.x + 48, y: device.y + 48, reloadKey: 0 };
    state.devices.push(copy);
    state.selectedIds = new Set([copy.id]);
  }

  if (action === "remove") {
    state.devices = state.devices.filter((entry) => entry.id !== id);
    state.selectedIds.delete(id);
  }

  render();
}

function openFullscreen(id) {
  state.fullscreenId = id;
  state.selectedIds = new Set([id]);
  render();
  const overlay = document.querySelector(".fullscreen-review");
  if (overlay && overlay.requestFullscreen && !document.fullscreenElement) {
    overlay.requestFullscreen().catch(() => {});
  }
}

function closeFullscreen() {
  state.fullscreenId = null;
  document.querySelector(".fullscreen-review")?.remove();
  document.body.classList.remove("fullscreen-active");
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  render();
}

function setZoom(nextZoom, anchor = null) {
  const oldZoom = state.zoom;
  const zoom = clamp(nextZoom, 0.18, 1.6);
  if (anchor) {
    const worldX = (anchor.x - state.pan.x) / oldZoom;
    const worldY = (anchor.y - state.pan.y) / oldZoom;
    state.pan.x = anchor.x - worldX * zoom;
    state.pan.y = anchor.y - worldY * zoom;
  }
  state.zoom = zoom;
  applyTransforms();
  refreshVisiblePreviews();
}

function fitBoard() {
  if (!state.devices.length) return;
  const boxes = state.devices.map((device) => {
    const size = estimateOuterSize(device);
    return {
      left: device.x,
      top: device.y - 40,
      right: device.x + size.width,
      bottom: device.y + size.height
    };
  });
  const bounds = boxes.reduce(
    (acc, box) => ({
      left: Math.min(acc.left, box.left),
      top: Math.min(acc.top, box.top),
      right: Math.max(acc.right, box.right),
      bottom: Math.max(acc.bottom, box.bottom)
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  );
  const rect = nodes.stage.getBoundingClientRect();
  const contentWidth = bounds.right - bounds.left;
  const contentHeight = bounds.bottom - bounds.top;
  const zoom = clamp(Math.min((rect.width - 96) / contentWidth, (rect.height - 96) / contentHeight), 0.2, 1);
  state.zoom = zoom;
  state.pan.x = (rect.width - contentWidth * zoom) / 2 - bounds.left * zoom;
  state.pan.y = (rect.height - contentHeight * zoom) / 2 - bounds.top * zoom;
  applyTransforms();
}

function navigateAll(url) {
  state.url = url;
  nodes.urlInput.value = url;
  state.devices.forEach((device) => {
    device.reloadKey += 1;
  });
  render();
}

function syncScroll(sourceId, percent) {
  if (!state.scrollSync || state.suppressScroll) return;
  state.suppressScroll = true;
  frameRefs.forEach((iframe, id) => {
    if (id === sourceId || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { source: "viewframe-parent", type: "setScroll", percent },
      "*"
    );
  });
  window.setTimeout(() => {
    state.suppressScroll = false;
  }, 140);
}

function groupSelection() {
  if (state.selectedIds.size < 2) {
    toast("Select two or more frames");
    return;
  }
  const groupId = `Group ${state.nextGroup++}`;
  state.devices.forEach((device) => {
    if (state.selectedIds.has(device.id)) device.groupId = groupId;
  });
  render();
  toast(`${groupId} created`);
}

function ungroupSelection() {
  let changed = false;
  state.devices.forEach((device) => {
    if (state.selectedIds.has(device.id) && device.groupId) {
      device.groupId = null;
      changed = true;
    }
  });
  if (changed) {
    render();
    toast("Group removed");
  }
}

function exportPng(scope) {
  const devices = scope === "selected"
    ? state.devices.filter((device) => state.selectedIds.has(device.id))
    : state.devices;
  if (!devices.length) {
    toast("No frames to export");
    return;
  }

  const boxes = devices.map((device) => {
    const size = estimateOuterSize(device);
    return {
      device,
      size,
      left: device.x,
      top: device.y - 46,
      right: device.x + size.width,
      bottom: device.y + size.height
    };
  });
  const bounds = boxes.reduce(
    (acc, box) => ({
      left: Math.min(acc.left, box.left),
      top: Math.min(acc.top, box.top),
      right: Math.max(acc.right, box.right),
      bottom: Math.max(acc.bottom, box.bottom)
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  );

  const margin = 56;
  const width = Math.ceil(bounds.right - bounds.left + margin * 2);
  const height = Math.ceil(bounds.bottom - bounds.top + margin * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(width, 6000);
  canvas.height = Math.min(height, 4000);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eef1ef";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  boxes.forEach(({ device }) => {
    const dims = deviceDims(device);
    const scale = displayScaleFor(device);
    const x = device.x - bounds.left + margin;
    const y = device.y - bounds.top + margin;
    const shellPad = device.mockup === "realistic" ? (device.kind === "tablet" ? 28 : 16) : 10;
    const screenWidth = dims.width * scale;
    const screenHeight = dims.height * scale;
    const shellWidth = screenWidth + shellPad * 2;
    const shellHeight = screenHeight + shellPad * 2;

    ctx.fillStyle = "#1f2933";
    ctx.font = "700 15px Inter, Arial";
    ctx.fillText(device.name, x, y - 18);
    ctx.fillStyle = "#65717f";
    ctx.font = "12px Inter, Arial";
    ctx.fillText(`${dims.width} x ${dims.height} - ${new URL(state.url).host}`, x + 1, y - 2);

    roundRect(ctx, x, y, shellWidth, shellHeight, device.kind === "tablet" ? 30 : 10);
    ctx.fillStyle = device.mockup === "wireframe" ? "#eef1ef" : device.mockup === "minimal" ? "#ffffff" : "#151a1d";
    ctx.fill();
    ctx.strokeStyle = device.mockup === "wireframe" ? "#34424a" : "#151a1d";
    ctx.lineWidth = device.mockup === "wireframe" ? 2 : 1;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + shellPad, y + shellPad, screenWidth, screenHeight);
    ctx.strokeStyle = "#d8ded8";
    ctx.strokeRect(x + shellPad, y + shellPad, screenWidth, screenHeight);

    ctx.fillStyle = "#f8faf9";
    ctx.fillRect(x + shellPad + 14, y + shellPad + 14, Math.max(40, screenWidth - 28), 34);
    ctx.fillStyle = "#dcefea";
    ctx.fillRect(x + shellPad + 14, y + shellPad + 66, Math.max(40, screenWidth * 0.56), 18);
    ctx.fillStyle = "#f0d7df";
    ctx.fillRect(x + shellPad + 14, y + shellPad + 98, Math.max(40, screenWidth * 0.72), 14);
    ctx.fillStyle = "#edd9ac";
    ctx.fillRect(x + shellPad + 14, y + shellPad + 126, Math.max(40, screenWidth * 0.38), 14);
    ctx.fillStyle = "#65717f";
    ctx.font = "12px Inter, Arial";
    ctx.fillText("Live viewport rendered in app", x + shellPad + 14, y + shellPad + screenHeight - 22);
  });

  const link = document.createElement("a");
  link.download = `viewframe-${scope}-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  toast("PNG exported");
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function toast(message) {
  nodes.toast.textContent = message;
  nodes.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => nodes.toast.classList.remove("visible"), 2200);
}

nodes.urlInput.value = state.url;
nodes.urlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextUrl = safeUrl(nodes.urlInput.value);
  if (!nextUrl) {
    toast("Enter a valid URL");
    return;
  }
  navigateAll(nextUrl);
});

nodes.stage.addEventListener("pointerdown", (event) => {
  if (event.target !== nodes.stage && event.target !== nodes.grid) return;
  if (event.button !== 0) return;
  state.selectedIds.clear();
  panning = {
    startX: event.clientX,
    startY: event.clientY,
    x: state.pan.x,
    y: state.pan.y
  };
  nodes.stage.classList.add("panning");
  render();
});

window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

nodes.stage.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || event.altKey) {
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    setZoom(state.zoom * factor, { x: event.clientX, y: event.clientY });
  } else {
    state.pan.x -= event.deltaX;
    state.pan.y -= event.deltaY;
    applyTransforms();
    refreshVisiblePreviews();
  }
}, { passive: false });

nodes.zoomOut.addEventListener("click", () => setZoom(state.zoom * 0.86));
nodes.zoomIn.addEventListener("click", () => setZoom(state.zoom * 1.14));
nodes.zoomReset.addEventListener("click", () => setZoom(1));
nodes.fitBoard.addEventListener("click", fitBoard);
nodes.fitScaleButton.addEventListener("click", () => {
  state.scaling = "fit";
  render();
});
nodes.actualScaleButton.addEventListener("click", () => {
  state.scaling = "actual";
  render();
});
nodes.navSync.addEventListener("change", (event) => {
  state.navSync = event.target.checked;
  renderStats();
});
nodes.scrollSync.addEventListener("change", (event) => {
  state.scrollSync = event.target.checked;
  renderStats();
});
nodes.exportBoard.addEventListener("click", () => exportPng("board"));
nodes.exportSelected.addEventListener("click", () => exportPng("selected"));
nodes.clearBoard.addEventListener("click", () => {
  state.devices = [];
  state.selectedIds.clear();
  render();
});
nodes.customDeviceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addDeviceToBoard({
    name: nodes.customName.value || "Custom",
    width: clamp(Number(nodes.customWidth.value), 240, 3840),
    height: clamp(Number(nodes.customHeight.value), 240, 2400),
    kind: nodes.customKind.value
  });
});
nodes.groupSelection.addEventListener("click", groupSelection);
nodes.ungroupSelection.addEventListener("click", ungroupSelection);

window.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.source !== "viewframe") return;
  const fullscreenIframe = document.querySelector(".fullscreen-review iframe.preview-frame");
  const fromFullscreen = !!fullscreenIframe && fullscreenIframe.contentWindow === event.source;
  const iframeEntry = [...frameRefs.entries()].find(([, iframe]) => iframe.contentWindow === event.source);
  const sourceId = fromFullscreen ? state.fullscreenId : iframeEntry && iframeEntry[0];
  if (data.type === "navigate" && data.href) {
    if (state.navSync || fromFullscreen) {
      navigateAll(data.href);
    } else if (sourceId) {
      const device = state.devices.find((entry) => entry.id === sourceId);
      if (device) {
        const iframe = frameRefs.get(sourceId);
        if (iframe) iframe.src = proxyUrl(data.href);
      }
    }
  }
  if (data.type === "scroll" && sourceId) {
    syncScroll(sourceId, data.percent);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.fullscreenId) {
    closeFullscreen();
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && state.fullscreenId) {
    state.fullscreenId = null;
    document.querySelector(".fullscreen-review")?.remove();
    document.body.classList.remove("fullscreen-active");
    render();
  }
});

renderLibrary();
seedBoard();
render();
window.setTimeout(fitBoard, 80);
