import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mergeCanonicalForDate } from "../../merge-canonical.mjs";
import { upsertManualLinkedinRawItem } from "../manual-linkedin-store.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "merge-canonical-manual-"));
}

test("mergeCanonicalForDate reads daily manual linkedin aggregate files", () => {
  const rootDir = tempRoot();
  upsertManualLinkedinRawItem(rootDir, {
    id: "111",
    title: "Manual Job",
    companyName: "Acme",
    location: "Berlin, Germany",
    link: "https://www.linkedin.com/jobs/view/111/",
    applyUrl: "",
  }, "2026-04-27T10:00:00.000Z");

  const result = mergeCanonicalForDate("2026-04-27", { rootDir });

  assert.equal(result.canonicalItems, 1);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].file, "linkedin-2026-04-27.json");
  const canonical = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "canonical", "2026-04-27.json"), "utf8"));
  assert.equal(canonical.items[0].identity.jobId, "linkedin:111");
  assert.equal(canonical.items[0].identity.rawFile, "data/manual/linkedin-2026-04-27.json");
});
