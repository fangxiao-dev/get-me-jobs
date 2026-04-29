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

export function manualLinkedinRelativeFile(date) {
  return `data/manual/linkedin-${date}.json`;
}

export function manualLinkedinFilePath(rootDir, date) {
  return path.join(rootDir, "data", "manual", `linkedin-${date}.json`);
}

export function upsertManualLinkedinRawItem(rootDir, rawItem, now) {
  const date = dateFromIso(now);
  const filePath = manualLinkedinFilePath(rootDir, date);
  const current = readJson(filePath, {
    source: "linkedin",
    taskName: "manual-linkedin-job-imports",
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
    source: "linkedin",
    taskName: "manual-linkedin-job-imports",
    runStatus: "MANUAL_AGGREGATE",
    updatedAt: now,
    count: items.length,
    items,
  };
  writeJson(filePath, next);

  return {
    manualFile: manualLinkedinRelativeFile(date),
    manualAdded,
    manualDeduped: !manualAdded,
    count: items.length,
    updatedAt: now,
  };
}

export function writeManualLinkedinAudit(rootDir, rawItem, now) {
  const auditName = `linkedin-manual-${timestampForFile(new Date(now))}.json`;
  const relative = `data/manual/audit/${auditName}`;
  writeJson(path.join(rootDir, relative), {
    source: "linkedin",
    taskName: "manual-linkedin-job-import",
    runStatus: "MANUAL",
    savedAt: now,
    count: 1,
    items: [rawItem],
  });
  return relative;
}

function legacyManualTimestamp(filename) {
  const match = /^linkedin-manual-(\d{4}-\d{2}-\d{2})-(\d{6})\.json$/.exec(filename);
  if (!match) return null;
  return `${match[1]}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}.000Z`;
}

export function migrateLegacyManualLinkedinFiles(rootDir) {
  const rawDir = path.join(rootDir, "data", "raw");
  const names = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((name) => legacyManualTimestamp(name)) : [];
  let addedCount = 0;
  let dedupedCount = 0;
  const files = [];

  for (const name of names.sort()) {
    const filePath = path.join(rawDir, name);
    const raw = readJson(filePath, { items: [] });
    const importedAt = raw.savedAt ?? legacyManualTimestamp(name);
    let fileAdded = 0;
    let fileDeduped = 0;
    for (const item of raw.items ?? []) {
      const result = upsertManualLinkedinRawItem(rootDir, item, importedAt);
      if (result.manualAdded) {
        addedCount++;
        fileAdded++;
      } else {
        dedupedCount++;
        fileDeduped++;
      }
    }
    files.push({ file: `data/raw/${name}`, addedCount: fileAdded, dedupedCount: fileDeduped });
  }

  return { files, addedCount, dedupedCount };
}

export function manualLinkedinMergeInputs(rootDir) {
  const manualDir = path.join(rootDir, "data", "manual");
  if (!fs.existsSync(manualDir)) return [];
  return fs.readdirSync(manualDir)
    .map((name) => {
      const match = /^linkedin-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
      if (!match) return null;
      const filePath = path.join(manualDir, name);
      const raw = readJson(filePath, null);
      if (!raw) return null;
      const updatedAt = raw.updatedAt ?? raw.savedAt ?? fs.statSync(filePath).mtime.toISOString();
      return {
        name,
        filePath,
        relative: manualLinkedinRelativeFile(match[1]),
        parsed: {
          source: "linkedin",
          date: match[1],
          time: String(updatedAt).slice(11, 19).replaceAll(":", ""),
        },
        processKey: `${manualLinkedinRelativeFile(match[1])}#${updatedAt}`,
      };
    })
    .filter(Boolean);
}
