import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applicationStatusAfterEvent,
  applicationEventStage,
  createManualJobFromPayload,
  defaultApplication,
  deleteDashboardJobFromStores,
  enrichAcceptedJobFromCanonical,
  listBatchMetadata,
  normalizeApplicationDetails,
  updateDashboardJobDescriptionInStores,
  upsertManualAcceptedApplication,
} from "../../../app/server.mjs";
import {
  normalizeManualJobAiFields,
  parseManualJobDescription,
} from "../manual-job-ai-parser.mjs";

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

test("manual entry payload creates a manual accepted job with description and empty links", () => {
  const now = "2026-05-12T08:00:00.000Z";
  const job = createManualJobFromPayload({
    title: " AI thesis ",
    descriptionText: "Build a retrieval workflow.",
    companyName: " Acme GmbH ",
    location: " Berlin, Germany ",
    workplaceType: "hybrid",
  }, {
    rawFile: "data/manual/manual-2026-05-12.json",
    collectedAt: now,
  });

  const next = upsertManualAcceptedApplication({
    accepted: { version: 1, items: [] },
    applications: { version: 1, items: [] },
  }, job, {
    now,
    canonicalFile: "",
    sourceLabel: "Manual",
  });

  assert.equal(next.accepted.items.length, 1);
  assert.equal(next.applications.items.length, 1);
  assert.equal(next.accepted.items[0].source, "manual");
  assert.equal(next.accepted.items[0].title, "AI thesis");
  assert.equal(next.accepted.items[0].companyName, "Acme GmbH");
  assert.equal(next.accepted.items[0].location, "Berlin, Germany");
  assert.equal(next.accepted.items[0].workplaceType, "hybrid");
  assert.equal(next.accepted.items[0].link, null);
  assert.equal(next.accepted.items[0].applyUrl, null);
  assert.deepEqual(next.accepted.items[0].description, {
    text: "Build a retrieval workflow.",
    html: undefined,
  });
  assert.match(next.accepted.items[0].jobKey, /^manual:/);
  assert.equal(next.result.message, "Added Manual job to Accepted.");
});

test("manual entry duplicates are keyed by title company and location", () => {
  const now = "2026-05-12T08:00:00.000Z";
  const firstJob = createManualJobFromPayload({
    title: "AI Thesis",
    descriptionText: "First description.",
    companyName: "Acme GmbH",
    location: "Berlin",
    workplaceType: "remote",
  }, {
    rawFile: "data/manual/manual-2026-05-12.json",
    collectedAt: now,
  });
  const secondJob = createManualJobFromPayload({
    title: " ai thesis ",
    descriptionText: "Updated description.",
    companyName: " ACME GmbH ",
    location: " Berlin ",
    workplaceType: "on_site",
  }, {
    rawFile: "data/manual/manual-2026-05-12.json",
    collectedAt: "2026-05-12T09:00:00.000Z",
  });

  const first = upsertManualAcceptedApplication({
    accepted: { version: 1, items: [] },
    applications: { version: 1, items: [] },
  }, firstJob, { now, canonicalFile: "", sourceLabel: "Manual" });
  const second = upsertManualAcceptedApplication(first, secondJob, {
    now: "2026-05-12T09:00:00.000Z",
    canonicalFile: "",
    sourceLabel: "Manual",
  });

  assert.equal(second.accepted.items.length, 1);
  assert.equal(second.applications.items.length, 1);
  assert.equal(second.accepted.items[0].description.text, "Updated description.");
  assert.equal(second.accepted.items[0].workplaceType, "on_site");
  assert.equal(second.result.createdAccepted, false);
  assert.match(second.result.message, /Already existed/);
});

test("manual AI parse normalizes fields for the same manual canonical payload", async () => {
  const parsed = await parseManualJobDescription({
    descriptionText: "raw JD text",
  }, {
    analyze: async () => ({
      title: " AI Engineer ",
      companyName: " Acme GmbH ",
      location: " Berlin ",
      workplaceType: "on-site",
      descriptionText: " Cleaned JD text ",
    }),
  });
  const job = createManualJobFromPayload(parsed, {
    rawFile: "data/manual/manual-2026-05-12.json",
    collectedAt: "2026-05-12T08:00:00.000Z",
  });

  assert.deepEqual(parsed, {
    title: "AI Engineer",
    companyName: "Acme GmbH",
    location: "Berlin",
    workplaceType: "on_site",
    descriptionText: "Cleaned JD text",
  });
  assert.equal(job.identity.source, "manual");
  assert.equal(job.title.raw, "AI Engineer");
  assert.equal(job.location.workplaceType, "on_site");
});

