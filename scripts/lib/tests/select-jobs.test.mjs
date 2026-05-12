import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { selectJobsFile } from "../../select-jobs.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function job(id, postedAt) {
  return {
    identity: { jobId: `linkedin:${id}` },
    title: { raw: "Masterarbeit AI", normalized: "Masters Student" },
    description: { text: "Masterarbeit about AI and machine learning." },
    timing: { postedAt },
  };
}

test("selectJobsFile writes hard-rule deleted jobs separately from selected jobs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "select-jobs-freshness-"));
  writeJson(path.join(root, "data", "canonical", "2026-05-08.json"), {
    date: "2026-05-08",
    items: [
      job("old", "2026-01-07T23:59:59.000Z"),
      job("fresh", "2026-01-08T00:00:00.000Z"),
      job("missing-date", undefined),
    ],
  });
  writeJson(path.join(root, "config", "preferences.linkedin.json"), {
    version: 1,
    freshness: { maxPostedAgeMonths: 4 },
    rules: {
      must: [
        { id: "thesis", fields: ["title.raw", "description.text"], terms: ["masterarbeit"] },
        { id: "ai", fields: ["title.raw", "description.text"], terms: ["AI"] },
      ],
      exclude: [],
    },
  });

  const result = selectJobsFile(
    "data/canonical/2026-05-08.json",
    "data/selected/2026-05-08.json",
    "config/preferences.linkedin.json",
    { cwd: root },
  );
  const selected = JSON.parse(fs.readFileSync(path.join(root, "data", "selected", "2026-05-08.json"), "utf8"));
  const deleted = JSON.parse(fs.readFileSync(path.join(root, "data", "deleted", "2026-05-08.json"), "utf8"));

  assert.equal(result.selectedCount, 2);
  assert.equal(result.deletedCount, 1);
  assert.equal(result.deletedFile, "data/deleted/2026-05-08.json");
  assert.deepEqual(selected.items.map((item) => item.identity.jobId), [
    "linkedin:fresh",
    "linkedin:missing-date",
  ]);
  assert.equal(deleted.deletedCount, 1);
  assert.deepEqual(deleted.items.map((item) => item.identity.jobId), ["linkedin:old"]);
  assert.deepEqual(deleted.items[0]._deleted.rules, [{
    id: "posted_too_old",
    postedAt: "2026-01-07T23:59:59.000Z",
    cutoff: "2026-01-08T00:00:00.000Z",
    maxPostedAgeMonths: 4,
  }]);
});
