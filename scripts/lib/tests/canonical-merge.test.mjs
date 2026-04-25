import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyCanonicalFile, mergeIntoCanonical } from "../canonical-merge.mjs";

function makeJob(id, extra = {}) {
  const sourceKey = `source-id:linkedin:${id}`;
  const urlKey = `url:https://example.com/jobs/${id}`;
  return {
    schemaVersion: 1,
    identity: {
      jobId: `linkedin:${id}`,
      dedupeKey: sourceKey,
      dedupeKeys: [sourceKey, urlKey],
      source: "linkedin",
      sourceJobId: id,
      rawFile: "data/raw/linkedin-2026-04-25-114234.json",
    },
    title: { raw: `Job ${id}` },
    company: { name: "Acme" },
    location: { raw: "Berlin", workplaceType: "unknown" },
    description: { text: "desc" },
    application: {},
    employment: {},
    timing: { collectedAt: "2026-04-25T11:42:34.000Z" },
    sightings: [{ source: "linkedin", rawFile: "data/raw/linkedin-2026-04-25-114234.json", sourceJobId: id, seenAt: "2026-04-25T11:42:34.000Z" }],
    ...extra,
  };
}

const SOURCE_META = {
  source: "linkedin",
  rawFile: "data/raw/linkedin-2026-04-25-114234.json",
  rawFileTime: "114234",
  importedAt: "2026-04-25T11:00:00.000Z",
  rawCount: 2,
};

describe("emptyCanonicalFile", () => {
  it("creates an empty canonical file for a date", () => {
    const file = emptyCanonicalFile("2026-04-25");
    assert.equal(file.schemaVersion, 1);
    assert.equal(file.date, "2026-04-25");
    assert.deepEqual(file.items, []);
    assert.deepEqual(file.mergeState.processedRawFiles, []);
  });
});

describe("mergeIntoCanonical", () => {
  it("adds new jobs to an empty canonical file", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const jobs = [makeJob("111"), makeJob("222")];
    const result = mergeIntoCanonical(canonical, jobs, SOURCE_META);
    assert.equal(result.items.length, 2);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].addedCount, 2);
    assert.equal(result.sources[0].duplicateCount, 0);
  });

  it("skips a job with a dedupeKey already in the file", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const firstRun = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);

    const secondMeta = { ...SOURCE_META, rawFile: "data/raw/linkedin-2026-04-25-120000.json", rawFileTime: "120000" };
    const result = mergeIntoCanonical(firstRun, [makeJob("111"), makeJob("222")], secondMeta);

    assert.equal(result.items.length, 2);
    assert.equal(result.sources[1].addedCount, 1);
    assert.equal(result.sources[1].duplicateCount, 1);
  });

  it("appends a sighting to an existing job on duplicate", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const firstRun = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    const secondMeta = { ...SOURCE_META, rawFile: "data/raw/linkedin-2026-04-25-120000.json", rawFileTime: "120000" };
    const dupJob = makeJob("111", {
      sightings: [{ source: "linkedin", rawFile: secondMeta.rawFile, sourceJobId: "111", seenAt: "2026-04-25T12:00:00.000Z" }],
    });
    const result = mergeIntoCanonical(firstRun, [dupJob], secondMeta);
    assert.equal(result.items[0].sightings.length, 2);
  });

  it("records processed raw files in mergeState", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const result = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    assert.ok(result.mergeState.processedRawFiles.includes(SOURCE_META.rawFile));
    assert.equal(result.mergeState.lastRawFileTime, "114234");
  });

  it("is idempotent: skips files already in processedRawFiles", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const first = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    const second = mergeIntoCanonical(first, [makeJob("111")], SOURCE_META);
    assert.equal(second.items.length, 1);
    assert.equal(second.sources.length, 1);
  });

  it("deduplicates by normalized URL key even when source ids differ", () => {
    const canonical = emptyCanonicalFile("2026-04-25");
    const first = mergeIntoCanonical(canonical, [makeJob("111")], SOURCE_META);
    const secondMeta = { ...SOURCE_META, rawFile: "data/raw/linkedin-2026-04-25-120000.json", rawFileTime: "120000" };
    const sameUrlDifferentId = makeJob("999", {
      identity: {
        jobId: "linkedin:999",
        dedupeKey: "source-id:linkedin:999",
        dedupeKeys: ["source-id:linkedin:999", "url:https://example.com/jobs/111"],
        source: "linkedin",
        sourceJobId: "999",
        rawFile: secondMeta.rawFile,
      },
    });
    const result = mergeIntoCanonical(first, [sameUrlDifferentId], secondMeta);
    assert.equal(result.items.length, 1);
    assert.equal(result.sources[1].duplicateCount, 1);
    assert.ok(result.items[0].identity.dedupeKeys.includes("source-id:linkedin:999"));
  });
});
