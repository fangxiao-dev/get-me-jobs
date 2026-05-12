import fs from "node:fs";
import path from "node:path";

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function dateFromIso(value) {
  return String(value).slice(0, 10);
}

function timestampForFile(value = new Date()) {
  const iso = value.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

function manualKey(item) {
  return String(item?.id ?? item?.sourceJobId ?? item?.link ?? item?.url ?? "").trim();
}

function sourceTaskName(source) {
  return `manual-${source}-job-imports`;
}

export function manualSourceRelativeFile(source, date) {
  return `data/manual/${source}-${date}.json`;
}

export function manualSourceFilePath(rootDir, source, date) {
  return path.join(rootDir, "data", "manual", `${source}-${date}.json`);
}

export function upsertManualRawItem(rootDir, source, rawItem, now) {
  const date = dateFromIso(now);
  const filePath = manualSourceFilePath(rootDir, source, date);
  const current = readJson(filePath, {
    source,
    taskName: sourceTaskName(source),
    runStatus: "MANUAL_AGGREGATE",
    savedAt: now,
    updatedAt: now,
    count: 0,
    items: [],
  });

  const key = manualKey(rawItem);
  const items = [...(current.items ?? [])];
  const index = items.findIndex((item) => manualKey(item) === key);
  const manualAdded = index < 0;
  if (index >= 0) {
    items[index] = { ...items[index], ...rawItem };
  } else {
    items.push(rawItem);
  }

  const next = {
    ...current,
    source,
    taskName: sourceTaskName(source),
    runStatus: "MANUAL_AGGREGATE",
    updatedAt: now,
    count: items.length,
    items,
  };
  writeJson(filePath, next);

  return {
    manualFile: manualSourceRelativeFile(source, date),
    manualAdded,
    manualDeduped: !manualAdded,
    count: items.length,
    updatedAt: now,
  };
}

export function writeManualAudit(rootDir, source, rawItem, now) {
  const auditName = `${source}-manual-${timestampForFile(new Date(now))}.json`;
  const relative = `data/manual/audit/${auditName}`;
  writeJson(path.join(rootDir, relative), {
    source,
    taskName: `manual-${source}-job-import`,
    runStatus: "MANUAL",
    savedAt: now,
    count: 1,
    items: [rawItem],
  });
  return relative;
}

export function manualSourceMergeInputs(rootDir, source) {
  const manualDir = path.join(rootDir, "data", "manual");
  if (!fs.existsSync(manualDir)) return [];
  const pattern = new RegExp(`^${source}-(\\d{4}-\\d{2}-\\d{2})\\.json$`);
  return fs.readdirSync(manualDir)
    .map((name) => {
      const match = pattern.exec(name);
      if (!match) return null;
      const filePath = path.join(manualDir, name);
      const raw = readJson(filePath, null);
      if (!raw) return null;
      const updatedAt = raw.updatedAt ?? raw.savedAt ?? fs.statSync(filePath).mtime.toISOString();
      return {
        name,
        filePath,
        relative: manualSourceRelativeFile(source, match[1]),
        parsed: {
          source,
          date: match[1],
          time: String(updatedAt).slice(11, 19).replaceAll(":", ""),
        },
        processKey: `${manualSourceRelativeFile(source, match[1])}#${updatedAt}`,
      };
    })
    .filter(Boolean);
}
