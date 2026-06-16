const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const output = path.join(root, ".vercel", "output");
const staticOutput = path.join(output, "static");
const functionsOutput = path.join(output, "functions", "api");

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyFunction(name) {
  const functionDir = path.join(functionsOutput, `${name}.func`);
  fs.mkdirSync(functionDir, { recursive: true });
  copyFile(path.join(root, "api", `${name}.js`), path.join(functionDir, `${name}.js`));
  writeJson(path.join(functionDir, ".vc-config.json"), {
    runtime: "nodejs22.x",
    handler: `${name}.js`,
    launcherType: "Nodejs",
    shouldAddHelpers: false,
    shouldAddSourcemapSupport: false,
    maxDuration: 20
  });
}

fs.rmSync(output, { recursive: true, force: true });
writeJson(path.join(output, "config.json"), {
  version: 3
});

["index.html", "styles.css", "app.js"].forEach((fileName) => {
  copyFile(path.join(root, fileName), path.join(staticOutput, fileName));
});

copyFunction("proxy");
copyFunction("health");

console.log("Built Vercel output in .vercel/output");
