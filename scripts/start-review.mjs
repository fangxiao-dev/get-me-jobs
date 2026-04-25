import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const source = "linkedin";
const port = Number(process.env.PORT ?? 4173);

function usage() {
  console.log("Usage: node scripts/start-review.mjs [raw-file] [--no-open]");
  console.log("Default: use the latest raw/*.json batch.");
}

function latestRawFile() {
  const rawDir = path.join(rootDir, "raw");
  if (!fs.existsSync(rawDir)) return null;
  const latest = fs.readdirSync(rawDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}(?:-\d{4})?\.json$/.test(name))
    .sort()
    .at(-1);
  return latest ? path.join(rawDir, latest) : null;
}

function runNode(args) {
  const result = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });
  return new Promise((resolve, reject) => {
    result.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${process.execPath} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function fileUrlParam(filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}

function openBrowser(url) {
  const value = url.toString();
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", value], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [value], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [value], { detached: true, stdio: "ignore" }).unref();
  }
}

const args = process.argv.slice(2);
const shouldOpen = !args.includes("--no-open");
const rawArg = args.find((arg) => !arg.startsWith("-"));
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const rawPath = rawArg ? path.resolve(rootDir, rawArg) : latestRawFile();
if (!rawPath || !fs.existsSync(rawPath)) {
  console.error(rawArg ? `Raw file not found: ${rawArg}` : "No raw/*.json batches found.");
  process.exit(1);
}

const batchId = path.basename(rawPath, ".json");
const selectedPath = path.join(rootDir, "selected", `${batchId}.json`);
if (!fs.existsSync(selectedPath)) {
  await runNode([
    "scripts/select-jobs.mjs",
    rawPath,
    selectedPath,
    "config/preferences.linkedin.json",
  ]);
}

const server = spawn(process.execPath, ["app/server.mjs"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, PORT: String(port) },
});

const url = new URL(`http://127.0.0.1:${port}/`);
url.searchParams.set("source", source);
url.searchParams.set("batch", batchId);
url.searchParams.set("rawFile", fileUrlParam(rawPath));
url.searchParams.set("selectedFile", fileUrlParam(selectedPath));

console.log(`Review UI: ${url.toString()}`);
console.log("Press Ctrl+C to stop.");
if (shouldOpen) {
  setTimeout(() => openBrowser(url), 500);
}

process.on("SIGINT", () => {
  server.kill("SIGINT");
  process.exit(0);
});

server.on("exit", (code) => process.exit(code ?? 0));
