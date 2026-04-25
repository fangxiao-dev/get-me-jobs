import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const annotationsDir = path.join(rootDir, "data", "annotations");

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

function canonicalAnnotationId(source, id) {
  const value = String(id);
  return value.includes(":") ? value : `${source}:${value}`;
}

function migrateFile(fileName) {
  const match = /^(\d{4}-\d{2}-\d{2})\.([a-z][a-z0-9]*)\.json$/.exec(fileName);
  if (!match) return null;

  const [, date, source] = match;
  const oldPath = path.join(annotationsDir, fileName);
  const newPath = path.join(annotationsDir, `${date}.json`);
  const oldFile = readJson(oldPath, { items: [] });
  const newFile = readJson(newPath, {
    date,
    createdAt: oldFile.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [],
  });

  const byId = new Map((newFile.items ?? []).map((item) => [String(item.id), item]));
  for (const item of oldFile.items ?? []) {
    const next = { ...item, id: canonicalAnnotationId(source, item.id) };
    byId.set(String(next.id), { ...byId.get(String(next.id)), ...next });
  }

  const migrated = {
    date,
    createdAt: newFile.createdAt ?? oldFile.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [...byId.values()],
  };
  writeJson(newPath, migrated);
  return { from: fileName, to: path.basename(newPath), migrated: (oldFile.items ?? []).length };
}

const results = fs.existsSync(annotationsDir)
  ? fs.readdirSync(annotationsDir).map(migrateFile).filter(Boolean)
  : [];

console.log(JSON.stringify({ migratedFiles: results }, null, 2));
