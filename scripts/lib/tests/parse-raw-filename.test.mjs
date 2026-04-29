import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRawFilename } from "../parse-raw-filename.mjs";

describe("parseRawFilename", () => {
  it("parses a valid linkedin filename", () => {
    assert.deepEqual(parseRawFilename("linkedin-2026-04-25-094105.json"), {
      source: "linkedin",
      date: "2026-04-25",
      time: "094105",
    });
  });

  it("leaves legacy one-job manual files out of raw merge input", () => {
    assert.equal(parseRawFilename("linkedin-manual-2026-04-26-155048.json"), null);
  });

  it("parses a valid stepstone filename", () => {
    assert.deepEqual(parseRawFilename("stepstone-2026-04-25-121045.json"), {
      source: "stepstone",
      date: "2026-04-25",
      time: "121045",
    });
  });

  it("returns null for the old date-only format", () => {
    assert.equal(parseRawFilename("2026-04-25.json"), null);
  });

  it("returns null for a non-json file", () => {
    assert.equal(parseRawFilename("linkedin-2026-04-25-094105.csv"), null);
  });

  it("returns null for a missing time segment", () => {
    assert.equal(parseRawFilename("linkedin-2026-04-25.json"), null);
  });
});
