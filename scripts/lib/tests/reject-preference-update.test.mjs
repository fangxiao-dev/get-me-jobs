import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runRejectPreferenceUpdate } from "../../update-reject-preferences.mjs";
import {
  applyRejectPreferenceProposal,
  extractRejectPreferenceProposalFromMarkdown,
  generateRejectPreferenceProposal,
  hashJson,
  hashPreferences,
  serializeRejectPreferenceProposalMarkdown,
} from "../reject-preference-update.mjs";

function job(id, extra = {}) {
  return {
    identity: { jobId: `linkedin:${id}` },
    title: { raw: extra.title ?? "Master Thesis AI" },
    description: { text: extra.description ?? "Machine learning research." },
    company: {
      name: extra.company ?? "Acme",
      industry: extra.industry ?? "Software Development",
    },
    employment: { jobFunction: extra.jobFunction ?? "Engineering" },
  };
}

function basePreferences(extraExclude = []) {
  return {
    version: 1,
    rules: {
      must: [
        { id: "thesis_in_title", fields: ["title.raw"], terms: ["master thesis"] },
        { id: "ai_related", fields: ["title.raw", "description.text"], terms: ["AI", "machine learning"] },
      ],
      exclude: [
        {
          id: "not_obvious_exclusion_yet",
          description: "Keep empty until false positives are reviewed.",
          fields: ["title.raw", "description.text"],
          terms: [],
        },
        ...extraExclude,
      ],
    },
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("proposal analyzes only rejected selected jobs as primary false positives", () => {
  const canonical = {
    date: "2026-05-07",
    items: [
      job("1", { industry: "Marketing Services", description: "AI content marketing automation." }),
      job("2", { industry: "Marketing Services", description: "Marketing analytics with AI." }),
      job("3", { industry: "Software Development", description: "AI compiler research." }),
      job("4", { industry: "Marketing Services", description: "Filtered out already." }),
    ],
  };
  const selected = { items: [canonical.items[0], canonical.items[1], canonical.items[2]] };
  const annotations = {
    items: [
      { id: "linkedin:1", decision: "reject", note: "", tags: [] },
      { id: "linkedin:2", decision: "reject", note: "", tags: [] },
      { id: "linkedin:3", decision: "accept", note: "", tags: [] },
      { id: "linkedin:4", decision: "reject", note: "", tags: [] },
    ],
  };

  const proposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences: basePreferences(),
    now: "2026-05-07T10:00:00.000Z",
  });

  assert.equal(proposal.summary.rejectedCount, 3);
  assert.equal(proposal.summary.selectedFalsePositiveCount, 2);
  assert.deepEqual(proposal.proposedRule.terms, ["marketing services"]);
  assert.deepEqual(proposal.impact.wouldRemoveSelectedJobIds, ["linkedin:1", "linkedin:2"]);
  assert.deepEqual(proposal.impact.acceptedOrMaybeConflictJobIds, []);
  assert.equal(proposal.inputs.preferencesHash, hashPreferences(basePreferences()));
  assert.equal(proposal.inputs.selectedHash, hashJson(selected));
  assert.equal(proposal.inputs.annotationsHash, hashJson(annotations));
  assert.deepEqual(proposal.evidence[0].supportingRejectedJobIds, ["linkedin:1", "linkedin:2"]);
});

test("proposal includes explicit namespaced note terms with one rejected supporting job", () => {
  const rejected = job("1", { description: "Chemistry synthesis automation with AI." });
  const canonical = { date: "2026-05-07", items: [rejected] };
  const selected = { items: [rejected] };
  const annotations = {
    items: [
      { id: "linkedin:1", decision: "reject", note: "exclude: chemistry synthesis", tags: ["too_lab"] },
    ],
  };

  const proposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences: basePreferences(),
    now: "2026-05-07T10:00:00.000Z",
  });

  assert.deepEqual(proposal.proposedRule.terms, ["chemistry synthesis"]);
});

test("proposal does not turn plain tags into exclude terms", () => {
  const rejected = job("1", { description: "Lab automation with AI.", industry: "Research Services" });
  const canonical = { date: "2026-05-07", items: [rejected] };
  const selected = { items: [rejected] };
  const annotations = {
    items: [
      { id: "linkedin:1", decision: "reject", note: "", tags: ["too_lab"] },
    ],
  };

  const proposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences: basePreferences(),
    now: "2026-05-07T10:00:00.000Z",
  });

  assert.deepEqual(proposal.proposedRule.terms, []);
});

