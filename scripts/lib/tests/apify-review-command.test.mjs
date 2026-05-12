import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runApifyReview } from "../../run-apify-review.mjs";
import {
  deriveSourceFromTaskKey,
  localDateParts,
  parseDotenv,
  rawFilenameForRun,
  resolveTaskEntries,
} from "../apify-review-command.mjs";

test("parseDotenv reads APIFY and TASKID entries without keeping quotes", () => {
  assert.deepEqual(parseDotenv(`
# comment
APIFY='token'
TASKID_LINKEDIN="actor"
TASKID_STEPSTONE=stepstone-task
EMPTY=
`), {
    APIFY: "token",
    TASKID_LINKEDIN: "actor",
    TASKID_STEPSTONE: "stepstone-task",
    EMPTY: "",
  });
});

test("resolveTaskEntries maps LinkedIn and Stepstone env values to accessible Apify task ids", () => {
  const tasks = [
    {
      id: "bwUYuYSLwGHgJn3oL",
      name: "advanced-linkedin-job-scraper-task",
      actId: "gdbRh93zn42kBYDyS",
    },
    {
      id: "lfwNUdTa3jpYanfcP",
      name: "linkedin-jobs-scraper-task",
      actId: "hKByXkMQaC5Qt9UMN",
    },
    {
      id: "XllWf15BPzQysBBrE",
      name: "stepstone-task",
      actId: "o6JjyowF7532cPwan",
    },
  ];

  assert.deepEqual(resolveTaskEntries({
    TASKID_LINKEDIN: "hKByXkMQaC5Qt9UMN",
    TASKID_LINKEDIN_ADVANCED: "lfwNUdTa3jpYanfcP",
    TASKID_STEPSTONE: "XllWf15BPzQysBBrE",
  }, tasks), [
    {
      key: "TASKID_LINKEDIN",
      taskId: "lfwNUdTa3jpYanfcP",
      taskName: "linkedin-jobs-scraper-task",
      actorId: "hKByXkMQaC5Qt9UMN",
      source: "linkedin",
    },
    {
      key: "TASKID_LINKEDIN_ADVANCED",
      taskId: "bwUYuYSLwGHgJn3oL",
      taskName: "advanced-linkedin-job-scraper-task",
      actorId: "gdbRh93zn42kBYDyS",
      source: "linkedin",
    },
    {
      key: "TASKID_STEPSTONE",
      taskId: "XllWf15BPzQysBBrE",
      taskName: "stepstone-task",
      actorId: "o6JjyowF7532cPwan",
      source: "stepstone",
    },
  ]);
});

test("deriveSourceFromTaskKey maps task env keys to canonical source names", () => {
  assert.equal(deriveSourceFromTaskKey("TASKID_LINKEDIN"), "linkedin");
  assert.equal(deriveSourceFromTaskKey("TASKID_LINKEDIN_ADVANCED"), "linkedin");
  assert.equal(deriveSourceFromTaskKey("TASKID_STEPSTONE"), "stepstone");
});

test("raw filenames use source, local date, and avoid same-second collisions", () => {
  const parts = localDateParts(new Date("2026-04-29T13:24:52"));

  assert.deepEqual(parts, { date: "2026-04-29", time: "132452" });
  assert.equal(rawFilenameForRun("linkedin", parts, 0), "linkedin-2026-04-29-132452.json");
  assert.equal(rawFilenameForRun("stepstone", parts, 0), "stepstone-2026-04-29-132452.json");
  assert.equal(rawFilenameForRun("stepstone", parts, 1), "stepstone-2026-04-29-132452-02.json");
});

test("runApifyReview stops before env or network access when Apify channel is disabled", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "apify-disabled-"));
  fs.mkdirSync(path.join(rootDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "config", "job-sources.manifest.json"), JSON.stringify({
    version: 1,
    channels: {
      apify: { enabled: false, envFile: ".env", taskEnvPrefix: "TASKID_" },
      apify_linkedin: { enabled: true, envFile: ".env", taskEnvPrefix: "TASKID_LINKEDIN" },
      localLinkedin: { enabled: true, inputFile: "config/local/linkedin-assisted.input.json" },
    },
    review: { preferencesFile: "config/preferences.linkedin.json", enrichSelected: true },
  }));

  await assert.rejects(
    () => runApifyReview({ rootDir }),
    /Apify channel is disabled by config\/job-sources\.manifest\.json/,
  );
});
