import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectItems, stableId } from "./lib/preferences.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function selectJobsFile(rawPathArg, selectedPathArg, preferencesPathArg, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const rawPath = path.resolve(cwd, rawPathArg);
  const selectedPath = path.resolve(
    cwd,
    selectedPathArg ?? path.join("data", "selected", path.basename(rawPath)),
  );
  const preferencesPath = path.resolve(cwd, preferencesPathArg ?? "config/preferences.linkedin.json");

  const raw = readJson(rawPath);
  const preferences = readJson(preferencesPath);
  const previousOutput = fs.existsSync(selectedPath) ? readJson(selectedPath) : null;
  const selected = selectItems(raw, preferences);
  const preferencesFile = path.relative(cwd, preferencesPath);
  const selectedIds = selected.map(({ item }) => stableId(item));
  const previousIds = (previousOutput?.items ?? []).map(stableId);
  const forceWrite = Boolean(options.forceWrite);
  const selectionUnchanged = !forceWrite
    && JSON.stringify(selectedIds) === JSON.stringify(previousIds)
    && previousOutput?.preferencesVersion === preferences.version
    && previousOutput?.preferencesFile === preferencesFile;

  const output = {
    schemaVersion: raw.schemaVersion ?? 1,
    date: raw.date,
    savedAt: selectionUnchanged ? previousOutput.savedAt : new Date().toISOString(),
    preferencesFile,
    preferencesVersion: preferences.version,
    rawCount: raw.items?.length ?? 0,
    selectedCount: selected.length,
    items: selected.map(({ item, match }) => ({
      ...item,
      _selection: match,
    })),
  };

  if (!selectionUnchanged) {
    writeJson(selectedPath, output);
  }

  return {
    rawPath,
    selectedPath,
    preferencesPath,
    rawCount: output.rawCount,
    selectedCount: output.selectedCount,
    written: !selectionUnchanged,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , rawPathArg, selectedPathArg, preferencesPathArg] = process.argv;

  if (!rawPathArg) {
    console.error("Usage: node scripts/select-jobs.mjs <raw.json> [selected.json] [preferences.json]");
    process.exit(1);
  }

  console.log(JSON.stringify(selectJobsFile(rawPathArg, selectedPathArg, preferencesPathArg), null, 2));
}