test("manual AI parse falls back to unknown work mode and original description", () => {
  assert.deepEqual(normalizeManualJobAiFields({
    title: "AI Engineer",
    companyName: "Acme GmbH",
    location: "Berlin",
    workplaceType: "office",
  }, "Original JD"), {
    title: "AI Engineer",
    companyName: "Acme GmbH",
    location: "Berlin",
    workplaceType: "unknown",
    descriptionText: "Original JD",
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

test("dashboard delete removes accepted and application records without rejection metadata", () => {
  const next = deleteDashboardJobFromStores({
    accepted: {
      version: 1,
      items: [
        { jobKey: "linkedin:1", annotationFile: "data/annotations/2026-05-16.json", sourceJobId: "1" },
        { jobKey: "linkedin:2", annotationFile: "data/annotations/2026-05-16.json", sourceJobId: "2" },
      ],
    },
    applications: {
      version: 1,
      items: [
        { ...defaultApplication("linkedin:1"), events: [{ type: "accepted", note: "keep out of annotations" }] },
        { ...defaultApplication("linkedin:2") },
      ],
    },
  }, "linkedin:1");

  assert.deepEqual(next.deleted, { jobKey: "linkedin:1", sourceJobId: "1" });
  assert.deepEqual(next.accepted.items.map((item) => item.jobKey), ["linkedin:2"]);
  assert.deepEqual(next.applications.items.map((item) => item.jobKey), ["linkedin:2"]);
  assert.equal("annotations" in next, false);
});

test("dashboard description update stores trimmed plain text on the accepted job only", () => {
  const next = updateDashboardJobDescriptionInStores({
    accepted: {
      version: 1,
      items: [
        {
          jobKey: "linkedin:1",
          title: "Role",
          description: { text: "Old", html: "<p>Old</p>" },
          link: "https://example.test/job",
        },
        { jobKey: "linkedin:2", description: { text: "Other" } },
      ],
    },
    applications: {
      version: 1,
      items: [{ ...defaultApplication("linkedin:1"), statusUrl: "https://portal.test" }],
    },
  }, {
    jobKey: "linkedin:1",
    descriptionText: "  New description.  ",
  });

  assert.deepEqual(next.accepted.items[0], {
    jobKey: "linkedin:1",
    title: "Role",
    description: { text: "New description." },
    link: "https://example.test/job",
  });
  assert.deepEqual(next.accepted.items[1], { jobKey: "linkedin:2", description: { text: "Other" } });
  assert.deepEqual(next.applications.items, [{ ...defaultApplication("linkedin:1"), statusUrl: "https://portal.test" }]);
  assert.equal(next.job.jobKey, "linkedin:1");
});

test("dashboard description update allows clearing text", () => {
  const next = updateDashboardJobDescriptionInStores({
    accepted: {
      version: 1,
      items: [{ jobKey: "linkedin:1", description: { text: "Bad scrape", html: "<p>Bad scrape</p>" } }],
    },
    applications: { version: 1, items: [] },
  }, {
    jobKey: "linkedin:1",
    descriptionText: "   ",
  });

  assert.deepEqual(next.accepted.items[0].description, { text: "" });
});

test("dashboard description update rejects missing and unknown jobs", () => {
  assert.throws(
    () => updateDashboardJobDescriptionInStores({ accepted: { items: [] } }, { descriptionText: "x" }),
    /jobKey is required/,
  );
  assert.throws(
    () => updateDashboardJobDescriptionInStores({ accepted: { items: [] } }, { jobKey: "linkedin:404", descriptionText: "x" }),
    /Accepted job not found: linkedin:404/,
  );
});

test("application notes are assigned to the current stage when saved", () => {
  assert.equal(applicationEventStage("note", "applied_waiting"), "applied");
  assert.equal(applicationEventStage("note", "interview_completed"), "interview_completed");
  assert.equal(applicationEventStage("note", "accepted"), "note");
  assert.equal(applicationEventStage("applied", "accepted"), undefined);
});

test("close outcome events resolve to the closed dashboard status", () => {
  assert.equal(applicationStatusAfterEvent("contract_signed", "employer_agreed"), "closed");
  assert.equal(applicationStatusAfterEvent("rejected", "interview_completed"), "closed");
});

test("dashboard accepted jobs can be enriched with canonical descriptions", () => {
  const job = {
    jobKey: "linkedin:123",
    title: "Job",
    link: null,
    applyUrl: null,
    canonicalFile: "data/canonical/2026-04-27.json",
  };
  const canonical = {
    items: [{
      identity: { jobId: "linkedin:123", source: "linkedin", sourceJobId: "123" },
      description: { text: "First.\n\nSecond.", html: "<p>First.</p><p>Second.</p>" },
      application: {
        jobUrl: "https://www.linkedin.com/jobs/view/123/",
        applyUrl: "https://employer.example/apply/123",
      },
    }],
  };

  const enriched = enrichAcceptedJobFromCanonical(job, canonical);
  assert.deepEqual(enriched.description, {
    text: "First.\n\nSecond.",
    html: "<p>First.</p><p>Second.</p>",
  });
  assert.equal(enriched.link, "https://www.linkedin.com/jobs/view/123/");
  assert.equal(enriched.applyUrl, "https://employer.example/apply/123");
});

test("dashboard enrichment carries original posted date from canonical timing", () => {
  const job = {
    jobKey: "linkedin:123",
    title: "Job",
    canonicalFile: "data/canonical/2026-04-27.json",
  };
  const canonical = {
    items: [{
      identity: { jobId: "linkedin:123", source: "linkedin", sourceJobId: "123" },
      timing: { postedAt: "2026-04-24T10:45:51Z" },
      description: { text: "Already present in canonical." },
    }],
  };

  const enriched = enrichAcceptedJobFromCanonical(job, canonical);

  assert.deepEqual(enriched.timing, { postedAt: "2026-04-24T10:45:51Z" });
});

test("dashboard enrichment infers on-site work mode from legacy location text", () => {
  const job = {
    jobKey: "linkedin:123",
    title: "Job",
    location: "Stuttgart, Germany (On-site)",
    workplaceType: "unknown",
  };

  assert.equal(enrichAcceptedJobFromCanonical(job, { items: [] }).workplaceType, "on_site");
});

test("batch metadata lists dated canonical files with selected and total counts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-batches-"));
  fs.mkdirSync(path.join(root, "data", "canonical"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "selected"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "annotations"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "canonical", "2026-04-26.json"), JSON.stringify({
    items: [{ id: "1" }, { id: "2" }],
  }));
  fs.writeFileSync(path.join(root, "data", "selected", "2026-04-26.json"), JSON.stringify({
    items: [{ id: "1" }],
  }));
  fs.writeFileSync(path.join(root, "data", "canonical", "2026-04-27.json"), JSON.stringify({
    items: [{ id: "1" }, { id: "2" }, { id: "3" }],
  }));

  assert.deepEqual(listBatchMetadata({ rootDir: root }), [
    {
      date: "2026-04-26",
      canonicalFile: "data/canonical/2026-04-26.json",
      selectedFile: "data/selected/2026-04-26.json",
      totalCount: 2,
      selectedCount: 1,
      deletedCount: 0,
    },
    {
      date: "2026-04-27",
      canonicalFile: "data/canonical/2026-04-27.json",
      selectedFile: "data/selected/2026-04-27.json",
      totalCount: 3,
      selectedCount: 0,
      deletedCount: 0,
    },
  ]);
});

test("batch metadata uses effective review queue counts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-effective-batches-"));
  fs.mkdirSync(path.join(root, "data", "canonical"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "selected"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "annotations"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "canonical", "2026-04-25.json"), JSON.stringify({
    items: [
      { identity: { jobId: "linkedin:1" } },
      { identity: { jobId: "linkedin:2" } },
      { identity: { jobId: "linkedin:3" } },
      { identity: { jobId: "linkedin:4" } },
    ],
  }));
  fs.writeFileSync(path.join(root, "data", "selected", "2026-04-25.json"), JSON.stringify({
    items: [
      { identity: { jobId: "linkedin:1" } },
      { identity: { jobId: "linkedin:2" } },
    ],
  }));
  fs.writeFileSync(path.join(root, "data", "annotations", "2026-04-25.json"), JSON.stringify({
    items: [{ id: "linkedin:2", decision: "reject" }],
  }));
  fs.writeFileSync(path.join(root, "data", "accepted-jobs.json"), JSON.stringify({
    items: [{ jobKey: "linkedin:3" }],
  }));

  const [batch] = listBatchMetadata({ rootDir: root });

  assert.equal(batch.selectedCount, 1);
  assert.equal(batch.totalCount, 3);
});

