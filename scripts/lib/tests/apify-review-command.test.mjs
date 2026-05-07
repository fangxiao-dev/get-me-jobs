import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runApifyReview } from "../../run-apify-review.mjs";
import {
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
EMPTY=
`), {
    APIFY: "token",
    TASKID_LINKEDIN: "actor",
    EMPTY: "",
  });
});

test("resolveTaskEntries maps env values to accessible Apify task ids", () => {
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
  ];

  assert.deepEqual(resolveTaskEntries({
    TASKID_LINKEDIN: "hKByXkMQaC5Qt9UMN",
    TASKID_LINKEDIN_ADVANCED: "lfwNUdTa3jpYanfcP",
  }, tasks), [
    {
      key: "TASKID_LINKEDIN",
      taskId: "lfwNUdTa3jpYanfcP",
      taskName: "linkedin-jobs-scraper-task",
      actorId: "hKByXkMQaC5Qt9UMN",
    },
    {
      key: "TASKID_LINKEDIN_ADVANCED",
      taskId: "bwUYuYSLwGHgJn3oL",
      taskName: "advanced-linkedin-job-scraper-task",
      actorId: "gdbRh93zn42kBYDyS",
    },
  ]);
});

test("raw filenames use local date and avoid same-second collisions", () => {
  const parts = localDateParts(new Date("2026-04-29T13:24:52"));

  assert.deepEqual(parts, { date: "2026-04-29", time: "132452" });
  assert.equal(rawFilenameForRun(parts, 0), "linkedin-2026-04-29-132452.json");
  assert.equal(rawFilenameForRun(parts, 1), "linkedin-2026-04-29-132452-02.json");
});

test("runApifyReview stops before env or network access when Apify channel is disabled", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "apify-disabled-"));
  fs.mkdirSync(path.join(rootDir, "config"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "config", "job-sources.manifest.json"), JSON.stringify({
    version: 1,
    channels: {
      apify_linkedin: { enabled: false, envFile: ".env", taskEnvPrefix: "TASKID_" },
      localLinkedin: { enabled: true, inputFile: "config/local/linkedin-assisted.input.json" },
    },
    review: { preferencesFile: "config/preferences.linkedin.json", enrichSelected: true },
  }));

  await assert.rejects(
    () => runApifyReview({ rootDir }),
    /Apify LinkedIn channel is disabled by config\/job-sources\.manifest\.json/,
  );
});
