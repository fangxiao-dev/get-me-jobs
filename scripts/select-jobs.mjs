import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(toText).join("\n");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getField(obj, dotPath) {
  return dotPath.split(".").reduce((curr, key) => curr?.[key], obj);
}

function pickFields(item, fields) {
  return fields.map((field) => toText(getField(item, field))).filter(Boolean).join("\n");
}

function termMatches(text, term) {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedTerm = term.toLocaleLowerCase();

  if (/^[a-z0-9.+#-]+$/i.test(term) && term.length <= 4) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  }

  return normalizedText.includes(normalizedTerm);
}

function evaluateRule(item, rule) {
  const text = pickFields(item, rule.fields ?? []);
  const matchedTerms = (rule.terms ?? []).filter((term) => termMatches(text, term));

  return {
    id: rule.id,
    description: rule.description,
    passed: matchedTerms.length > 0,
    matchedTerms,
  };
}

function selectItems(raw, preferences) {
  const mustRules = preferences.rules?.must ?? [];
  const excludeRules = preferences.rules?.exclude ?? [];

  return (raw.items ?? [])
    .map((item) => {
      const must = mustRules.map((rule) => evaluateRule(item, rule));
      const exclude = excludeRules.map((rule) => evaluateRule(item, rule));
      const passed = must.every((result) => result.passed) && !exclude.some((result) => result.passed);

      return { item, match: { passed, must, exclude } };
    })
    .filter((result) => result.match.passed);
}

function stableId(item) {
  return item.identity?.jobId ?? item.id ?? item.sourceJobId ?? item.link ?? item.url;
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
  const selectionUnchanged = JSON.stringify(selectedIds) === JSON.stringify(previousIds)
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