test("batch metadata keeps hard-rule deleted jobs out of selected and rejected totals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-deleted-batches-"));
  fs.mkdirSync(path.join(root, "data", "canonical"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "selected"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "deleted"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "annotations"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "canonical", "2026-05-08.json"), JSON.stringify({
    items: [
      { identity: { jobId: "linkedin:1" } },
      { identity: { jobId: "linkedin:2" } },
      { identity: { jobId: "linkedin:3" } },
    ],
  }));
  fs.writeFileSync(path.join(root, "data", "selected", "2026-05-08.json"), JSON.stringify({
    items: [{ identity: { jobId: "linkedin:2" } }],
  }));
  fs.writeFileSync(path.join(root, "data", "deleted", "2026-05-08.json"), JSON.stringify({
    items: [{ identity: { jobId: "linkedin:1" }, _deleted: { rules: [{ id: "posted_too_old" }] } }],
  }));

  const [batch] = listBatchMetadata({ rootDir: root });

  assert.equal(batch.selectedCount, 1);
  assert.equal(batch.deletedCount, 1);
  assert.equal(batch.totalCount, 2);
});

test("batch metadata excludes jobs rejected in earlier batches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-historical-rejects-"));
  fs.mkdirSync(path.join(root, "data", "canonical"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "selected"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "annotations"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "canonical", "2026-05-07.json"), JSON.stringify({
    items: [{ identity: { jobId: "linkedin:1" } }],
  }));
  fs.writeFileSync(path.join(root, "data", "selected", "2026-05-07.json"), JSON.stringify({
    items: [{ identity: { jobId: "linkedin:1" } }],
  }));
  fs.writeFileSync(path.join(root, "data", "annotations", "2026-05-07.json"), JSON.stringify({
    items: [{ id: "linkedin:1", decision: "reject" }],
  }));
  fs.writeFileSync(path.join(root, "data", "canonical", "2026-05-08.json"), JSON.stringify({
    items: [
      { identity: { jobId: "linkedin:1" } },
      { identity: { jobId: "linkedin:2" } },
    ],
  }));
  fs.writeFileSync(path.join(root, "data", "selected", "2026-05-08.json"), JSON.stringify({
    items: [
      { identity: { jobId: "linkedin:1" } },
      { identity: { jobId: "linkedin:2" } },
    ],
  }));

  const latest = listBatchMetadata({ rootDir: root }).at(-1);

  assert.equal(latest.date, "2026-05-08");
  assert.equal(latest.selectedCount, 1);
  assert.equal(latest.totalCount, 1);
});

test("batch metadata returns only the seven most recent batches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-finder-recent-batches-"));
  fs.mkdirSync(path.join(root, "data", "canonical"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "selected"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "annotations"), { recursive: true });
  for (let day = 1; day <= 9; day += 1) {
    const date = `2026-04-${String(day).padStart(2, "0")}`;
    fs.writeFileSync(path.join(root, "data", "canonical", `${date}.json`), JSON.stringify({
      items: [{ id: date }],
    }));
  }

  assert.deepEqual(listBatchMetadata({ rootDir: root }).map((batch) => batch.date), [
    "2026-04-03",
    "2026-04-04",
    "2026-04-05",
    "2026-04-06",
    "2026-04-07",
    "2026-04-08",
    "2026-04-09",
  ]);
});
