import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  migrateLegacyManualLinkedinFiles,
  upsertManualLinkedinRawItem,
} from "../manual-linkedin-store.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "manual-linkedin-store-"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function rawItem(id, title = `Job ${id}`) {
  return {
    id,
    title,
    companyName: "Acme",
    link: `https://www.linkedin.com/jobs/view/${id}/`,
    applyUrl: "",
  };
}

describe("manual linkedin store", () => {
  it("upserts manual imports into one deduplicated daily file", () => {
    const rootDir = tempRoot();
    const first = upsertManualLinkedinRawItem(rootDir, rawItem("111", "First"), "2026-04-27T10:00:00.000Z");
    const second = upsertManualLinkedinRawItem(rootDir, rawItem("111", "Updated"), "2026-04-27T11:00:00.000Z");

    assert.equal(first.manualAdded, true);
    assert.equal(first.manualDeduped, false);
    assert.equal(second.manualAdded, false);
    assert.equal(second.manualDeduped, true);
    assert.equal(second.manualFile, "data/manual/linkedin-2026-04-27.json");

    const stored = readJson(path.join(rootDir, "data", "manual", "linkedin-2026-04-27.json"));
    assert.equal(stored.count, 1);
    assert.equal(stored.items[0].id, "111");
    assert.equal(stored.items[0].title, "Updated");
  });

  it("migrates legacy one-job manual raw files into daily files", () => {
    const rootDir = tempRoot();
    const rawDir = path.join(rootDir, "data", "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(
      path.join(rawDir, "linkedin-manual-2026-04-26-155048.json"),
      `${JSON.stringify({ savedAt: "2026-04-26T15:50:48.000Z", items: [rawItem("222")] }, null, 2)}\n`,
    );

    const result = migrateLegacyManualLinkedinFiles(rootDir);

    assert.equal(result.files.length, 1);
    assert.equal(result.addedCount, 1);
    assert.equal(result.dedupedCount, 0);
    const stored = readJson(path.join(rootDir, "data", "manual", "linkedin-2026-04-26.json"));
    assert.equal(stored.count, 1);
    assert.equal(stored.items[0].id, "222");
  });
});
