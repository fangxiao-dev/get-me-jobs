import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicationEventStage,
  defaultApplication,
  normalizeApplicationDetails,
} from "../../../app/server.mjs";

test("default application keeps a separate manual status URL", () => {
  assert.deepEqual(defaultApplication("linkedin:123"), {
    jobKey: "linkedin:123",
    currentStatus: "accepted",
    appliedAt: null,
    nextActionAt: null,
    ownerNote: "",
    statusUrl: "",
    events: [],
  });
});

test("application details patch updates the manual status URL only", () => {
  const current = {
    jobKey: "linkedin:123",
    currentStatus: "applied_waiting",
    appliedAt: "2026-04-26",
    nextActionAt: null,
    ownerNote: "keep this",
    statusUrl: "https://old.example/status",
    events: [{ type: "applied", date: "2026-04-26", note: "sent" }],
  };

  const next = normalizeApplicationDetails(current, {
    statusUrl: " https://portal.example/bewerbungen/42 ",
  });

  assert.equal(next.statusUrl, "https://portal.example/bewerbungen/42");
  assert.equal(next.ownerNote, "keep this");
  assert.equal(next.currentStatus, "applied_waiting");
  assert.deepEqual(next.events, current.events);
});

test("application notes are assigned to the current stage when saved", () => {
  assert.equal(applicationEventStage("note", "applied_waiting"), "applied");
  assert.equal(applicationEventStage("note", "interview_completed"), "interview_completed");
  assert.equal(applicationEventStage("note", "accepted"), "note");
  assert.equal(applicationEventStage("applied", "accepted"), undefined);
});
