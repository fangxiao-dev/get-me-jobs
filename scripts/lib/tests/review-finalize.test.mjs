import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { finalizeReviewBatch } from "../review-finalize.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rawItem(id, title) {
  return {
    id,
    title,
    companyName: "Acme GmbH",
    location: "Berlin, Germany",
    country: "Germany",
    link: `https://www.linkedin.com/jobs/view/${id}/`,
    descriptionText: "Masterarbeit about AI and machine learning.",
    inputUrl: `https://www.linkedin.com/jobs/view/${id}/`,
  };
}

function createRoot({ enrichSelected = true } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-finalize-"));
  writeJson(path.join(rootDir, "config", "job-sources.manifest.json"), {
    version: 1,
    channels: {
      apify_linkedin: { enabled: true, envFile: ".env", taskEnvPrefix: "TASKID_" },
      localLinkedin: { enabled: true, inputFile: "config/local/linkedin-assisted.input.json" },
    },
    review: { preferencesFile: "config/preferences.linkedin.json", enrichSelected },
  });
  writeJson(path.join(rootDir, "config", "preferences.linkedin.json"), {
    version: 1,
    rules: {
      must: [
        { id: "thesis", fields: ["title.raw", "description.text"], terms: ["masterarbeit"] },
        { id: "ai", fields: ["title.raw", "description.text"], terms: ["AI"] },
      ],
      exclude: [],
    },
  });
  writeJson(path.join(rootDir, "data", "raw", "linkedin-2026-05-07-090000.json"), {
    source: "linkedin",
    savedAt: "2026-05-07T09:00:00.000Z",
    count: 1,
    items: [rawItem("4400000001", "Masterarbeit AI One")],
  });
  writeJson(path.join(rootDir, "data", "raw", "linkedin-2026-05-07-170000.json"), {
    source: "linkedin",
    savedAt: "2026-05-07T17:00:00.000Z",
    count: 1,
    items: [rawItem("4400000002", "Masterarbeit AI Two")],
  });
  return rootDir;
}

test("finalizeReviewBatch merges multiple raw files, selects jobs, and enriches selected jobs", () => {
  const rootDir = createRoot({ enrichSelected: true });
  const enrichCalls = [];

  const result = finalizeReviewBatch("2026-05-07", {
    rootDir,
    enrichSelectedJobs: (selectedFile) => {
      enrichCalls.push(selectedFile);
      return { enriched: 2, skipped: 0, failed: 0, enrichmentFile: "data/enrichments/2026-05-07.json" };
    },
  });

  const canonical = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "canonical", "2026-05-07.json"), "utf8"));
  const selected = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "selected", "2026-05-07.json"), "utf8"));

  assert.equal(canonical.items.length, 2);
  assert.equal(selected.items.length, 2);
  assert.equal(result.canonicalItems, 2);
  assert.equal(result.selectedCount, 2);
  assert.equal(result.enrichment.enriched, 2);
  assert.deepEqual(enrichCalls, ["data/selected/2026-05-07.json"]);
});

test("finalizeReviewBatch skips enrichment when manifest disables it", () => {
  const rootDir = createRoot({ enrichSelected: false });
  let enrichCalled = false;

  const result = finalizeReviewBatch("2026-05-07", {
    rootDir,
    enrichSelectedJobs: () => {
      enrichCalled = true;
      return {};
    },
  });

  assert.equal(enrichCalled, false);
  assert.equal(result.enrichment.skipped, true);
  assert.equal(result.enrichment.reason, "disabled_by_manifest");
});
