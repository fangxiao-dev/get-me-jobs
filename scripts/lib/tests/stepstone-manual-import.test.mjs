import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { mergeCanonicalForDate } from "../../merge-canonical.mjs";
import { adaptStepstoneItem } from "../adapt-stepstone.mjs";
import { upsertManualRawItem } from "../manual-job-store.mjs";
import {
  extractedStepstoneJobToRawItem,
  extractStepstoneJobFromPage,
  extractStepstoneJobId,
  normalizeStepstoneJobUrl,
} from "../scrape-stepstone-job.mjs";

const STEPSTONE_URL = "https://www.stepstone.de/stellenangebote--Abschlussarbeit-Bachelor-Master-Embedded-Systems-Linux-und-QT-m-w-d-Ulm-Kamag-Transporttechnik-GmbH-und-Co-KG--13904121-inline.html?rltr=21_21_25_seorl_m_0_0_5_0_0_0";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "stepstone-manual-import-"));
}

test("extracts and normalizes Stepstone job URLs", () => {
  assert.equal(extractStepstoneJobId(STEPSTONE_URL), "13904121");
  assert.equal(
    normalizeStepstoneJobUrl(STEPSTONE_URL),
    "https://www.stepstone.de/stellenangebote--Abschlussarbeit-Bachelor-Master-Embedded-Systems-Linux-und-QT-m-w-d-Ulm-Kamag-Transporttechnik-GmbH-und-Co-KG--13904121-inline.html",
  );
});

test("maps Stepstone JSON-LD extraction into an adapter-compatible raw item", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html>
      <html>
        <head>
          <link rel="canonical" href="https://www.stepstone.de/stellenangebote--Embedded-Test-Ulm-Acme-GmbH--13904121-inline.html">
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Abschlussarbeit Embedded Systems",
              "url": "https://www.stepstone.de/stellenangebote--Embedded-Test-Ulm-Acme-GmbH--13904121-inline.html",
              "datePosted": "2026-04-29T07:03:04.817Z",
              "validThrough": "2026-05-14T06:14:57.167Z",
              "employmentType": "FULL_TIME",
              "directApply": true,
              "hiringOrganization": {
                "@type": "Organization",
                "name": "Acme GmbH",
                "url": "https://www.stepstone.de/cmp/de/Acme-GmbH/jobs.html",
                "logo": "https://example.com/logo.png"
              },
              "jobLocation": {
                "@type": "Place",
                "address": {
                  "@type": "PostalAddress",
                  "addressCountry": "DE",
                  "addressLocality": "Ulm",
                  "addressRegion": "Baden-Württemberg",
                  "postalCode": "89079"
                }
              },
              "description": "<p>Intro</p><h2>Deine Aufgaben</h2><ul><li>Linux und Qt</li></ul>"
            }
          </script>
        </head>
        <body><h1>Fallback title</h1></body>
      </html>`);

    const extracted = await extractStepstoneJobFromPage(page, STEPSTONE_URL);
    const raw = extractedStepstoneJobToRawItem(extracted, "2026-05-08T10:00:00.000Z");

    assert.equal(raw.id, "13904121");
    assert.equal(raw.link, "https://www.stepstone.de/stellenangebote--Embedded-Test-Ulm-Acme-GmbH--13904121-inline.html");
    assert.equal(raw.title, "Abschlussarbeit Embedded Systems");
    assert.equal(raw.companyName, "Acme GmbH");
    assert.equal(raw.location, "Ulm, Baden-Württemberg, DE");
    assert.equal(raw.employmentType, "FULL_TIME");
    assert.equal(raw.applyMethod, "ManualImport");
    assert.equal(raw.applyUrl, "");

    const job = adaptStepstoneItem(raw, {
      rawFile: "data/manual/stepstone-2026-05-08.json",
      collectedAt: "2026-05-08T10:00:00.000Z",
    });
    assert.equal(job.identity.jobId, "stepstone:13904121");
    assert.equal(job.company.name, "Acme GmbH");
    assert.equal(job.description.html, "<p>Intro</p><h2>Deine Aufgaben</h2><ul><li>Linux und Qt</li></ul>");
    assert.equal(job.timing.postedAt, "2026-04-29T07:03:04.817Z");
    assert.equal(job.timing.expiresAt, "2026-05-14T06:14:57.167Z");
  } finally {
    await browser.close();
  }
});

test("mergeCanonicalForDate reads daily manual stepstone aggregate files", () => {
  const rootDir = tempRoot();
  upsertManualRawItem(rootDir, "stepstone", {
    id: "13904121",
    title: "Manual Stepstone Job",
    companyName: "Acme GmbH",
    location: "Ulm, Baden-Württemberg, DE",
    link: "https://www.stepstone.de/stellenangebote--Manual-Stepstone-Job-Ulm-Acme-GmbH--13904121-inline.html",
    applyUrl: "",
    descriptionText: "Embedded Linux and Qt",
  }, "2026-05-08T10:00:00.000Z");

  const result = mergeCanonicalForDate("2026-05-08", { rootDir });

  assert.equal(result.canonicalItems, 1);
  assert.equal(result.files[0].file, "stepstone-2026-05-08.json");
  const canonical = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "canonical", "2026-05-08.json"), "utf8"));
  assert.equal(canonical.items[0].identity.jobId, "stepstone:13904121");
  assert.equal(canonical.items[0].identity.rawFile, "data/manual/stepstone-2026-05-08.json");
});
