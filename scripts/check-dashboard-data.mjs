import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function duplicateKeys(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    if (!item.jobKey) continue;
    if (seen.has(item.jobKey)) duplicates.add(item.jobKey);
    seen.add(item.jobKey);
  }
  return [...duplicates].sort();
}

const accepted = readJson(path.join(rootDir, "data", "accepted-jobs.json"), { version: 1, items: [] });
const applications = readJson(path.join(rootDir, "data", "applications.json"), { version: 1, items: [] });
const acceptedItems = accepted.items ?? [];
const applicationItems = applications.items ?? [];
const acceptedKeys = new Set(acceptedItems.map((item) => item.jobKey));
const applicationKeys = new Set(applicationItems.map((item) => item.jobKey));
const problems = [];

for (const key of duplicateKeys(acceptedItems)) {
  problems.push({ type: "duplicate_accepted_job", jobKey: key });
}

for (const key of duplicateKeys(applicationItems)) {
  problems.push({ type: "duplicate_application", jobKey: key });
}

for (const key of applicationKeys) {
  if (!acceptedKeys.has(key)) problems.push({ type: "orphan_application", jobKey: key });
}

for (const key of acceptedKeys) {
  if (!applicationKeys.has(key)) problems.push({ type: "missing_application", jobKey: key });
}

const result = {
  acceptedJobs: acceptedItems.length,
  applications: applicationItems.length,
  problems,
};

console.log(JSON.stringify(result, null, 2));
if (problems.length) process.exitCode = 1;
