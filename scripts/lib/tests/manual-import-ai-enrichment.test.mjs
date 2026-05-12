import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  dashboardEnrichmentDatesForJob,
  readDashboardEnrichments,
  upsertManualImportAiEnrichment,
} from "../manual-import-ai-enrichment.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "manual-import-ai-"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("manual import AI enrichment writes today's enrichment keyed by jobKey", async () => {
  const rootDir = tempRoot();

  const result = await upsertManualImportAiEnrichment({
    rootDir,
    job: {
      jobKey: "stepstone:13904121",
      title: "Embedded Systems Thesis",
      description: { text: "Linux, Qt, C++ and Python tasks." },
    },
    now: "2026-05-08T10:00:00.000Z",
    analyze: async ({ title, descriptionText }) => ({
      aufgaben: `analyze ${title}`,
      techReqs: descriptionText.includes("Qt") ? "Linux, Qt, C++" : "unknown",
    }),
  });

  assert.deepEqual(result, {
    ok: true,
    enrichmentFile: "data/enrichments/2026-05-08.json",
    jobKey: "stepstone:13904121",
  });
  const stored = readJson(path.join(rootDir, "data", "enrichments", "2026-05-08.json"));
  assert.equal(stored["stepstone:13904121"].aufgaben, "analyze Embedded Systems Thesis");
  assert.equal(stored["stepstone:13904121"].techReqs, "Linux, Qt, C++");
  assert.equal(typeof stored["stepstone:13904121"].enrichedAt, "string");
});

test("manual import AI enrichment records failed state without throwing", async () => {
  const rootDir = tempRoot();

  const result = await upsertManualImportAiEnrichment({
    rootDir,
    job: {
      jobKey: "stepstone:13904121",
      title: "Embedded Systems Thesis",
      description: { text: "Linux and Qt." },
    },
    now: "2026-05-08T10:00:00.000Z",
    analyze: async () => {
      throw new Error("quota");
    },
  });

  assert.equal(result.ok, false);
  const stored = readJson(path.join(rootDir, "data", "enrichments", "2026-05-08.json"));
  assert.equal(stored["stepstone:13904121"].failed, true);
  assert.equal(stored["stepstone:13904121"].reason, "manual_import_ai_error");
});

test("manual import AI enrichment skips existing successful analysis", async () => {
  const rootDir = tempRoot();
  fs.mkdirSync(path.join(rootDir, "data", "enrichments"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "data", "enrichments", "2026-05-08.json"), JSON.stringify({
    "stepstone:13904121": {
      aufgaben: "existing analysis",
      techReqs: "Linux, Qt, C++",
      enrichedAt: "2026-05-08T09:00:00.000Z",
    },
  }));
  let called = false;

  const result = await upsertManualImportAiEnrichment({
    rootDir,
    job: {
      jobKey: "stepstone:13904121",
      title: "Embedded Systems Thesis",
      description: { text: "Linux and Qt." },
    },
    now: "2026-05-08T10:00:00.000Z",
    analyze: async () => {
      called = true;
      return { aufgaben: "new", techReqs: "new" };
    },
  });

  assert.equal(called, false);
  assert.equal(result.skipped, true);
  const stored = readJson(path.join(rootDir, "data", "enrichments", "2026-05-08.json"));
  assert.equal(stored["stepstone:13904121"].aufgaben, "existing analysis");
});


test("dashboard enrichment dates include acceptedAt for manual jobs without canonicalFile", () => {
  assert.deepEqual(dashboardEnrichmentDatesForJob({
    canonicalFile: "",
    acceptedAt: "2026-05-08T10:00:00.000Z",
  }), ["2026-05-08"]);
  assert.deepEqual(dashboardEnrichmentDatesForJob({
    canonicalFile: "data/canonical/2026-05-07.json",
    acceptedAt: "2026-05-08T10:00:00.000Z",
  }), ["2026-05-07"]);
});

test("dashboard reads enrichment files for manual accepted jobs", () => {
  const rootDir = tempRoot();
  fs.mkdirSync(path.join(rootDir, "data", "enrichments"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "data", "enrichments", "2026-05-08.json"), JSON.stringify({
    "stepstone:13904121": {
      aufgaben: "embedded platform analysis",
      techReqs: "Linux, Qt, C++",
    },
  }));

  const enrichments = readDashboardEnrichments(rootDir, [{
    jobKey: "stepstone:13904121",
    canonicalFile: "",
    acceptedAt: "2026-05-08T10:00:00.000Z",
  }]);

  assert.equal(enrichments["stepstone:13904121"].aufgaben, "embedded platform analysis");
});
