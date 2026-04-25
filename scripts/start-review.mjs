import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const port = Number(process.env.PORT ?? 4173);

function usage() {
  console.log("Usage: node scripts/start-review.mjs [canonical-file] [--no-open]");
  console.log("Default: use the latest data/canonical/*.json batch.");
}

function latestCanonicalFile() {
  const canonicalDir = path.join(rootDir, "data", "canonical");
  if (!fs.existsSync(canonicalDir)) return null;
  const latest = fs.readdirSync(canonicalDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .at(-1);
  return latest ? path.join(canonicalDir, latest) : null;
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
const canonicalArg = args.find((arg) => !arg.startsWith("-"));
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const canonicalPath = canonicalArg ? path.resolve(rootDir, canonicalArg) : latestCanonicalFile();
if (!canonicalPath || !fs.existsSync(canonicalPath)) {
  console.error(canonicalArg ? `Canonical file not found: ${canonicalArg}` : "No data/canonical/*.json batches found.");
  process.exit(1);
}

const batchId = path.basename(canonicalPath, ".json");
const selectedPath = path.join(rootDir, "data", "selected", `${batchId}.json`);
if (!fs.existsSync(selectedPath)) {
  await runNode([
    "scripts/select-jobs.mjs",
    canonicalPath,
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
url.searchParams.set("batch", batchId);
url.searchParams.set("canonicalFile", fileUrlParam(canonicalPath));
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
