import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { adaptLinkedinItem } from "../adapt-linkedin.mjs";
import {
  extractedLinkedinJobToRawItem,
  extractLinkedinJobId,
  normalizeLinkedinJobUrl,
} from "../scrape-linkedin-job.mjs";
import { upsertManualAcceptedApplication } from "../../../app/server.mjs";

const TRACKING_URL = "https://www.linkedin.com/jobs/view/4343336011/?alternateChannel=search&eBP=tracking&trk=d_flagship3_search_srp_jobs&refId=abc&trackingId=def";

test("extracts LinkedIn job id from noisy job URLs", () => {
  assert.equal(extractLinkedinJobId(TRACKING_URL), "4343336011");
  assert.equal(
    extractLinkedinJobId("https://de.linkedin.com/jobs/view/masterarbeit-test-at-porsche-ag-4343336011?trk=public_jobs"),
    "4343336011",
  );
});

test("normalizes LinkedIn job URL to a stable tracking-free detail URL", () => {
  assert.equal(normalizeLinkedinJobUrl(TRACKING_URL), "https://www.linkedin.com/jobs/view/4343336011/");
});

test("maps Playwright extraction into an adapter-compatible raw item with blank applyUrl", () => {
  const raw = extractedLinkedinJobToRawItem({
    inputUrl: TRACKING_URL,
    canonicalUrl: "https://de.linkedin.com/jobs/view/masterarbeit-test-at-porsche-ag-4343336011",
    title: "Masterarbeit Test",
    companyName: "Porsche AG",
    companyLinkedinUrl: "https://de.linkedin.com/company/porsche-ag?trk=public_jobs_topcard-org-name",
    location: "Mönsheim, Baden-Württemberg, Germany",
    descriptionText: "Aufgaben und Profil",
    descriptionHtml: "<p>Aufgaben und Profil</p>",
    criteria: [
      { label: "Seniority level", value: "Internship" },
      { label: "Employment type", value: "Full-time" },
      { label: "Job function", value: "Education and Training" },
      { label: "Industries", value: "Motor Vehicle Manufacturing" },
    ],
    applicantsText: "Be among the first 25 applicants",
  }, "2026-04-26T10:00:00.000Z");

  assert.equal(raw.id, "4343336011");
  assert.equal(raw.link, "https://de.linkedin.com/jobs/view/masterarbeit-test-at-porsche-ag-4343336011");
  assert.equal(raw.applyUrl, "");
  assert.equal(raw.applyMethod, "ManualImport");
  assert.equal(raw.seniorityLevel, "Internship");
  assert.equal(raw.employmentType, "Full-time");
  assert.equal(raw.jobFunction, "Education and Training");
  assert.equal(raw.industries, "Motor Vehicle Manufacturing");
  assert.equal(raw.companyLinkedinUrl, "https://de.linkedin.com/company/porsche-ag?trk=public_jobs_topcard-org-name");

  const job = adaptLinkedinItem(raw, {
    rawFile: "data/raw/linkedin-manual-2026-04-26-100000.json",
    collectedAt: "2026-04-26T10:00:00.000Z",
  });
  assert.equal(job.identity.jobId, "linkedin:4343336011");
  assert.equal(job.application.applyUrl, undefined);
});

test("manual import upserts accepted job without duplicating the application", () => {
  const now = "2026-04-26T10:00:00.000Z";
  const raw = extractedLinkedinJobToRawItem({
    inputUrl: TRACKING_URL,
    canonicalUrl: "https://de.linkedin.com/jobs/view/masterarbeit-test-at-porsche-ag-4343336011",
    title: "Masterarbeit Test",
    companyName: "Porsche AG",
    location: "Mönsheim, Baden-Württemberg, Germany",
    descriptionText: "Aufgaben",
    criteria: [],
  }, now);
  const job = adaptLinkedinItem(raw, {
    rawFile: "data/raw/linkedin-manual-2026-04-26-100000.json",
    collectedAt: now,
  });
  const initial = {
    accepted: { version: 1, items: [] },
    applications: { version: 1, items: [] },
  };

  const first = upsertManualAcceptedApplication(initial, job, {
    now,
    canonicalFile: "",
    rawFile: "data/raw/linkedin-manual-2026-04-26-100000.json",
  });
  const second = upsertManualAcceptedApplication(first, job, {
    now: "2026-04-26T11:00:00.000Z",
    canonicalFile: "",
    rawFile: "data/raw/linkedin-manual-2026-04-26-110000.json",
  });

  assert.equal(second.accepted.items.length, 1);
  assert.equal(second.applications.items.length, 1);
  assert.equal(second.accepted.items[0].applyUrl, null);
  assert.equal(second.applications.items[0].events.filter((event) => event.type === "accepted").length, 1);
});

test("server declares the raw data directory used by manual imports", () => {
  const source = readFileSync("app/server.mjs", "utf8");
  assert.match(source, /const rawDir = path\.join\(dataDir, "raw"\);/);
});
