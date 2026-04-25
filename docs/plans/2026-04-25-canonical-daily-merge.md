# Canonical Daily Merge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Insert a canonical adapt-and-merge layer between `data/raw/` and selection so all sources converge into `data/canonical/<date>.json` as the single stable input for selection and review.

**Architecture:** A new CLI script (`scripts/merge-canonical.mjs`) scans `data/raw/` for source-stamped files, adapts each raw item to a `CanonicalJob` shape, deduplicates by strong source ID and normalized URL keys, and writes `data/canonical/<date>.json`. Selection and the Review UI are updated to consume canonical files instead of raw files. Old raw/selected files are abandoned in place, but existing user annotations must be migrated before the Review UI cutover.

**Tech Stack:** Node.js 22 built-ins only (`node:fs`, `node:path`, `node:test`, `node:assert/strict`). No new npm dependencies.

**Design reference:** `docs/plans/2026-04-25-canonical-daily-merge-design.md`

---

## Field mapping cheatsheet

| Canonical path | LinkedIn raw field |
|---|---|
| `identity.jobId` | `"linkedin:" + item.id` |
| `identity.sourceJobId` | `item.id` |
| `identity.source` | `"linkedin"` |
| `identity.sourceJobUrl` | `item.link` |
| `identity.dedupeKey` | `"source-id:linkedin:" + item.id` |
| `identity.dedupeKeys` | source-id key plus normalized URL key when available |
| `title.raw` | `item.title` |
| `title.normalized` | `item.standardizedTitle` |
| `company.name` | `item.companyName` |
| `company.profileUrl` | `item.companyLinkedinUrl` |
| `company.logoUrl` | `item.companyLogo` |
| `company.industry` | `item.industries` (array → first element or join) |
| `location.raw` | `item.location` |
| `location.city` | first comma-segment of `item.location` |
| `location.state` | second comma-segment |
| `location.country` | `item.country` |
| `location.workplaceType` | see rule below |
| `description.text` | `item.descriptionText` |
| `description.html` | `item.descriptionHtml` |
| `application.jobUrl` | `item.link` |
| `application.applyUrl` | `item.applyUrl` |
| `application.applyMethod` | `item.applyMethod` |
| `employment.seniorityLevel` | `item.seniorityLevel` |
| `employment.employmentType` | `item.employmentType` |
| `employment.jobFunction` | `item.jobFunction` |
| `employment.salaryText` | `item.salary` |
| `employment.benefits` | `item.benefits` |
| `timing.postedAt` | `item.postedAt` |
| `timing.expiresAt` | `item.expireAt` converted to ISO string |
| `timing.collectedAt` | raw file `savedAt` |

**workplaceType rule:**
- `workplaceTypes` contains `"REMOTE"` → `"remote"`
- `workplaceTypes` contains `"HYBRID"` → `"hybrid"`
- `workplaceTypes` contains `"ON_SITE"` → `"on_site"`
- `workplaceTypes` empty or unrecognized → `"unknown"` (do NOT infer from `workRemoteAllowed`)

---

## Task 1: Rename the existing raw file

**Files:**
- Rename: `data/raw/2026-04-25.json` → `data/raw/linkedin-2026-04-25-114234.json`

The time `114234` comes from local `savedAt: "2026-04-25T11:42:34.4948603+02:00"` in the file. Raw filenames use local workflow time, not UTC `startedAt`, because canonical files are grouped by local review date.

**Step 1: Rename**

```powershell
git mv "data/raw/2026-04-25.json" "data/raw/linkedin-2026-04-25-114234.json"
```

**Step 2: Commit**

```bash
git add -A
git commit -m "data: rename raw file to canonical source-date-time convention"
```

---

## Task 2: `scripts/lib/parse-raw-filename.mjs`

Pure function. Parses `<source>-<yyyy-mm-dd>-<hhmmss>.json` → `{ source, date, time }`, or `null` if the name doesn't match.

**Files:**
- Create: `scripts/lib/parse-raw-filename.mjs`
- Create: `scripts/lib/tests/parse-raw-filename.test.mjs`

**Step 1: Write the failing tests**

```js
// scripts/lib/tests/parse-raw-filename.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRawFilename } from "../parse-raw-filename.mjs";

describe("parseRawFilename", () => {
  it("parses a valid linkedin filename", () => {
    assert.deepEqual(parseRawFilename("linkedin-2026-04-25-094105.json"), {
      source: "linkedin",
      date: "2026-04-25",
      time: "094105",
    });
  });

  it("parses a valid stepstone filename", () => {
    assert.deepEqual(parseRawFilename("stepstone-2026-04-25-121045.json"), {
      source: "stepstone",
      date: "2026-04-25",
      time: "121045",
    });
  });

  it("returns null for the old date-only format", () => {
    assert.equal(parseRawFilename("2026-04-25.json"), null);
  });

  it("returns null for a non-json file", () => {
    assert.equal(parseRawFilename("linkedin-2026-04-25-094105.csv"), null);
  });

  it("returns null for a missing time segment", () => {
    assert.equal(parseRawFilename("linkedin-2026-04-25.json"), null);
  });
});
```

**Step 2: Run to confirm they fail**

```powershell
node --test scripts/lib/tests/parse-raw-filename.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` or similar — the lib file doesn't exist yet.

**Step 3: Implement**

```js
// scripts/lib/parse-raw-filename.mjs
export function parseRawFilename(filename) {
  const match = /^([a-z][a-z0-9]*)-(\d{4}-\d{2}-\d{2})-(\d{6})\.json$/.exec(filename);
  if (!match) return null;
  return { source: match[1], date: match[2], time: match[3] };
}
```

**Step 4: Run tests**

```powershell
node --test scripts/lib/tests/parse-raw-filename.test.mjs
```

Expected: all 5 pass.

**Step 5: Commit**

```bash
git add scripts/lib/parse-raw-filename.mjs scripts/lib/tests/parse-raw-filename.test.mjs
git commit -m "feat: add parseRawFilename lib"
```

---

## Task 3: `scripts/lib/adapt-linkedin.mjs`

Pure function. Maps a single LinkedIn raw item + file context → `CanonicalJob`.

**Files:**
- Create: `scripts/lib/adapt-linkedin.mjs`
- Create: `scripts/lib/tests/adapt-linkedin.test.mjs`

**Step 1: Write the failing tests**

