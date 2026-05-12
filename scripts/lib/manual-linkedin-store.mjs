import fs from "node:fs";
import path from "node:path";
import {
  manualSourceFilePath,
  manualSourceMergeInputs,
  manualSourceRelativeFile,
  upsertManualRawItem,
  writeManualAudit,
} from "./manual-job-store.mjs";

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function manualLinkedinRelativeFile(date) {
  return manualSourceRelativeFile("linkedin", date);
}

export function manualLinkedinFilePath(rootDir, date) {
  return manualSourceFilePath(rootDir, "linkedin", date);
}

export function upsertManualLinkedinRawItem(rootDir, rawItem, now) {
  return upsertManualRawItem(rootDir, "linkedin", rawItem, now);
}

export function writeManualLinkedinAudit(rootDir, rawItem, now) {
  return writeManualAudit(rootDir, "linkedin", rawItem, now);
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
  return manualSourceMergeInputs(rootDir, "linkedin");
}
