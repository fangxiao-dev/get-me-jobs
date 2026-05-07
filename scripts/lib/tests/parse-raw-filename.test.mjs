import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRawFilename } from "../parse-raw-filename.mjs";

test("parseRawFilename accepts plain raw source filenames", () => {
  assert.deepEqual(parseRawFilename("linkedin-2026-05-07-170159.json"), {
    source: "linkedin",
    date: "2026-05-07",
    time: "170159",
    sequence: 1,
  });
});

test("parseRawFilename accepts suffixed same-second raw source filenames", () => {
  assert.deepEqual(parseRawFilename("linkedin-2026-05-07-170159-02.json"), {
    source: "linkedin",
    date: "2026-05-07",
    time: "170159",
    sequence: 2,
  });
});