```js
// scripts/lib/tests/adapt-linkedin.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptLinkedinItem } from "../adapt-linkedin.mjs";

const RAW_FILE = "data/raw/linkedin-2026-04-25-114234.json";
const COLLECTED_AT = "2026-04-25T11:42:34.000Z";
const RAW_CONTEXT = {
  rawFile: RAW_FILE,
  collectedAt: COLLECTED_AT,
  runId: "aeWWMhq38NBlLwFUf",
  datasetId: "gTibyfv4TVpQQxvVb",
};

const minimalItem = {
  id: "4405313639",
  title: "Masterarbeit KI",
  companyName: "Acme GmbH",
  location: "Berlin, Germany",
  country: "Germany",
  link: "https://de.linkedin.com/jobs/view/4405313639",
  descriptionText: "Some description",
};

describe("adaptLinkedinItem", () => {
  it("generates a stable jobId from source and linkedin id", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.identity.jobId, "linkedin:4405313639");
    assert.equal(job.identity.source, "linkedin");
    assert.equal(job.identity.sourceJobId, "4405313639");
    assert.equal(job.identity.dedupeKey, "source-id:linkedin:4405313639");
    assert.ok(job.identity.dedupeKeys.includes("source-id:linkedin:4405313639"));
  });

  it("adds a normalized URL dedupe key", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, link: "https://de.linkedin.com/jobs/view/4405313639?position=1&trackingId=abc#x" },
      RAW_CONTEXT,
    );
    assert.ok(job.identity.dedupeKeys.some((key) => key.startsWith("url:")));
    assert.equal(job.identity.dedupeKeys.some((key) => key.includes("trackingId")), false);
  });

  it("maps top-level raw run metadata from context and tolerates missing inputUrl", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.identity.sourceRunId, "aeWWMhq38NBlLwFUf");
    assert.equal(job.identity.sourceDatasetId, "gTibyfv4TVpQQxvVb");
    assert.equal(job.identity.sourceInputUrl, undefined);
  });

  it("maps title fields", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, standardizedTitle: "AI Thesis" },
      RAW_CONTEXT,
    );
    assert.equal(job.title.raw, "Masterarbeit KI");
    assert.equal(job.title.normalized, "AI Thesis");
  });

  it("parses location into city and state", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.location.raw, "Berlin, Germany");
    assert.equal(job.location.city, "Berlin");
    assert.equal(job.location.state, "Germany");
    assert.equal(job.location.country, "Germany");
  });

  it("maps workplaceType REMOTE", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, workplaceTypes: ["REMOTE"] },
      RAW_CONTEXT,
    );
    assert.equal(job.location.workplaceType, "remote");
  });

  it("maps workplaceType HYBRID", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, workplaceTypes: ["HYBRID"] },
      RAW_CONTEXT,
    );
    assert.equal(job.location.workplaceType, "hybrid");
  });

  it("maps empty workplaceTypes to unknown, not on_site", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, workplaceTypes: [], workRemoteAllowed: false },
      RAW_CONTEXT,
    );
    assert.equal(job.location.workplaceType, "unknown");
  });

  it("sets collectedAt from context", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.timing.collectedAt, COLLECTED_AT);
  });

  it("converts numeric expireAt to ISO expiresAt", () => {
    const job = adaptLinkedinItem({ ...minimalItem, expireAt: 1779619551000 }, RAW_CONTEXT);
    assert.equal(job.timing.expiresAt, "2026-05-24T10:45:51.000Z");
  });

  it("creates an initial sighting", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.sightings.length, 1);
    assert.equal(job.sightings[0].source, "linkedin");
    assert.equal(job.sightings[0].rawFile, RAW_FILE);
  });

  it("maps description fields", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, descriptionHtml: "<p>text</p>" },
      RAW_CONTEXT,
    );
    assert.equal(job.description.text, "Some description");
    assert.equal(job.description.html, "<p>text</p>");
  });
});
```

**Step 2: Run to confirm they fail**

```powershell
node --test scripts/lib/tests/adapt-linkedin.test.mjs
```

**Step 3: Implement**

```js
// scripts/lib/adapt-linkedin.mjs

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (["refId", "trackingId", "trk", "position", "pageNum"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return String(value ?? "").trim().toLowerCase();
  }
}

function expiresAtIso(value) {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return new Date(value).toISOString();
  return String(value);
}

function parseLocation(raw, country) {
  const parts = String(raw ?? "").split(",").map((p) => p.trim());
  return {
    raw: raw ?? "",
    city: parts[0] || undefined,
    state: parts[1] || undefined,
    country: country || parts[2] || undefined,
  };
}

function mapWorkplaceType(item) {
  const types = (item.workplaceTypes ?? []).map((t) => String(t).toUpperCase());
  if (types.includes("REMOTE")) return "remote";
  if (types.includes("HYBRID")) return "hybrid";
  if (types.includes("ON_SITE")) return "on_site";
  return "unknown";
}

function industryText(industries) {
  if (!industries) return undefined;
  if (Array.isArray(industries)) return industries.join(", ") || undefined;
  return String(industries) || undefined;
}

export function adaptLinkedinItem(item, { rawFile, collectedAt, runId, datasetId }) {
  const sourceJobId = String(item.id ?? "");
  const jobId = `linkedin:${sourceJobId}`;
  const sourceIdDedupeKey = `source-id:${jobId}`;
  const urlDedupeKey = item.link ? `url:${canonicalUrl(item.link)}` : null;
  const loc = parseLocation(item.location, item.country);

  return {
    schemaVersion: 1,
    identity: {
      jobId,
      dedupeKey: sourceIdDedupeKey,
      dedupeKeys: [sourceIdDedupeKey, urlDedupeKey].filter(Boolean),
      source: "linkedin",
      sourceJobId,
      sourceJobUrl: item.link ?? undefined,
      sourceRunId: runId ?? undefined,
      sourceDatasetId: datasetId ?? undefined,
      sourceInputUrl: item.inputUrl ?? undefined,
      rawFile,
    },
    title: {
      raw: item.title ?? "",
      normalized: item.standardizedTitle ?? undefined,
    },
    company: {
      name: item.companyName ?? "",
      profileUrl: item.companyLinkedinUrl ?? undefined,
      logoUrl: item.companyLogo ?? undefined,
      industry: industryText(item.industries),
    },
    location: {
      ...loc,
      workplaceType: mapWorkplaceType(item),
    },
    description: {
      text: item.descriptionText ?? "",
      html: item.descriptionHtml ?? undefined,
    },
    application: {
      jobUrl: item.link ?? undefined,
      applyUrl: item.applyUrl ?? undefined,
      applyMethod: item.applyMethod ?? undefined,
    },
    employment: {
      seniorityLevel: item.seniorityLevel ?? undefined,
      employmentType: item.employmentType ?? undefined,
      jobFunction: item.jobFunction ?? undefined,
      salaryText: item.salary ?? undefined,
      benefits: Array.isArray(item.benefits) && item.benefits.length ? item.benefits : undefined,
    },
    timing: {
      postedAt: item.postedAt ?? undefined,
      expiresAt: expiresAtIso(item.expireAt),
      collectedAt,
    },
    sightings: [
      {
        source: "linkedin",
        rawFile,
        sourceJobId,
        jobUrl: item.link ?? undefined,
        seenAt: collectedAt,
      },
    ],
  };
}
```