test("proposal excludes rejected jobs carrying good_topic from future reject terms", () => {
  const interestingButRejected = job("1", { industry: "Marketing Services", description: "AI content marketing automation." });
  const rejected = job("2", { industry: "Marketing Services", description: "Marketing analytics with AI." });
  const canonical = { date: "2026-05-07", items: [interestingButRejected, rejected] };
  const selected = { items: [interestingButRejected, rejected] };
  const annotations = {
    items: [
      { id: "linkedin:1", decision: "reject", note: "date too old but topic is relevant", tags: ["good_topic", "stale_post"] },
      { id: "linkedin:2", decision: "reject", note: "", tags: ["domain_mismatch"] },
    ],
  };

  const proposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences: basePreferences(),
  });

  assert.deepEqual(proposal.proposedRule.terms, []);
  assert.equal(proposal.summary.selectedFalsePositiveCount, 1);
});

test("proposal does not count free text mentions as structured candidate support", () => {
  const structuredMarketing = job("1", {
    industry: "Marketing Services",
    description: "AI content automation.",
  });
  const freeTextMarketing = job("2", {
    industry: "Software Development",
    description: "AI tooling for Marketing Services teams.",
  });
  const canonical = { date: "2026-05-07", items: [structuredMarketing, freeTextMarketing] };
  const selected = { items: [structuredMarketing, freeTextMarketing] };
  const annotations = {
    items: [
      { id: "linkedin:1", decision: "reject", note: "", tags: [] },
      { id: "linkedin:2", decision: "reject", note: "", tags: [] },
    ],
  };

  const proposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences: basePreferences(),
    now: "2026-05-07T10:00:00.000Z",
  });

  assert.deepEqual(proposal.proposedRule.terms, []);
});

test("proposal uses deterministic omitted now and recognizes bad industry namespaces", () => {
  const rejected = job("1", { description: "Climate tech biotech automation with AI." });
  const canonical = { date: "2026-05-07", items: [rejected] };
  const selected = { items: [rejected] };
  const annotations = {
    items: [
      {
        id: "linkedin:1",
        decision: "reject",
        note: "bad-industry: climate tech",
        tags: ["bad_industry: biotech"],
      },
    ],
  };

  const proposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences: basePreferences(),
  });

  assert.equal(proposal.createdAt, "2026-05-07T00:00:00.000Z");
  assert.deepEqual(proposal.proposedRule.terms, ["biotech", "climate tech"]);
});

