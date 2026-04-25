import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRawFilename } from "./lib/parse-raw-filename.mjs";
import { adaptLinkedinItem } from "./lib/adapt-linkedin.mjs";
import { emptyCanonicalFile, mergeIntoCanonical } from "./lib/canonical-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rawDir = path.join(rootDir, "data", "raw");
const canonicalDir = path.join(rootDir, "data", "canonical");

const ADAPTERS = { linkedin: adaptLinkedinItem };

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function allRawFiles() {
  return fs.existsSync(rawDir)
    ? fs.readdirSync(rawDir)
        .map((name) => ({ name, parsed: parseRawFilename(name) }))
        .filter(({ parsed }) => parsed !== null)
    : [];
}

function latestDate(files) {
  return [...new Set(files.map(({ parsed }) => parsed.date))].sort().at(-1) ?? null;
}

const [, , dateArg] = process.argv;
const allFiles = allRawFiles();

if (!allFiles.length) {
  console.error("No parseable raw files found in data/raw/");
  process.exit(1);
}

const targetDate = dateArg ?? latestDate(allFiles);
const filesForDate = allFiles
  .filter(({ parsed }) => parsed.date === targetDate)
  .sort((a, b) => a.parsed.time.localeCompare(b.parsed.time));

if (!filesForDate.length) {
  console.error(`No raw files found for date: ${targetDate}`);
  process.exit(1);
}

const canonicalPath = path.join(canonicalDir, `${targetDate}.json`);
let canonical = fs.existsSync(canonicalPath)
  ? readJson(canonicalPath)
  : emptyCanonicalFile(targetDate);

const summary = [];

for (const { name, parsed } of filesForDate) {
  const { source, time } = parsed;
  const rawFilePath = path.join(rawDir, name);
  const rawRelative = path.relative(rootDir, rawFilePath).replaceAll(path.sep, "/");
  const lastRawFileTime = canonical.mergeState.lastRawFileTime;

  if (lastRawFileTime && time < lastRawFileTime) {
    summary.push({ file: name, skipped: true, reason: "not newer than canonical watermark" });
    continue;
  }

  if (canonical.mergeState.processedRawFiles.includes(rawRelative)) {
    summary.push({ file: name, skipped: true, reason: "already processed" });
    continue;
  }

  const adapt = ADAPTERS[source];
  if (!adapt) {
    summary.push({ file: name, skipped: true, reason: `no adapter for source "${source}"` });
    continue;
  }

  const raw = readJson(rawFilePath);
  const rawItems = raw.items ?? [];
  const collectedAt = raw.savedAt ?? new Date().toISOString();

  const newJobs = rawItems.map((item) =>
    adapt(item, {
      rawFile: rawRelative,
      collectedAt,
      runId: raw.runId,
      datasetId: raw.datasetId,
    }),
  );

  const importedAt = new Date().toISOString();
  canonical = mergeIntoCanonical(canonical, newJobs, {
    source,
    rawFile: rawRelative,
    rawFileTime: time,
    importedAt,
    rawCount: rawItems.length,
  });

  summary.push({ file: name, source, rawCount: rawItems.length });
}

writeJson(canonicalPath, canonical);

console.log(JSON.stringify({
  date: targetDate,
  canonicalPath: path.relative(rootDir, canonicalPath).replaceAll(path.sep, "/"),
  totalItems: canonical.items.length,
  files: summary,
}, null, 2));