**Step 4: Run tests**

```powershell
node --test scripts/lib/tests/adapt-linkedin.test.mjs
```

Expected: all 12 pass.

**Step 5: Commit**

```bash
git add scripts/lib/adapt-linkedin.mjs scripts/lib/tests/adapt-linkedin.test.mjs
git commit -m "feat: add LinkedIn raw → canonical adapter"
```

---

## Task 4: `scripts/lib/canonical-merge.mjs`

Pure function. Merges an array of new `CanonicalJob` objects into an existing canonical daily file structure. Deduplicates by all strong keys in `identity.dedupeKeys`, falling back to `identity.dedupeKey`.

**Files:**
- Create: `scripts/lib/canonical-merge.mjs`
- Create: `scripts/lib/tests/canonical-merge.test.mjs`

**Step 1: Write the failing tests**

```js
// scripts/lib/tests/canonical-merge.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyCanonicalFile, mergeIntoCanonical } from "../canonical-merge.mjs";

function makeJob(id, extra = {}) {
  const sourceKey = `source-id:linkedin:${id}`;
  const urlKey = `url:https://example.com/jobs/${id}`;
  return {
    schemaVersion: 1,
    identity: { jobId: `linkedin:${id}`, dedupeKey: sourceKey, dedupeKeys: [sourceKey, urlKey], source: "linkedin", sourceJobId: id, rawFile: "data/raw/linkedin-2026-04-25-114234.json" },
    title: { raw: `Job ${id}` },
    company: { name: "Acme" },
    location: { raw: "Berlin", workplaceType: "unknown" },
    description: { text: "desc" },
    application: {},
    employment: {},
    timing: { collectedAt: "2026-04-25T11:42:34.000Z" },
    sightings: [{ source: "linkedin", rawFile: "data/raw/linkedin-2026-04-25-114234.json", sourceJobId: id, seenAt: "2026-04-25T11:42:34.000Z" }],
    ...extra,
  };
}

const SOURCE_META = {
  source: "linkedin",
  rawFile: "data/raw/linkedin-2026-04-25-114234.json",
  rawFileTime: "114234",
  importedAt: "2026-04-25T11:00:00.000Z",
  rawCount: 2,
};

describe("emptyCanonicalFile", () => {
  it("creates an empty canonical file for a date", () => {
    const file = emptyCanonicalFile("2026-04-25");
    assert.equal(file.schemaVersion, 1);
    assert.equal(file.date, "2026-04-25");
    assert.deepEqual(file.items, []);
    assert.deepEqual(file.mergeState.processedRawFiles, []);
  });
});

describe("mergeIntoCanonical", () => {
  it("adds new jobs to an empty canonical file", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const jobs = [makeJob("111"), makeJob("222")];
    const result = mergeIntoCanonical(canonical, jobs, SOURCE_META);
    assert.equal(result.items.length, 2);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].addedCount, 2);
    assert.equal(result.sources[0].duplicateCount, 0);
  });

  it("skips a job with a dedupeKey already in the file", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const firstRun = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);

    const secondMeta = { ...SOURCE_META, rawFile: "data/raw/linkedin-2026-04-25-120000.json", rawFileTime: "120000" };
    const result = mergeIntoCanonical(firstRun, [makeJob("111"), makeJob("222")], secondMeta);

    assert.equal(result.items.length, 2);
    assert.equal(result.sources[1].addedCount, 1);
    assert.equal(result.sources[1].duplicateCount, 1);
  });

  it("appends a sighting to an existing job on duplicate", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const firstRun = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    const secondMeta = { ...SOURCE_META, rawFile: "data/raw/linkedin-2026-04-25-120000.json", rawFileTime: "120000" };
    const dupJob = makeJob("111", {
      sightings: [{ source: "linkedin", rawFile: secondMeta.rawFile, sourceJobId: "111", seenAt: "2026-04-25T12:00:00.000Z" }],
    });
    const result = mergeIntoCanonical(firstRun, [dupJob], secondMeta);
    assert.equal(result.items[0].sightings.length, 2);
  });

  it("records processed raw files in mergeState", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const result = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    assert.ok(result.mergeState.processedRawFiles.includes(SOURCE_META.rawFile));
    assert.equal(result.mergeState.lastRawFileTime, "114234");
  });

  it("is idempotent: skips files already in processedRawFiles", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const first = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    const second = mergeIntoCanonical(first, [makeJob("111")], SOURCE_META);
    assert.equal(second.items.length, 1);
    assert.equal(second.sources.length, 1);
  });

  it("deduplicates by normalized URL key even when source ids differ", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const first = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    const secondMeta = { ...SOURCE_META, rawFile: "data/raw/linkedin-2026-04-25-120000.json", rawFileTime: "120000" };
    const sameUrlDifferentId = makeJob("999", {
      identity: {
        jobId: "linkedin:999",
        dedupeKey: "source-id:linkedin:999",
        dedupeKeys: ["source-id:linkedin:999", "url:https://example.com/jobs/111"],
        source: "linkedin",
        sourceJobId: "999",
        rawFile: secondMeta.rawFile,
      },
    });
    const result = mergeIntoCanonical(first, [sameUrlDifferentId], secondMeta);
    assert.equal(result.items.length, 1);
    assert.equal(result.sources[1].duplicateCount, 1);
    assert.ok(result.items[0].identity.dedupeKeys.includes("source-id:linkedin:999"));
  });
});
```

**Step 2: Run to confirm they fail**

```powershell
node --test scripts/lib/tests/canonical-merge.test.mjs
```

**Step 3: Implement**

```js
// scripts/lib/canonical-merge.mjs

