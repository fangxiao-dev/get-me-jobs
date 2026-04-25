import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptLinkedinItem } from "../adapt-linkedin.mjs";

const RAW_FILE = "data/raw/linkedin-2026-04-25-114234.json";
const COLLECTED_AT = "2026-04-25T11:42:34.000Z";
const RAW_CONTEXT = {
  rawFile: RAW_FILE,
  collectedAt: COLLECTED_AT,
  runId: "aeWWMhq38NBlLwFUf",
  datasetId: "gTibyfv4TVpQQxvVb",
};

const minimalItem = {
  id: "4405313639",
  title: "Masterarbeit KI",
  companyName: "Acme GmbH",
  location: "Berlin, Germany",
  country: "Germany",
  link: "https://de.linkedin.com/jobs/view/4405313639",
  descriptionText: "Some description",
};

describe("adaptLinkedinItem", () => {
  it("generates a stable jobId from source and linkedin id", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.identity.jobId, "linkedin:4405313639");
    assert.equal(job.identity.source, "linkedin");
    assert.equal(job.identity.sourceJobId, "4405313639");
    assert.equal(job.identity.dedupeKey, "source-id:linkedin:4405313639");
    assert.ok(job.identity.dedupeKeys.includes("source-id:linkedin:4405313639"));
  });

  it("adds a normalized URL dedupe key", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, link: "https://de.linkedin.com/jobs/view/4405313639?position=1&trackingId=abc#x" },
      RAW_CONTEXT,
    );
    assert.ok(job.identity.dedupeKeys.some((key) => key.startsWith("url:")));
    assert.equal(job.identity.dedupeKeys.some((key) => key.includes("trackingId")), false);
  });

  it("maps top-level raw run metadata from context, sourceInputUrl undefined when absent", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.identity.sourceRunId, "aeWWMhq38NBlLwFUf");
    assert.equal(job.identity.sourceDatasetId, "gTibyfv4TVpQQxvVb");
    assert.equal(job.identity.sourceInputUrl, undefined);
  });

  it("maps title fields", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, standardizedTitle: "AI Thesis" },
      RAW_CONTEXT,
    );
    assert.equal(job.title.raw, "Masterarbeit KI");
    assert.equal(job.title.normalized, "AI Thesis");
  });

  it("parses location into city and state", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.location.raw, "Berlin, Germany");
    assert.equal(job.location.city, "Berlin");
    assert.equal(job.location.state, "Germany");
    assert.equal(job.location.country, "Germany");
  });

  it("maps workplaceType REMOTE", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, workplaceTypes: ["REMOTE"] },
      RAW_CONTEXT,
    );
    assert.equal(job.location.workplaceType, "remote");
  });

  it("maps workplaceType HYBRID", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, workplaceTypes: ["HYBRID"] },
      RAW_CONTEXT,
    );
    assert.equal(job.location.workplaceType, "hybrid");
  });

  it("maps empty workplaceTypes to unknown, not on_site", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, workplaceTypes: [], workRemoteAllowed: false },
      RAW_CONTEXT,
    );
    assert.equal(job.location.workplaceType, "unknown");
  });

  it("sets collectedAt from context", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.timing.collectedAt, COLLECTED_AT);
  });

  it("converts numeric expireAt to ISO expiresAt", () => {
    const job = adaptLinkedinItem({ ...minimalItem, expireAt: 1779619551000 }, RAW_CONTEXT);
    assert.equal(job.timing.expiresAt, "2026-05-24T10:45:51.000Z");
  });

  it("creates an initial sighting", () => {
    const job = adaptLinkedinItem(minimalItem, RAW_CONTEXT);
    assert.equal(job.sightings.length, 1);
    assert.equal(job.sightings[0].source, "linkedin");
    assert.equal(job.sightings[0].rawFile, RAW_FILE);
  });

  it("maps description fields", () => {
    const job = adaptLinkedinItem(
      { ...minimalItem, descriptionHtml: "<p>text</p>" },
      RAW_CONTEXT,
    );
    assert.equal(job.description.text, "Some description");
    assert.equal(job.description.html, "<p>text</p>");
  });
});
