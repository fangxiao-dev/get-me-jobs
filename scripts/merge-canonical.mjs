import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRawFilename } from "./lib/parse-raw-filename.mjs";
import { adaptLinkedinItem } from "./lib/adapt-linkedin.mjs";
import { emptyCanonicalFile, mergeIntoCanonical } from "./lib/canonical-merge.mjs";
import { manualLinkedinMergeInputs } from "./lib/manual-linkedin-store.mjs";

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

function allRawFiles(root = rootDir, rawBase = rawDir) {
  const rawFiles = fs.existsSync(rawBase)
    ? fs.readdirSync(rawBase)
        .map((name) => {
          const parsed = parseRawFilename(name);
          if (!parsed) return null;
          const filePath = path.join(rawBase, name);
          return {
            name,
            parsed,
            filePath,
            relative: path.relative(root, filePath).replaceAll(path.sep, "/"),
          };
        })
        .filter(Boolean)
    : [];
  return [...rawFiles, ...manualLinkedinMergeInputs(root)];
}

function latestDate(files) {
  return [...new Set(files.map(({ parsed }) => parsed.date))].sort().at(-1) ?? null;
}

export function mergeCanonicalForDate(dateArg, options = {}) {
  const root = options.rootDir ?? rootDir;
  const rawBase = options.rawDir ?? path.join(root, "data", "raw");
  const canonicalBase = options.canonicalDir ?? path.join(root, "data", "canonical");
  const allFiles = allRawFiles(root, rawBase);

  if (!allFiles.length) {
    throw new Error("No parseable raw files found in data/raw/");
  }

  const targetDate = dateArg ?? latestDate(allFiles);
  const filesForDate = allFiles
    .filter(({ parsed }) => parsed.date === targetDate)
    .sort((a, b) => a.parsed.time.localeCompare(b.parsed.time) || (a.parsed.sequence ?? 1) - (b.parsed.sequence ?? 1));

  if (!filesForDate.length) {
    throw new Error(`No raw files found for date: ${targetDate}`);
  }

  const canonicalPath = path.join(canonicalBase, `${targetDate}.json`);
  let canonical = fs.existsSync(canonicalPath)
    ? readJson(canonicalPath)
    : emptyCanonicalFile(targetDate);

  const summary = [];

  for (const entry of filesForDate) {
    const { name, parsed, filePath: rawFilePath, relative: rawRelative, processKey } = entry;
    const { source, time } = parsed;
    const lastRawFileTime = canonical.mergeState.lastRawFileTime;

    if (!processKey && lastRawFileTime && time < lastRawFileTime) {
      summary.push({ file: name, skipped: true, reason: "not newer than canonical watermark" });
      continue;
    }

    if (canonical.mergeState.processedRawFiles.includes(processKey ?? rawRelative)) {
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
    const collectedAt = raw.updatedAt ?? raw.savedAt ?? new Date().toISOString();

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
      processKey,
      rawFileTime: time,
      importedAt,
      rawCount: rawItems.length,
    });

    const sourceSummary = canonical.sources.at(-1);
    summary.push({
      file: name,
      source,
      rawCount: rawItems.length,
      addedCount: sourceSummary?.addedCount ?? 0,
      duplicateCount: sourceSummary?.duplicateCount ?? 0,
    });
  }

  writeJson(canonicalPath, canonical);

  return {
    date: targetDate,
    canonicalPath: path.relative(root, canonicalPath).replaceAll(path.sep, "/"),
    canonicalItems: canonical.items.length,
    totalItems: canonical.items.length,
    files: summary,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = mergeCanonicalForDate(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