export function emptyCanonicalFile(date) {
  return {
    schemaVersion: 1,
    date,
    updatedAt: new Date().toISOString(),
    mergeState: {
      lastRawFileTime: undefined,
      processedRawFiles: [],
    },
    sources: [],
    items: [],
  };
}

export function mergeIntoCanonical(canonicalFile, newJobs, sourceMeta) {
  const { rawFile, rawFileTime, source, importedAt, rawCount } = sourceMeta;

  // idempotency guard
  if (canonicalFile.mergeState.processedRawFiles.includes(rawFile)) {
    return canonicalFile;
  }

  const existingByDedupeKey = new Map();
  for (const job of canonicalFile.items) {
    for (const key of job.identity.dedupeKeys ?? [job.identity.dedupeKey]) {
      existingByDedupeKey.set(key, job);
    }
  }

  let addedCount = 0;
  let duplicateCount = 0;
  const nextItems = [...canonicalFile.items];

  for (const job of newJobs) {
    const keys = job.identity.dedupeKeys ?? [job.identity.dedupeKey];
    const existing = keys.map((key) => existingByDedupeKey.get(key)).find(Boolean);
    if (existing) {
      // preserve existing canonical fields; append new sightings and remember all strong keys
      const index = nextItems.indexOf(existing);
      const mergedKeys = [...new Set([
        ...(existing.identity.dedupeKeys ?? [existing.identity.dedupeKey]),
        ...keys,
      ])];
      nextItems[index] = {
        ...existing,
        identity: {
          ...existing.identity,
          dedupeKeys: mergedKeys,
        },
        sightings: [...existing.sightings, ...job.sightings],
      };
      for (const key of mergedKeys) existingByDedupeKey.set(key, nextItems[index]);
      duplicateCount++;
    } else {
      nextItems.push(job);
      for (const key of keys) existingByDedupeKey.set(key, job);
      addedCount++;
    }
  }

  const processedRawFiles = [...canonicalFile.mergeState.processedRawFiles, rawFile];
  const lastRawFileTime =
    !canonicalFile.mergeState.lastRawFileTime ||
    rawFileTime > canonicalFile.mergeState.lastRawFileTime
      ? rawFileTime
      : canonicalFile.mergeState.lastRawFileTime;

  return {
    ...canonicalFile,
    updatedAt: new Date().toISOString(),
    mergeState: { lastRawFileTime, processedRawFiles },
    sources: [
      ...canonicalFile.sources,
      { source, rawFile, rawFileTime, importedAt, rawCount, addedCount, duplicateCount },
    ],
    items: nextItems,
  };
}
```

**Step 4: Run tests**

```powershell
node --test scripts/lib/tests/canonical-merge.test.mjs
```

Expected: all 6 pass.

**Step 5: Commit**

```bash
git add scripts/lib/canonical-merge.mjs scripts/lib/tests/canonical-merge.test.mjs
git commit -m "feat: add canonical merge lib"
```

---

## Task 5: `scripts/merge-canonical.mjs`

CLI script. Orchestrates parse → adapt → merge → write.

**Files:**
- Create: `scripts/merge-canonical.mjs`

Usage:
```
node scripts/merge-canonical.mjs [date]
```

If `date` is omitted, processes the latest date found in `data/raw/`.

**Step 1: Implement**

```js
// scripts/merge-canonical.mjs
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

  if (lastRawFileTime && time <= lastRawFileTime) {
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
```

**Step 2: Run the script against the renamed raw file**

```powershell
node scripts/merge-canonical.mjs 2026-04-25
```

Expected output: `totalItems: 50`, one file entry with `rawCount: 50`.

Verify the output file exists:

```powershell
node -e "const f=JSON.parse(require('fs').readFileSync('data/canonical/2026-04-25.json','utf8')); console.log(f.items.length, f.items[0].identity.jobId)"
```

Expected: `50  linkedin:...`

**Step 3: Commit**

```bash
git add scripts/merge-canonical.mjs data/canonical/
git commit -m "feat: add merge-canonical script; generate initial canonical file"
```

---

## Task 6: Update `config/preferences.linkedin.json`

Update `fields` arrays to use canonical dot-notation paths.

**Files:**
- Modify: `config/preferences.linkedin.json`

**Step 1: Replace field names**

Replace the entire file content. Key changes:
- `"title"` → `"title.raw"`
- `"standardizedTitle"` → `"title.normalized"`
- `"descriptionText"` → `"description.text"`
- `"descriptionHtml"` → `"description.html"`
- `"companyName"` → `"company.name"`
- `"location"` → `"location.raw"`
- `"industries"` → `"company.industry"`
- `"jobFunction"` → `"employment.jobFunction"`
- `"seniorityLevel"` → `"employment.seniorityLevel"`
- `"benefits"` → `"employment.benefits"`

New file:

```json
{
  "version": 1,
  "description": "LinkedIn job preference rules. Edit this file to tune data/selected/*.json without re-running Apify.",
  "rules": {
    "must": [
      {
        "id": "thesis_in_title",
        "description": "The job title should be a thesis/final-project style role.",
        "fields": ["title.raw", "title.normalized"],
        "terms": [
          "硕士毕业设计",
          "硕士论文",
          "masterarbeit",
          "abschlussarbeit",
          "master thesis",
          "master's thesis",
          "msc thesis",
          "m.sc. thesis"
        ]
      },
      {
        "id": "ai_related",
        "description": "The job content should mention AI, ML, data science, LLMs, or closely related topics.",
        "fields": [
          "title.raw",
          "title.normalized",
          "description.text",
          "description.html",
          "company.name",
          "location.raw",
          "company.industry",
          "employment.jobFunction",
          "employment.seniorityLevel",
          "employment.benefits"
        ],
        "terms": [
          "AI",
          "KI",
          "artificial intelligence",
          "künstliche intelligenz",
          "kuenstliche intelligenz",
          "machine learning",
          "ML",
          "deep learning",
          "generative AI",
          "GenAI",
          "LLM",
          "large language model",
          "natural language processing",
          "NLP",
          "computer vision",
          "data science",
          "neural network",
          "modellentwicklung"
        ]
      }
    ],
    "exclude": [
      {
        "id": "not_obvious_exclusion_yet",
        "description": "Keep empty until false positives are reviewed.",
        "fields": ["title.raw", "description.text"],
        "terms": []
      }
    ]
  }
}
```

**Step 2: Commit**

```bash
git add config/preferences.linkedin.json
git commit -m "config: update preference field paths to canonical dot-notation"
```

---

## Task 7: Update `scripts/select-jobs.mjs`

Two changes: (1) support dot-notation field paths in `pickFields`; (2) consume the canonical file structure and use `identity.jobId` as the stable ID.

**Files:**
- Modify: `scripts/select-jobs.mjs`

**Step 1: Update `pickFields` to support dot-notation**

Replace the `pickFields` function:

```js
function getField(obj, dotPath) {
  return dotPath.split(".").reduce((curr, key) => curr?.[key], obj);
}

function pickFields(item, fields) {
  return fields.map((field) => toText(getField(item, field))).filter(Boolean).join("\n");
}
```

**Step 2: Update stable ID extraction**

Replace this line near the bottom:

```js
// OLD:
const selectedIds = selected.map(({ item }) => item.id ?? item.sourceJobId ?? item.link ?? item.url);
const previousIds = (previousOutput?.items ?? []).map((item) => item.id ?? item.sourceJobId ?? item.link ?? item.url);
```

With:

```js
// NEW:
function stableId(item) {
  return item.identity?.jobId ?? item.id ?? item.sourceJobId ?? item.link ?? item.url;
}
const selectedIds = selected.map(({ item }) => stableId(item));
const previousIds = (previousOutput?.items ?? []).map(stableId);
```

**Step 3: Update the output metadata**

The output object currently copies source/taskId/runId/etc. from the raw file. Canonical files don't have these at the top level. Replace the output object:

```js
// OLD:
const output = {
  source: raw.source,
  taskId: raw.taskId,
  taskName: raw.taskName,
  runId: raw.runId,
  datasetId: raw.datasetId,
  savedAt: selectionUnchanged ? previousOutput.savedAt : new Date().toISOString(),
  preferencesFile: path.relative(process.cwd(), preferencesPath),
  preferencesVersion: preferences.version,
  rawCount: raw.items?.length ?? raw.count ?? 0,
  selectedCount: selected.length,
  items: selected.map(({ item, match }) => ({ ...item, _selection: match })),
};

// NEW:
const output = {
  schemaVersion: raw.schemaVersion ?? 1,
  date: raw.date,
  savedAt: selectionUnchanged ? previousOutput.savedAt : new Date().toISOString(),
  preferencesFile: path.relative(process.cwd(), preferencesPath),
  preferencesVersion: preferences.version,
  rawCount: raw.items?.length ?? 0,
  selectedCount: selected.length,
  items: selected.map(({ item, match }) => ({ ...item, _selection: match })),
};
```

**Step 4: Run selection against the canonical file**

```powershell
node scripts/select-jobs.mjs data/canonical/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
```

Expected: `selectedCount` of roughly 8. Inspect a selected item to confirm it has canonical structure (e.g., `items[0].title.raw` exists).

```powershell
node -e "const f=JSON.parse(require('fs').readFileSync('data/selected/2026-04-25.json','utf8')); console.log(f.selectedCount, f.items[0]?.title?.raw)"
```

**Step 5: Commit**

```bash
git add scripts/select-jobs.mjs data/selected/
git commit -m "feat: update select-jobs to consume canonical file and dot-notation fields"
```

---

## Task 7.5: Migrate existing annotations to canonical IDs

Existing annotation files are source-suffixed and use bare source IDs, for example `data/annotations/2026-04-25.linkedin.json` with `id: "4405313639"`. Before the server starts reading `data/annotations/<date>.json`, migrate those IDs to canonical `jobId` values such as `linkedin:4405313639`.

**Files:**
- Create: `scripts/migrate-annotations-canonical.mjs`
- Optional local output, not committed: `data/annotations/2026-04-25.json`

**Step 1: Implement the migration script**

```js
// scripts/migrate-annotations-canonical.mjs
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
    const next = {
      ...item,
      id: canonicalAnnotationId(source, item.id),
    };
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
```

**Step 2: Run migration**

```powershell
node scripts/migrate-annotations-canonical.mjs
```

Expected for the current data: one migrated file from `2026-04-25.linkedin.json` to `2026-04-25.json`, with 2 migrated items.

**Step 3: Verify existing labels use canonical IDs**

```powershell
node -e "const f=JSON.parse(require('fs').readFileSync('data/annotations/2026-04-25.json','utf8')); console.log(f.items.map(i=>i.id).join('\\n'))"
```

Expected:

```text
linkedin:4303346866
linkedin:4405313639
```

Do not commit `data/annotations/2026-04-25.json`; annotation files are local runtime state.

**Step 4: Commit the migration script**

```bash
git add scripts/migrate-annotations-canonical.mjs
git commit -m "feat: add annotation migration to canonical ids"
```

---

## Task 8: Update `app/server.mjs`

Replace all raw-file references with canonical-file references. Update jobId/field accessors for canonical items. Remove source suffix from annotation paths.

**Files:**
- Modify: `app/server.mjs`

**Step 1: Add `canonicalDir` constant**

After the existing `selectedDir` line (around line 14), add:

```js
const canonicalDir = path.join(dataDir, "canonical");
```

**Step 2: Update `annotationPath` — remove source suffix**

```js
// OLD:
function annotationPath(date, source) {
  return path.join(annotationsDir, `${date}.${source}.json`);
}

// NEW:
function annotationPath(date) {
  return path.join(annotationsDir, `${date}.json`);
}
```

Update the two call sites that pass `source` as second argument (in `loadReviewState` and `upsertAnnotation`) — remove the `source` argument.

**Step 3: Update `safeJobId` to prefer canonical jobId**

```js
// OLD:
function safeJobId(item) {
  return String(item?.id ?? item?.sourceJobId ?? item?.link ?? item?.url ?? "");
}

// NEW:
function safeJobId(item) {
  return String(item?.identity?.jobId ?? item?.id ?? item?.sourceJobId ?? item?.link ?? item?.url ?? "");
}
```

**Step 4: Update `jobKey` to prefer canonical jobId**

```js
// OLD:
function jobKey(source, item) {
  if (item?.id) return `${source}:${item.id}`;
  if (item?.sourceJobId) return `${source}:${item.sourceJobId}`;
  if (item?.link || item?.url) return `${source}:url:${canonicalUrl(item.link ?? item.url)}`;
  return `${source}:text:${normalizeText(item.companyName)}|${normalizeText(item.title)}|${normalizeText(item.location)}`;
}

// NEW:
function jobKey(source, item) {
  if (item?.identity?.jobId) return item.identity.jobId;
  if (item?.id) return `${source}:${item.id}`;
  if (item?.sourceJobId) return `${source}:${item.sourceJobId}`;
  if (item?.link || item?.url) return `${source}:url:${canonicalUrl(item.link ?? item.url)}`;
  return `${source}:text:${normalizeText(item.companyName)}|${normalizeText(item.title)}|${normalizeText(item.location)}`;
}
```

**Step 5: Update `acceptedJobFromItem` — map canonical fields**

```js
// OLD:
function acceptedJobFromItem(source, item, context) {
  return {
    jobKey: jobKey(source, item),
    source,
    sourceJobId: safeJobId(item),
    title: item.title ?? null,
    companyName: item.companyName ?? null,
    location: item.location ?? null,
    link: item.link ?? item.url ?? null,
    applyUrl: item.applyUrl ?? null,
    firstSeenAt: context.now,
    acceptedAt: context.now,
    rawFile: context.rawFile,
    annotationFile: context.annotationFile,
  };
}

// NEW:
function acceptedJobFromItem(source, item, context) {
  const isCanonical = Boolean(item?.identity?.jobId);
  return {
    jobKey: jobKey(source, item),
    source: isCanonical ? item.identity.source : source,
    sourceJobId: safeJobId(item),
    title: isCanonical ? (item.title?.raw ?? null) : (item.title ?? null),
    companyName: isCanonical ? (item.company?.name ?? null) : (item.companyName ?? null),
    location: isCanonical ? (item.location?.raw ?? null) : (item.location ?? null),
    link: isCanonical ? (item.application?.jobUrl ?? null) : (item.link ?? item.url ?? null),
    applyUrl: isCanonical ? (item.application?.applyUrl ?? null) : (item.applyUrl ?? null),
    firstSeenAt: context.now,
    acceptedAt: context.now,
    canonicalFile: context.canonicalFile,
    annotationFile: context.annotationFile,
  };
}
```

**Step 6: Replace `latestRawFile` with `latestCanonicalFile`**

```js
// Remove latestRawFile entirely; replace with:
function latestCanonicalFile() {
  const files = fs.existsSync(canonicalDir) ? fs.readdirSync(canonicalDir) : [];
  const latestName = files
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .at(-1);
  return latestName ? path.join(canonicalDir, latestName) : null;
}
```

**Step 7: Update `loadReviewState`**

Replace the function. Key changes: load from canonical instead of raw; annotation path without source.

```js
function loadReviewState(options) {
  const { batchId, source, canonicalFile, selectedFile } = options;
  const latest = canonicalFile ? null : latestCanonicalFile();
  const canonicalPath = canonicalFile
    ? resolveDataFile(canonicalFile, canonicalDir)
    : batchId
    ? path.join(canonicalDir, `${batchId}.json`)
    : latest;

  if (!canonicalPath) {
    const error = new Error("No canonical files found");
    error.statusCode = 404;
    throw error;
  }

  const effectiveBatchId = batchId ?? path.basename(canonicalPath, ".json");
  const selectedPath = selectedFile
    ? resolveDataFile(selectedFile, selectedDir)
    : path.join(selectedDir, `${effectiveBatchId}.json`);
  const annotationsPath = annotationPath(effectiveBatchId);
  const accepted = loadAcceptedJobs();
  const acceptedKeys = new Set((accepted.items ?? []).map((item) => item.jobKey));

  const canonical = readJson(canonicalPath);
  if (!canonical) {
    const error = new Error(`Missing canonical file: ${path.relative(rootDir, canonicalPath)}`);
    error.statusCode = 404;
    throw error;
  }

  const selected = readJson(selectedPath, { items: [] });
  const annotationFile = readAnnotationFile(annotationsPath, effectiveBatchId, source);
  const annotationMap = annotationsById(annotationFile);
  const selectedIds = new Set((selected.items ?? []).map(safeJobId));
  const canonicalItems = canonical.items ?? [];

  function withReviewMeta(item) {
    const key = jobKey(source, item);
    return { ...item, _reviewMeta: { jobKey: key, duplicateAccepted: acceptedKeys.has(key) } };
  }

  const selectedItems = (selected.items ?? [])
    .filter((item) => annotationMap[safeJobId(item)]?.decision !== "reject")
    .map(withReviewMeta)
    .filter((item) => !item._reviewMeta.duplicateAccepted);
  const rejectedItems = canonicalItems
    .filter((item) => !selectedIds.has(safeJobId(item)) || annotationMap[safeJobId(item)]?.decision === "reject")
    .map(withReviewMeta)
    .filter((item) => !item._reviewMeta.duplicateAccepted);
  const duplicateAccepted = canonicalItems.filter((item) => acceptedKeys.has(jobKey(source, item))).length;

  return {
    date: effectiveBatchId,
    batchId: effectiveBatchId,
    source,
    files: {
      canonical: path.relative(rootDir, canonicalPath).replaceAll(path.sep, "/"),
      selected: path.relative(rootDir, selectedPath).replaceAll(path.sep, "/"),
      annotations: path.relative(rootDir, annotationsPath).replaceAll(path.sep, "/"),
    },
    counts: {
      selected: selectedItems.length,
      rejected: rejectedItems.length,
      duplicateAccepted,
      annotations: Object.keys(annotationMap).length,
    },
    items: { selected: selectedItems, rejected: rejectedItems },
    annotations: annotationMap,
  };
}
```

**Step 8: Update `resolvePayloadFiles`**

```js
// OLD:
function resolvePayloadFiles(payload) {
  const rawPath = payload.rawFile
    ? resolveDataFile(payload.rawFile, rawDir)
    : path.join(rawDir, `${payload.date}.json`);
  const selectedPath = payload.selectedFile
    ? resolveDataFile(payload.selectedFile, selectedDir)
    : path.join(selectedDir, `${batchIdFromFile(rawPath)}.json`);
  return {
    rawPath,
    selectedPath,
    rawFile: relativeDataPath(rawPath),
    selectedFile: relativeDataPath(selectedPath),
  };
}

// NEW:
function resolvePayloadFiles(payload) {
  const canonicalPath = payload.canonicalFile
    ? resolveDataFile(payload.canonicalFile, canonicalDir)
    : path.join(canonicalDir, `${payload.date}.json`);
  const selectedPath = payload.selectedFile
    ? resolveDataFile(payload.selectedFile, selectedDir)
    : path.join(selectedDir, `${payload.date}.json`);
  return {
    canonicalPath,
    selectedPath,
    canonicalFile: relativeDataPath(canonicalPath),
    selectedFile: relativeDataPath(selectedPath),
  };
}
```

**Step 9: Update `findJobForAnnotation`**

```js
// OLD:
function findJobForAnnotation(payload) {
  const files = resolvePayloadFiles(payload);
  const selected = readJson(files.selectedPath, { items: [] });
  const raw = readJson(files.rawPath, { items: [] });
  const id = String(payload.id);
  const item = [...(selected.items ?? []), ...(raw.items ?? [])].find((candidate) => safeJobId(candidate) === id);
  ...
}

// NEW:
function findJobForAnnotation(payload) {
  const files = resolvePayloadFiles(payload);
  const selected = readJson(files.selectedPath, { items: [] });
  const canonical = readJson(files.canonicalPath, { items: [] });
  const id = String(payload.id);
  const item = [...(selected.items ?? []), ...(canonical.items ?? [])].find((candidate) => safeJobId(candidate) === id);
  if (!item) {
    const error = new Error(`Job not found for accepted annotation: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  return { item, files };
}
```

**Step 10: Update `upsertAcceptedApplication` — pass `canonicalFile`**

In the call to `upsertAcceptedApplication` inside `upsertAnnotation`, change `context.rawFile` to `context.canonicalFile`:

```js
// In upsertAnnotation, replace:
upsertAcceptedApplication(payload, { now, annotationFile: annotationFilePath });

// The context object passed inside upsertAcceptedApplication needs canonicalFile.
// Change the acceptedJobFromItem call within upsertAcceptedApplication:
const acceptedJob = acceptedJobFromItem(payload.source, item, {
  now: context.now,
  canonicalFile: files.canonicalFile,   // was: rawFile: files.rawFile
  annotationFile: context.annotationFile,
});
```

**Step 11: Update `upsertAnnotation` — remove rawFile/selectedFile dependency**

```js
// In upsertAnnotation, change annotationPath call:
// OLD: const filePath = annotationPath(date, source);
// NEW:
const filePath = annotationPath(date);
```

Also update the `nextFile` object (remove rawFile/selectedFile fields from annotation metadata):

```js
// OLD:
const nextFile = {
  source,
  rawFile: files.rawFile,
  selectedFile: files.selectedFile,
  createdAt: annotationFile.createdAt ?? now,
  updatedAt: now,
  items,
};

// NEW:
const nextFile = {
  date,
  createdAt: annotationFile.createdAt ?? now,
  updatedAt: now,
  items,
};
```

**Step 12: Update `readAnnotationFile` — simplify the default object**

```js
// OLD default object:
return readJson(filePath, {
  source,
  rawFile: `data/raw/${date}.json`,
  selectedFile: `data/selected/${date}.json`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  items: [],
});

// NEW:
return readJson(filePath, {
  date,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  items: [],
});
```

Update the recovery path in the same function to use the same simplified structure.

**Step 13: Update the `/api/state` handler**

```js
// OLD:
if (req.method === "GET" && url.pathname === "/api/state") {
  const source = url.searchParams.get("source") ?? "linkedin";
  const rawFile = url.searchParams.get("rawFile");
  const selectedFile = url.searchParams.get("selectedFile");
  const latest = rawFile ? null : latestRawFile();
  const batchId = url.searchParams.get("batch") ?? url.searchParams.get("date") ?? (latest ? batchIdFromFile(latest) : null);
  if (!batchId && !rawFile) {
    sendError(res, 404, "No raw batches found");
    return;
  }
  sendJson(res, 200, loadReviewState({ batchId, source, rawFile, selectedFile }));
  return;
}

// NEW:
if (req.method === "GET" && url.pathname === "/api/state") {
  const source = url.searchParams.get("source") ?? "linkedin";
  const canonicalFile = url.searchParams.get("canonicalFile");
  const selectedFile = url.searchParams.get("selectedFile");
  const batchId = url.searchParams.get("batch") ?? url.searchParams.get("date") ?? null;
  sendJson(res, 200, loadReviewState({ batchId, source, canonicalFile, selectedFile }));
  return;
}
```

**Step 14: Commit**

```bash
git add app/server.mjs
git commit -m "feat: update server to consume canonical files; date-keyed annotations"
```

---

## Task 9: Update `app/public/app.js`

Update all field accesses from flat LinkedIn fields to canonical nested paths. Also switch URL params from `rawFile` to `canonicalFile`.

**Files:**
- Modify: `app/public/app.js`

**Step 1: Update `state` object and `loadState`**

```js
// In the state object, replace:
rawFile: params.get("rawFile"),
// with:
canonicalFile: params.get("canonicalFile"),
```

In `loadState`:
```js
// OLD:
if (state.rawFile) query.set("rawFile", state.rawFile);
// NEW:
if (state.canonicalFile) query.set("canonicalFile", state.canonicalFile);
```

**Step 2: Update `jobId` function**

```js
// OLD:
function jobId(job) {
  return String(job.id ?? job.sourceJobId ?? job.link ?? job.url ?? "");
}
// NEW:
function jobId(job) {
  return String(job.identity?.jobId ?? job.id ?? job.sourceJobId ?? job.link ?? job.url ?? "");
}
```

**Step 3: Update `renderDescriptionBody`**

```js
// OLD:
if (job.descriptionHtml) { ... }
else if (job.descriptionText) { body.textContent = String(job.descriptionText).trim(); }

// NEW:
const html = job.description?.html ?? job.descriptionHtml;
const txt = job.description?.text ?? job.descriptionText;
if (html) {
  // same DOMParser logic, just use `html` variable instead of `job.descriptionHtml`
} else if (txt) {
  body.textContent = String(txt).trim();
} else { ... }
```

**Step 4: Update `renderJobCard`**

```js
// OLD:
titleBlock.append(createEl("h2", null, text(job.title, "Untitled")));
titleBlock.append(createEl("p", "meta", [job.companyName, job.location, job.postedAt].filter(Boolean).join(" · ")));
// ...
if (job.link) links.append(renderLink("LinkedIn", job.link));
if (job.applyUrl) links.append(renderLink("Apply", job.applyUrl));

// NEW:
titleBlock.append(createEl("h2", null, text(job.title?.raw, "Untitled")));
titleBlock.append(createEl("p", "meta", [job.company?.name, job.location?.raw, job.timing?.postedAt].filter(Boolean).join(" · ")));
// ...
if (job.application?.jobUrl) links.append(renderLink("LinkedIn", job.application.jobUrl));
if (job.application?.applyUrl) links.append(renderLink("Apply", job.application.applyUrl));
```

**Step 5: Update `jobFilterOptions`**

```js
// OLD:
const location = locationParts(job.location);
if (job.companyName) companies.set(normalizeOption(job.companyName), job.companyName);

// NEW:
const rawLocation = job.location?.raw ?? job.location;
const location = locationParts(rawLocation);
const companyName = job.company?.name ?? job.companyName;
if (companyName) companies.set(normalizeOption(companyName), companyName);
```

**Step 6: Update `filteredReviewItems`**

```js
// OLD:
return baseReviewItems().filter((job) => {
  const parts = locationParts(job.location);
  return jobFilterMatches(job, parts, state.reviewCities, state.reviewStates, state.reviewCompanies);
});

// NEW:
return baseReviewItems().filter((job) => {
  const parts = locationParts(job.location?.raw ?? job.location);
  const companyName = job.company?.name ?? job.companyName;
  return jobFilterMatches({ companyName }, parts, state.reviewCities, state.reviewStates, state.reviewCompanies);
});
```

Also update `jobFilterMatches` to accept a `companyName` property from the first argument:

```js
function jobFilterMatches(job, parts, cities, states, companies) {
  const city = normalizeOption(parts.city);
  const region = normalizeOption(parts.state);
  const company = normalizeOption(job.companyName ?? job.company?.name);
  return (!cities.length || cities.includes(city))
    && (!states.length || states.includes(region))
    && (!companies.length || companies.includes(company));
}
```

**Step 7: Update `saveAnnotation` — remove file paths from payload**

```js
// OLD:
const payload = {
  date: state.date,
  source: state.source,
  rawFile: state.data.files.raw,
  selectedFile: state.data.files.selected,
  id,
  ...
};

// NEW:
const payload = {
  date: state.date,
  source: state.source,
  id,
  decision: patch.decision ?? existing.decision,
  note: patch.note ?? existing.note ?? "",
  tags: patch.tags ?? existing.tags ?? [],
};
```

**Step 8: Commit**

```bash
git add app/public/app.js
git commit -m "feat: update Review UI to use canonical job field paths"
```

---

## Task 10: Update `scripts/start-review.mjs`

Switch from scanning `data/raw/` to scanning `data/canonical/`. Pass `canonicalFile` instead of `rawFile` in the URL.

**Files:**
- Modify: `scripts/start-review.mjs`

**Step 1: Replace `latestRawFile` with `latestCanonicalFile`**

```js
// OLD:
function latestRawFile() {
  const rawDir = path.join(rootDir, "data", "raw");
  if (!fs.existsSync(rawDir)) return null;
  const latest = fs.readdirSync(rawDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}(?:-\d{4})?\.json$/.test(name))
    .sort()
    .at(-1);
  return latest ? path.join(rawDir, latest) : null;
}

// NEW:
function latestCanonicalFile() {
  const canonicalDir = path.join(rootDir, "data", "canonical");
  if (!fs.existsSync(canonicalDir)) return null;
  const latest = fs.readdirSync(canonicalDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .at(-1);
  return latest ? path.join(canonicalDir, latest) : null;
}
```

**Step 2: Update the main script body**

The script currently accepts a raw file path as its positional arg. Update to accept a date or canonical file path, and skip the auto-selection step (canonical file already has all sources merged).

```js
// Replace from the rawArg/rawPath block onwards:
const dateArg = args.find((arg) => !arg.startsWith("-"));

const canonicalPath = dateArg
  ? path.resolve(rootDir, "data", "canonical", `${dateArg}.json`)
  : latestCanonicalFile();

if (!canonicalPath || !fs.existsSync(canonicalPath)) {
  console.error(dateArg ? `Canonical file not found for date: ${dateArg}` : "No data/canonical/*.json files found. Run: node scripts/merge-canonical.mjs");
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
url.searchParams.set("source", source);
url.searchParams.set("batch", batchId);
url.searchParams.set("canonicalFile", fileUrlParam(canonicalPath));
url.searchParams.set("selectedFile", fileUrlParam(selectedPath));
```

**Step 3: Commit**

```bash
git add scripts/start-review.mjs
git commit -m "feat: update start-review to use canonical files"
```

---

## Task 11: End-to-end verification

Run the full pipeline from scratch and verify each stage.

**Step 1: Re-generate the canonical file**

```powershell
node scripts/merge-canonical.mjs 2026-04-25
```

Expected: `totalItems: 50`.

**Step 2: Re-generate selected**

```powershell
node scripts/select-jobs.mjs data/canonical/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
```

Expected: `selectedCount` ≥ 1. Spot-check that `items[0].title.raw` and `items[0].identity.jobId` are populated.

**Step 3: Start the server**

```powershell
node scripts/start-review.mjs --no-open
```

**Step 4: Verify Review UI loads**

Open `http://127.0.0.1:4173/` in a browser and check:
- Selected tab shows job cards with titles, companies, and locations.
- Rejected tab shows the remaining jobs.
- Previously migrated annotations are honored: `linkedin:4303346866` and `linkedin:4405313639` should not reappear as unreviewed.
- Accept/Reject/Maybe buttons work and the annotation persists after page refresh.
- `data/annotations/2026-04-25.json` (no source suffix) is created.
- Accepted jobs appear in the Dashboard view.
- Dashboard Reject moves a job out of the accepted list and writes the annotation.

**Step 4.5: Verify incremental merge skips old raw files**

Run merge a second time with no newer raw files:

```powershell
node scripts/merge-canonical.mjs 2026-04-25
```

Expected: existing files are skipped with `not newer than canonical watermark` or `already processed`, and `totalItems` remains unchanged.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: end-to-end verification complete — canonical pipeline live"
```