test("proposal markdown includes readable summary and fenced machine-readable JSON", () => {
  const proposal = {
    schemaVersion: 1,
    type: "reject_preference_update",
    date: "2026-05-07",
    createdAt: "2026-05-07T10:00:00.000Z",
    summary: {
      canonicalCount: 3,
      selectedCount: 2,
      annotationCount: 2,
      rejectedCount: 1,
      selectedFalsePositiveCount: 1,
    },
    impact: {
      wouldRemoveSelectedJobIds: ["linkedin:1"],
      acceptedOrMaybeConflictJobIds: [],
    },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw"],
      terms: ["marketing services"],
    },
    evidence: [{
      term: "marketing services",
      supportingRejectedJobIds: ["linkedin:1"],
      rejectedMatches: 1,
      selectedMatches: 1,
      acceptedOrMaybeMatches: 0,
      reason: "Appears in rejected selected jobs.",
    }],
    warnings: [],
  };

  const markdown = serializeRejectPreferenceProposalMarkdown(proposal);
  assert.match(markdown, /^# Reject Preference Proposal 2026-05-07/m);
  assert.match(markdown, /## Proposed Terms/);
  assert.match(markdown, /- `marketing services`/);
  assert.match(markdown, /```json reject-preference-proposal/);
  assert.deepEqual(extractRejectPreferenceProposalFromMarkdown(markdown), proposal);
});

test("apply converts empty placeholder rule to manual reject rule", () => {
  const preferences = basePreferences();
  const proposal = {
    schemaVersion: 1,
    type: "reject_preference_update",
    date: "2026-05-07",
    inputs: { preferencesVersion: 1, preferencesHash: hashPreferences(preferences) },
    proposedRule: {
      id: "manual_reject_patterns",
      description: "Terms inferred from manually rejected selected jobs. Apply only after review.",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [],
  };

  const next = applyRejectPreferenceProposal(preferences, proposal);

  assert.deepEqual(next.rules.exclude, [
    {
      id: "manual_reject_patterns",
      description: "Terms inferred from manually rejected selected jobs. Apply only after review.",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
  ]);
});

test("apply appends unique terms to an existing manual reject rule", () => {
  const preferences = {
    version: 1,
    rules: {
      must: [],
      exclude: [
        {
          id: "manual_reject_patterns",
          description: "Terms inferred from manually rejected selected jobs. Apply only after review.",
          fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
          terms: ["sales"],
        },
      ],
    },
  };
  const proposal = {
    schemaVersion: 1,
    type: "reject_preference_update",
    date: "2026-05-07",
    inputs: { preferencesVersion: 1, preferencesHash: hashPreferences(preferences) },
    proposedRule: {
      id: "manual_reject_patterns",
      description: "Terms inferred from manually rejected selected jobs. Apply only after review.",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services", "sales"],
    },
    warnings: [],
  };

  const next = applyRejectPreferenceProposal(preferences, proposal);

  assert.deepEqual(next.rules.exclude[0].terms, ["marketing services", "sales"]);
});

test("apply refuses proposals with accepted or maybe conflicts", () => {
  const preferences = basePreferences();
  const proposal = {
    schemaVersion: 1,
    type: "reject_preference_update",
    date: "2026-05-07",
    inputs: { preferencesVersion: 1, preferencesHash: hashPreferences(preferences) },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [{ type: "accepted_or_maybe_conflict", term: "marketing services", jobIds: ["linkedin:9"] }],
  };

  assert.throws(
    () => applyRejectPreferenceProposal(preferences, proposal),
    /accepted\/maybe conflicts/,
  );
});

test("apply refuses stale preference hashes", () => {
  const preferences = basePreferences();
  const proposal = {
    schemaVersion: 1,
    type: "reject_preference_update",
    date: "2026-05-07",
    inputs: { preferencesVersion: 1, preferencesHash: "stale" },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [],
  };

  assert.throws(
    () => applyRejectPreferenceProposal(preferences, proposal),
    /preference hash/,
  );
});

test("apply ignores conflict warnings for terms that are not proposed", () => {
  const preferences = basePreferences();
  const proposal = {
    schemaVersion: 1,
    type: "reject_preference_update",
    date: "2026-05-07",
    inputs: { preferencesVersion: 1, preferencesHash: hashPreferences(preferences) },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [{ type: "accepted_or_maybe_conflict", term: "software development", jobIds: ["linkedin:9"] }],
  };

  const next = applyRejectPreferenceProposal(preferences, proposal);

  assert.deepEqual(next.rules.exclude[0].terms, ["marketing services"]);
});

test("CLI runner writes proposal without mutating preferences", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-proposal-"));
  const date = "2026-05-07";
  const rejected1 = job("1", { industry: "Marketing Services", description: "AI content marketing automation." });
  const rejected2 = job("2", { industry: "Marketing Services", description: "Marketing analytics with AI." });
  const accepted = job("3", { industry: "Software Development", description: "AI compiler research." });
  const preferences = basePreferences();

  writeJson(path.join(root, "data", "canonical", `${date}.json`), { date, items: [rejected1, rejected2, accepted] });
  writeJson(path.join(root, "data", "selected", `${date}.json`), { date, items: [rejected1, rejected2, accepted] });
  writeJson(path.join(root, "data", "annotations", `${date}.json`), {
    date,
    items: [
      { id: "linkedin:1", decision: "reject", note: "", tags: [] },
      { id: "linkedin:2", decision: "reject", note: "", tags: [] },
      { id: "linkedin:3", decision: "accept", note: "", tags: [] },
    ],
  });
  writeJson(path.join(root, "config", "preferences.linkedin.json"), preferences);

  const result = runRejectPreferenceUpdate({ cwd: root, argv: [date], now: "2026-05-07T10:00:00.000Z" });

  assert.equal(result.mode, "proposal");
  assert.equal(result.proposal.proposedRule.terms[0], "marketing services");
  assert.equal(result.proposal.inputs.preferencesHash, hashPreferences(preferences));
  assert.equal(result.proposal.inputs.selectedHash, hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "selected", `${date}.json`), "utf8"))));
  assert.equal(result.proposal.inputs.annotationsHash, hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "annotations", `${date}.json`), "utf8"))));
  assert.deepEqual(result.proposal.impact.wouldRemoveSelectedJobIds, ["linkedin:1", "linkedin:2"]);
  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  assert.equal(result.proposalPath, proposalPath);
  assert.equal(fs.existsSync(proposalPath), true);
  assert.deepEqual(
    extractRejectPreferenceProposalFromMarkdown(fs.readFileSync(proposalPath, "utf8")),
    result.proposal,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "config", "preferences.linkedin.json"), "utf8")),
    preferences,
  );
});

test("CLI runner refuses to overwrite an existing markdown proposal without explicit overwrite", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-existing-md-"));
  const date = "2026-05-07";
  const rejected = job("1", { industry: "Marketing Services", description: "AI content marketing automation." });
  writeJson(path.join(root, "data", "canonical", `${date}.json`), { date, items: [rejected] });
  writeJson(path.join(root, "data", "selected", `${date}.json`), { date, items: [rejected] });
  writeJson(path.join(root, "data", "annotations", `${date}.json`), {
    date,
    items: [{ id: "linkedin:1", decision: "reject", note: "exclude: marketing services", tags: [] }],
  });
  writeJson(path.join(root, "config", "preferences.linkedin.json"), basePreferences());
  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, "manual edits", "utf8");

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date] }),
    /already exists/,
  );

  const result = runRejectPreferenceUpdate({ cwd: root, argv: [date, "--overwrite"] });
  assert.equal(result.proposalPath, proposalPath);
  assert.notEqual(fs.readFileSync(proposalPath, "utf8"), "manual edits");
});

test("CLI runner applies a proposal and regenerates selected output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-apply-"));
  const date = "2026-05-07";
  const rejected1 = job("1", { industry: "Marketing Services", description: "AI content marketing automation." });
  const rejected2 = job("2", { industry: "Marketing Services", description: "Marketing analytics with AI." });
  const accepted = job("3", { industry: "Software Development", description: "AI compiler research." });

  writeJson(path.join(root, "data", "canonical", `${date}.json`), { schemaVersion: 1, date, items: [rejected1, rejected2, accepted] });
  writeJson(path.join(root, "data", "selected", `${date}.json`), { date, items: [rejected1, rejected2, accepted] });
  writeJson(path.join(root, "data", "annotations", `${date}.json`), { date, items: [] });
  const preferences = basePreferences();
  writeJson(path.join(root, "config", "preferences.linkedin.json"), preferences);

  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, serializeRejectPreferenceProposalMarkdown({
    schemaVersion: 1,
    type: "reject_preference_update",
    date,
    inputs: {
      preferencesVersion: 1,
      preferencesHash: hashPreferences(preferences),
      selectedHash: hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "selected", `${date}.json`), "utf8"))),
      annotationsHash: hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "annotations", `${date}.json`), "utf8"))),
    },
    proposedRule: {
      id: "manual_reject_patterns",
      description: "Terms inferred from manually rejected selected jobs. Apply only after review.",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [],
  }), "utf8");

  const result = runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] });
  const nextPreferences = JSON.parse(fs.readFileSync(path.join(root, "config", "preferences.linkedin.json"), "utf8"));
  const nextSelected = JSON.parse(fs.readFileSync(path.join(root, "data", "selected", `${date}.json`), "utf8"));

  assert.equal(result.mode, "apply");
  assert.deepEqual(nextPreferences.rules.exclude[0].terms, ["marketing services"]);
  assert.deepEqual(nextSelected.items.map((item) => item.identity.jobId), ["linkedin:3"]);
});

test("CLI runner force rewrites selected output when selected ids are unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-force-write-"));
  const date = "2026-05-07";
  const selectedJob = job("1", { industry: "Software Development", description: "AI compiler research." });
  const preferences = basePreferences();

  writeJson(path.join(root, "data", "canonical", `${date}.json`), { schemaVersion: 1, date, items: [selectedJob] });
  writeJson(path.join(root, "data", "selected", `${date}.json`), {
    schemaVersion: 1,
    date,
    savedAt: "2026-05-07T00:00:00.000Z",
    preferencesFile: "config/preferences.linkedin.json",
    preferencesVersion: 1,
    items: [selectedJob],
  });
  writeJson(path.join(root, "data", "annotations", `${date}.json`), { date, items: [] });
  writeJson(path.join(root, "config", "preferences.linkedin.json"), preferences);

  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, serializeRejectPreferenceProposalMarkdown({
    schemaVersion: 1,
    type: "reject_preference_update",
    date,
    inputs: {
      preferencesVersion: 1,
      preferencesHash: hashPreferences(preferences),
      selectedHash: hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "selected", `${date}.json`), "utf8"))),
      annotationsHash: hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "annotations", `${date}.json`), "utf8"))),
    },
    proposedRule: {
      id: "manual_reject_patterns",
      description: "Terms inferred from manually rejected selected jobs. Apply only after review.",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marine biology"],
    },
    warnings: [],
  }), "utf8");

  runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] });

  const nextSelected = JSON.parse(fs.readFileSync(path.join(root, "data", "selected", `${date}.json`), "utf8"));
  assert.deepEqual(nextSelected.items.map((item) => item.identity.jobId), ["linkedin:1"]);
  assert.notEqual(nextSelected.savedAt, "2026-05-07T00:00:00.000Z");
});

test("CLI runner fails in proposal mode when selected output is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-missing-selected-"));
  const date = "2026-05-07";
  writeJson(path.join(root, "data", "canonical", `${date}.json`), { schemaVersion: 1, date, items: [] });
  writeJson(path.join(root, "data", "annotations", `${date}.json`), { date, items: [] });
  writeJson(path.join(root, "config", "preferences.linkedin.json"), basePreferences());

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date] }),
    /selected file not found/,
  );
});

test("CLI runner refuses stale selected or annotation inputs during apply", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-stale-inputs-"));
  const date = "2026-05-07";
  const selectedJob = job("1", { industry: "Software Development", description: "AI compiler research." });
  const preferences = basePreferences();

  writeJson(path.join(root, "data", "canonical", `${date}.json`), { schemaVersion: 1, date, items: [selectedJob] });
  writeJson(path.join(root, "data", "selected", `${date}.json`), { date, items: [selectedJob] });
  writeJson(path.join(root, "data", "annotations", `${date}.json`), { date, items: [] });
  writeJson(path.join(root, "config", "preferences.linkedin.json"), preferences);

  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, serializeRejectPreferenceProposalMarkdown({
    schemaVersion: 1,
    type: "reject_preference_update",
    date,
    inputs: {
      preferencesVersion: 1,
      preferencesHash: hashPreferences(preferences),
      selectedHash: "stale",
      annotationsHash: hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "annotations", `${date}.json`), "utf8"))),
    },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [],
  }), "utf8");

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] }),
    /selected hash/,
  );
});

test("CLI runner refuses stale annotation inputs during apply", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-stale-annotations-"));
  const date = "2026-05-07";
  const selectedJob = job("1", { industry: "Software Development", description: "AI compiler research." });
  const preferences = basePreferences();

  writeJson(path.join(root, "data", "canonical", `${date}.json`), { schemaVersion: 1, date, items: [selectedJob] });
  writeJson(path.join(root, "data", "selected", `${date}.json`), { date, items: [selectedJob] });
  writeJson(path.join(root, "data", "annotations", `${date}.json`), { date, items: [] });
  writeJson(path.join(root, "config", "preferences.linkedin.json"), preferences);

  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, serializeRejectPreferenceProposalMarkdown({
    schemaVersion: 1,
    type: "reject_preference_update",
    date,
    inputs: {
      preferencesVersion: 1,
      preferencesHash: hashPreferences(preferences),
      selectedHash: hashJson(JSON.parse(fs.readFileSync(path.join(root, "data", "selected", `${date}.json`), "utf8"))),
      annotationsHash: "stale",
    },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [],
  }), "utf8");

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] }),
    /annotations hash/,
  );
});

test("CLI runner refuses edited proposed terms that conflict with accepted selected jobs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-edited-conflict-"));
  const date = "2026-05-07";
  const accepted = job("1", { industry: "Software Development", description: "AI compiler research." });
  const rejected = job("2", { industry: "Marketing Services", description: "Marketing analytics with AI." });
  const preferences = basePreferences();
  const selected = { date, items: [accepted, rejected] };
  const annotations = {
    date,
    items: [
      { id: "linkedin:1", decision: "accept", note: "", tags: [] },
      { id: "linkedin:2", decision: "reject", note: "", tags: [] },
    ],
  };

  writeJson(path.join(root, "data", "canonical", `${date}.json`), { schemaVersion: 1, date, items: [accepted, rejected] });
  writeJson(path.join(root, "data", "selected", `${date}.json`), selected);
  writeJson(path.join(root, "data", "annotations", `${date}.json`), annotations);
  writeJson(path.join(root, "config", "preferences.linkedin.json"), preferences);

  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, serializeRejectPreferenceProposalMarkdown({
    schemaVersion: 1,
    type: "reject_preference_update",
    date,
    inputs: {
      preferencesVersion: 1,
      preferencesHash: hashPreferences(preferences),
      selectedHash: hashJson(selected),
      annotationsHash: hashJson(annotations),
    },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["software development"],
    },
    warnings: [],
  }), "utf8");

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] }),
    /accepted\/maybe conflicts/,
  );
});

test("CLI runner restores preferences when selection regeneration fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reject-pref-rollback-"));
  const date = "2026-05-07";
  const selectedJob = job("1", { industry: "Software Development", description: "AI compiler research." });
  const preferences = basePreferences();
  const selected = { date, items: [selectedJob] };
  const annotations = { date, items: [] };

  fs.mkdirSync(path.join(root, "data", "canonical"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "canonical", `${date}.json`), "{ malformed", "utf8");
  writeJson(path.join(root, "data", "selected", `${date}.json`), selected);
  writeJson(path.join(root, "data", "annotations", `${date}.json`), annotations);
  writeJson(path.join(root, "config", "preferences.linkedin.json"), preferences);

  const proposalPath = path.join(root, "docs", "preference-proposals", `rejects-${date}.md`);
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, serializeRejectPreferenceProposalMarkdown({
    schemaVersion: 1,
    type: "reject_preference_update",
    date,
    inputs: {
      preferencesVersion: 1,
      preferencesHash: hashPreferences(preferences),
      selectedHash: hashJson(selected),
      annotationsHash: hashJson(annotations),
    },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [],
  }), "utf8");

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] }),
    /JSON/,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "config", "preferences.linkedin.json"), "utf8")),
    preferences,
  );
});

test("manual reject field arrays are isolated across generated and applied outputs", () => {
  const rejected = job("1", { description: "Chemistry synthesis automation with AI." });
  const canonical = { date: "2026-05-07", items: [rejected] };
  const selected = { items: [rejected] };
  const annotations = {
    items: [
      { id: "linkedin:1", decision: "reject", note: "exclude: chemistry synthesis", tags: [] },
    ],
  };
  const preferences = basePreferences();

  const proposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences,
  });
  proposal.proposedRule.fields.push("mutated.field");

  const nextProposal = generateRejectPreferenceProposal({
    date: "2026-05-07",
    canonical,
    selected,
    annotations,
    preferences,
  });
  assert.deepEqual(nextProposal.proposedRule.fields, [
    "title.raw",
    "description.text",
    "company.industry",
    "employment.jobFunction",
  ]);

  const applyProposal = {
    schemaVersion: 1,
    type: "reject_preference_update",
    date: "2026-05-07",
    inputs: { preferencesVersion: 1, preferencesHash: hashPreferences(preferences) },
    proposedRule: {
      id: "manual_reject_patterns",
      fields: ["title.raw", "description.text", "company.industry", "employment.jobFunction"],
      terms: ["marketing services"],
    },
    warnings: [],
  };
  const next = applyRejectPreferenceProposal(preferences, applyProposal);
  next.rules.exclude[0].fields.push("mutated.field");

  const later = applyRejectPreferenceProposal(preferences, applyProposal);
  assert.deepEqual(later.rules.exclude[0].fields, [
    "title.raw",
    "description.text",
    "company.industry",
    "employment.jobFunction",
  ]);
});
