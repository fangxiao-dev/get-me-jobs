import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("enrich-jobs can be imported by review workflow", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { enrichSelectedJobs } from './scripts/enrich-jobs.mjs'; console.log(typeof enrichSelectedJobs);",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "function");
});
