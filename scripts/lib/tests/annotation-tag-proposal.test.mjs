import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runAnnotationTagProposal } from "../../propose-annotation-tags.mjs";
import {
  applyAnnotationTagProposal,
  inferAnnotationTags,
  generateAnnotationTagProposal,
} from "../annotation-tag-proposal.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("reject notes map to canonical filtering tags and drop too_far", () => {
  const result = inferAnnotationTags({
    id: "linkedin:1",
    decision: "reject",
    tags: ["not_ai"],
    note: "太远，实际日期太久远，Deutschkenntnisse mindestens C1-Niveau，偏工业 Embedded",
  });

  assert.deepEqual(result.suggestedTags, [
    "stale_post",
    "industrial_hardware",
    "embedded_hardware",
  ]);
  assert.deepEqual(result.removedTags, ["not_ai"]);
});

test("domain, traditional ML, low interest, and thesis tags are inferred", () => {
  const result = inferAnnotationTags({
    id: "linkedin:2",
    decision: "reject",
    tags: ["not_thesis"],
    note: "not thesis; Pharmatechnik 主题不符; 传统ML",
  });

  assert.deepEqual(result.suggestedTags, [
    "not_thesis",
    "domain_mismatch",
    "traditional_ml_cv",
    "low_interest",
  ]);
});

test("accepted annotations keep only good_topic as positive signal", () => {
  const result = inferAnnotationTags({
    id: "linkedin:3",
    decision: "accept",
    tags: ["good_company", "good_topic", "not_ai"],
    note: "",
  });

  assert.deepEqual(result.suggestedTags, ["good_topic"]);
  assert.deepEqual(result.removedTags, ["good_company", "not_ai"]);
});

test("rejected annotations preserve good_topic as positive signal", () => {
  const result = inferAnnotationTags({
    id: "linkedin:4",
    decision: "reject",
    tags: ["good_topic"],
    note: "实际日期太久远",
  });

  assert.deepEqual(result.suggestedTags, ["stale_post", "good_topic"]);
  assert.deepEqual(result.removedTags, []);
});

test("proposal includes only changed annotations and summary counts", () => {
  const proposal = generateAnnotationTagProposal({
    annotationFiles: [
      {
        file: "2026-05-07.json",
        annotations: {
          items: [
            { id: "linkedin:1", decision: "reject", tags: [], note: "Visual C++/C#/Java development" },
            { id: "linkedin:2", decision: "reject", tags: ["stale_post"], note: "实际日期太久远" },
            { id: "linkedin:3", decision: "accept", tags: ["good_company"], note: "" },
          ],
        },
      },
    ],
    now: "2026-05-07T12:00:00.000Z",
  });

  assert.equal(proposal.summary.totalAnnotations, 3);
  assert.equal(proposal.summary.changedAnnotations, 2);
  assert.deepEqual(proposal.entries.map((entry) => entry.id), ["linkedin:1", "linkedin:3"]);
  assert.deepEqual(proposal.entries[0].suggestedTags, ["industrial_hardware"]);
});

test("CLI runner writes proposal without mutating annotation files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "annotation-tag-proposal-"));
  const annotationsPath = path.join(root, "data", "annotations", "2026-05-07.json");
  const annotations = {
    date: "2026-05-07",
    items: [
      { id: "linkedin:1", decision: "reject", tags: [], note: "Deutsch (min. C1)" },
    ],
  };
  writeJson(annotationsPath, annotations);

  const result = runAnnotationTagProposal({
    cwd: root,
    argv: [],
    now: "2026-05-07T12:00:00.000Z",
  });

  assert.equal(result.mode, "proposal");
  assert.equal(fs.existsSync(result.proposalPath), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(annotationsPath, "utf8")),
    annotations,
  );
  assert.equal(result.proposal.entries.length, 0);
});

test("apply updates annotation tags from a reviewed proposal", () => {
  const annotations = {
    date: "2026-05-07",
    items: [
      { id: "linkedin:1", decision: "reject", tags: ["not_ai"], note: "偏工业" },
      { id: "linkedin:2", decision: "accept", tags: ["good_company", "good_topic"], note: "" },
    ],
  };
  const proposal = generateAnnotationTagProposal({
    annotationFiles: [{ file: "2026-05-07.json", annotations }],
    now: "2026-05-07T12:00:00.000Z",
  });

  const next = applyAnnotationTagProposal(annotations, proposal, "2026-05-07.json");

  assert.deepEqual(next.items[0].tags, ["industrial_hardware"]);
  assert.deepEqual(next.items[1].tags, ["good_topic"]);
});

test("CLI apply writes normalized tags to annotation files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "annotation-tag-apply-"));
  const annotationsPath = path.join(root, "data", "annotations", "2026-05-07.json");
  writeJson(annotationsPath, {
    date: "2026-05-07",
    items: [
      { id: "linkedin:1", decision: "reject", tags: ["not_ai"], note: "偏工业" },
    ],
  });
  runAnnotationTagProposal({ cwd: root, argv: [], now: "2026-05-07T12:00:00.000Z" });

  const result = runAnnotationTagProposal({ cwd: root, argv: ["--apply"] });
  const next = JSON.parse(fs.readFileSync(annotationsPath, "utf8"));

  assert.equal(result.mode, "apply");
  assert.deepEqual(next.items[0].tags, ["industrial_hardware"]);
});
