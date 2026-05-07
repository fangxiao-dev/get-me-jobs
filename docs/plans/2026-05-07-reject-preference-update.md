# Explicit Reject Preference Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents unless the user explicitly asks for parallel execution.

**Goal:** Implement an explicit `npm run preferences:update-rejects -- <date>` workflow that analyzes manually rejected selected jobs, writes a proposal artifact by default, and only updates `config/preferences.linkedin.json` when invoked with `--apply`.

**Architecture:** Keep matching semantics shared with `scripts/select-jobs.mjs` by extracting selector helpers into `scripts/lib/preferences.mjs`. Put proposal/apply logic in a pure library, `scripts/lib/reject-preference-update.mjs`, and keep filesystem/CLI behavior in `scripts/update-reject-preferences.mjs`. Proposal artifacts include a preference content hash and impact job IDs so apply mode can reject stale proposals and humans can review concrete effects before applying.

**Tech Stack:** Node.js ESM, Node built-in `node:test`, JSON file stores, existing `scripts/select-jobs.mjs` selector.

---

## Source Design

This plan implements:

- `docs/plans/2026-05-07-reject-preference-update-design.md`

Required behavior:

- Analyze only when explicitly commanded.
- Default command writes a proposal and does not mutate preferences.
- Apply command is the confirmation boundary.
- Focus initial evidence on `decision: "reject"` jobs that are present in `data/selected/<date>.json`.
- Reject if proposal terms would exclude accepted or maybe selected jobs.
- Do not trigger Apify.
- Do not mutate `data/raw/` or `data/canonical/`.

## File Structure

Create or modify these files:

```text
scripts/
  select-jobs.mjs                              # modify: import shared preference helpers
  update-reject-preferences.mjs                # create: CLI/filesystem wrapper
  lib/
    preferences.mjs                            # create: shared selector/matching helpers
    reject-preference-update.mjs               # create: proposal/apply pure functions
    tests/
      preferences.test.mjs                     # create: preserve selector helper semantics
      reject-preference-update.test.mjs        # create: proposal/apply tests

config/
  preferences.linkedin.json                    # runtime target only; tests must not modify tracked file

docs/plans/
  2026-05-07-reject-preference-update-design.md
  2026-05-07-reject-preference-update.md       # this plan

.gitignore                                    # modify: ignore data/preference-proposals/
README.md                                     # modify: document command and confirmation boundary
package.json                                  # modify: add npm script
```

Do not modify Review/Dashboard reject button behavior in this implementation.

## Candidate Term Rules For V1

Implement a conservative deterministic extractor. The goal is useful safe proposals, not maximum recall.

Candidate sources:

- explicit namespaced annotation tags such as `exclude:chemistry synthesis`
- explicit namespaced annotation notes such as `exclude: chemistry synthesis` or `bad_industry: Marketing Services`
- structured fields: `company.industry`
- structured fields: `employment.jobFunction`

Normalization:

- trim
- lowercase
- collapse whitespace
- strip explicit namespace prefixes `exclude:`, `reject:`, and `bad_industry:`
- discard values shorter than 3 characters unless in `["ai", "ml", "nlp", "llm"]`
- discard stopwords and generic positive terms listed in the implementation task

Inclusion:

- include explicit namespaced note/tag terms when they match at least one rejected selected job and zero accepted/maybe selected jobs
- include `company.industry` and `employment.jobFunction` terms when they appear in at least two rejected selected jobs and zero accepted/maybe selected jobs

Do not mine free title or description tokens in V1. Plain tags such as `too_lab` remain evidence labels only; they must not become exclude terms unless expressed through an explicit namespace such as `exclude:lab work`.

## Task 1: Extract Shared Preference Matching Helpers

**Files:**

- Create: `scripts/lib/preferences.mjs`
- Create: `scripts/lib/tests/preferences.test.mjs`
- Modify: `scripts/select-jobs.mjs`

- [ ] **Step 1: Write failing tests for shared matching semantics**

Create `scripts/lib/tests/preferences.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateRule,
  pickFields,
  selectItems,
  stableId,
  termMatches,
} from "../preferences.mjs";

test("pickFields reads dot paths and joins text", () => {
  const item = {
    title: { raw: "Master Thesis" },
    description: { text: ["AI", "Computer Vision"] },
    company: { industry: "Software" },
  };

  assert.equal(
    pickFields(item, ["title.raw", "description.text", "company.industry"]),
    "Master Thesis\nAI\nComputer Vision\nSoftware",
  );
});

test("termMatches uses boundaries for short technical tokens", () => {
  assert.equal(termMatches("AI thesis role", "AI"), true);
  assert.equal(termMatches("paid internship", "AI"), false);
  assert.equal(termMatches("GenAI thesis role", "AI"), false);
});

test("evaluateRule reports matched terms", () => {
  const result = evaluateRule(
    { title: { raw: "Master thesis for machine learning" } },
    { id: "topic", fields: ["title.raw"], terms: ["master thesis", "robotics"] },
  );

  assert.deepEqual(result, {
    id: "topic",
    description: undefined,
    passed: true,
    matchedTerms: ["master thesis"],
  });
});

test("selectItems applies must and exclude rules", () => {
  const raw = {
    items: [
      { identity: { jobId: "linkedin:1" }, title: { raw: "Master thesis AI" }, description: { text: "research" } },
      { identity: { jobId: "linkedin:2" }, title: { raw: "Master thesis AI" }, description: { text: "sales" } },
      { identity: { jobId: "linkedin:3" }, title: { raw: "Internship AI" }, description: { text: "research" } },
    ],
  };
  const preferences = {
    rules: {
      must: [
        { id: "thesis", fields: ["title.raw"], terms: ["master thesis"] },
        { id: "ai", fields: ["title.raw"], terms: ["AI"] },
      ],
      exclude: [
        { id: "manual_reject_patterns", fields: ["description.text"], terms: ["sales"] },
      ],
    },
  };

  assert.deepEqual(selectItems(raw, preferences).map(({ item }) => stableId(item)), ["linkedin:1"]);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
node --test scripts/lib/tests/preferences.test.mjs
```

Expected: FAIL with module not found for `../preferences.mjs`.

- [ ] **Step 3: Create shared helper module**

Create `scripts/lib/preferences.mjs`:

```js
export function toText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(toText).join("\n");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getField(obj, dotPath) {
  return dotPath.split(".").reduce((curr, key) => curr?.[key], obj);
}

export function pickFields(item, fields) {
  return fields.map((field) => toText(getField(item, field))).filter(Boolean).join("\n");
}

export function termMatches(text, term) {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedTerm = term.toLocaleLowerCase();

  if (/^[a-z0-9.+#-]+$/i.test(term) && term.length <= 4) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  }

  return normalizedText.includes(normalizedTerm);
}

export function evaluateRule(item, rule) {
  const text = pickFields(item, rule.fields ?? []);
  const matchedTerms = (rule.terms ?? []).filter((term) => termMatches(text, term));

  return {
    id: rule.id,
    description: rule.description,
    passed: matchedTerms.length > 0,
    matchedTerms,
  };
}

export function selectItems(raw, preferences) {
  const mustRules = preferences.rules?.must ?? [];
  const excludeRules = preferences.rules?.exclude ?? [];

  return (raw.items ?? [])
    .map((item) => {
      const must = mustRules.map((rule) => evaluateRule(item, rule));
      const exclude = excludeRules.map((rule) => evaluateRule(item, rule));
      const passed = must.every((result) => result.passed) && !exclude.some((result) => result.passed);

      return { item, match: { passed, must, exclude } };
    })
    .filter((result) => result.match.passed);
}

export function stableId(item) {
  return item.identity?.jobId ?? item.id ?? item.sourceJobId ?? item.link ?? item.url;
}
```

- [ ] **Step 4: Refactor `scripts/select-jobs.mjs` to import helpers**

In `scripts/select-jobs.mjs`, remove the local definitions of `toText`, `getField`, `pickFields`, `termMatches`, `evaluateRule`, `selectItems`, and `stableId`.

Add this import near the top:

```js
import { selectItems, stableId } from "./lib/preferences.mjs";
```

Add an explicit `forceWrite` option inside `selectJobsFile` so apply mode can refresh `_selection` details even when selected IDs do not change:

```js
  const forceWrite = Boolean(options.forceWrite);
  const selectionUnchanged = !forceWrite
    && JSON.stringify(selectedIds) === JSON.stringify(previousIds)
    && previousOutput?.preferencesVersion === preferences.version
    && previousOutput?.preferencesFile === preferencesFile;
```

Keep `readJson`, `writeJson`, the output shape, and CLI entrypoint otherwise unchanged.

- [ ] **Step 5: Verify helper and full test suite**

Run:

```powershell
node --test scripts/lib/tests/preferences.test.mjs
npm test
```

Expected: both PASS.

## Task 2: Add Proposal Generation Pure Functions

**Files:**

- Create: `scripts/lib/reject-preference-update.mjs`
- Create: `scripts/lib/tests/reject-preference-update.test.mjs`

- [ ] **Step 1: Write failing proposal-generation tests**

Create `scripts/lib/tests/reject-preference-update.test.mjs` with this first block:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateRejectPreferenceProposal,
  hashJson,
  hashPreferences,
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
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
node --test scripts/lib/tests/reject-preference-update.test.mjs
```

Expected: FAIL with module not found for `../reject-preference-update.mjs`.

- [ ] **Step 3: Implement core constants and helpers**

Create `scripts/lib/reject-preference-update.mjs` with:

```js
import crypto from "node:crypto";
import { pickFields, stableId, termMatches } from "./preferences.mjs";

export const MANUAL_REJECT_RULE_ID = "manual_reject_patterns";
export const MANUAL_REJECT_RULE_DESCRIPTION = "Terms inferred from manually rejected selected jobs. Apply only after review.";
export const MANUAL_REJECT_RULE_FIELDS = ["title.raw", "description.text", "company.industry", "employment.jobFunction"];

const SHORT_ALLOWED_TERMS = new Set(["ai", "ml", "nlp", "llm"]);
const STOPWORDS = new Set([
  "and", "are", "auf", "aus", "bei", "das", "der", "die", "ein", "eine", "for", "fur",
  "mit", "the", "und", "von", "with", "master", "thesis", "abschlussarbeit", "arbeit",
  "praktikum", "internship", "werkstudent", "werkstudententatigkeit", "ai", "ki",
  "machine", "learning", "data", "science", "research", "development", "engineering",
]);

function normalizeCandidate(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/^bad[_-]industry:/, "")
    .replace(/^(exclude|reject):/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulCandidate(value) {
  if (!value) return false;
  if (SHORT_ALLOWED_TERMS.has(value)) return true;
  if (value.length < 3) return false;
  if (STOPWORDS.has(value)) return false;
  return /[a-z0-9]/i.test(value);
}

function annotationExplicitTerms(annotation) {
  const values = [];
  for (const tag of annotation.tags ?? []) {
    if (/^(exclude|reject|bad_industry):/i.test(String(tag))) values.push(tag);
  }
  const note = String(annotation.note ?? "");
  for (const match of note.matchAll(/(?:exclude|reject|bad_industry):\s*([^,;.]+)/gi)) {
    values.push(match[1]);
  }
  return values.map(normalizeCandidate).filter(isUsefulCandidate);
}

export function hashJson(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function hashPreferences(preferences) {
  return hashJson(preferences);
}
```

- [ ] **Step 4: Implement proposal generation**

Continue in `scripts/lib/reject-preference-update.mjs`:

```js
function buildJobMap(items) {
  return new Map((items ?? []).map((item) => [String(stableId(item)), item]));
}

function existingExcludeTerms(preferences) {
  return new Set((preferences.rules?.exclude ?? []).flatMap((rule) => rule.terms ?? []).map(normalizeCandidate));
}

function candidateEntriesForRejectedJob(job, annotation) {
  const entries = [];
  for (const term of annotationExplicitTerms(annotation)) {
    entries.push({ term, source: "explicit" });
  }

  for (const field of ["company.industry", "employment.jobFunction"]) {
    const term = normalizeCandidate(pickFields(job, [field]));
    if (isUsefulCandidate(term)) entries.push({ term, source: field });
  }

  return entries;
}

function candidateMatchesJobs(term, jobs, fields = MANUAL_REJECT_RULE_FIELDS) {
  return jobs.filter((job) => termMatches(pickFields(job, fields), term));
}

function candidateMinimumSupport(sources) {
  if (sources.has("explicit")) return 1;
  return 2;
}

export function generateRejectPreferenceProposal({
  date,
  canonical,
  selected,
  annotations,
  preferences,
  now = new Date().toISOString(),
}) {
  const selectedById = buildJobMap(selected.items);
  const selectedItems = selected.items ?? [];
  const annotationItems = annotations.items ?? [];
  const acceptedOrMaybeIds = new Set(
    annotationItems
      .filter((annotation) => ["accept", "maybe"].includes(annotation.decision))
      .map((annotation) => String(annotation.id)),
  );
  const acceptedOrMaybeSelectedJobs = selectedItems.filter((item) => acceptedOrMaybeIds.has(String(stableId(item))));
  const rejectedAnnotations = annotationItems.filter((annotation) => annotation.decision === "reject");
  const rejectedSelected = rejectedAnnotations
    .map((annotation) => ({ annotation, job: selectedById.get(String(annotation.id)) }))
    .filter(({ job }) => Boolean(job));
  const existingTerms = existingExcludeTerms(preferences);
  const candidateMap = new Map();

  for (const { annotation, job } of rejectedSelected) {
    for (const entry of candidateEntriesForRejectedJob(job, annotation)) {
      if (existingTerms.has(entry.term)) continue;
      const current = candidateMap.get(entry.term) ?? { term: entry.term, sources: new Set(), supportingIds: new Set() };
      current.sources.add(entry.source);
      current.supportingIds.add(String(annotation.id));
      candidateMap.set(entry.term, current);
    }
  }

  const evidence = [];
  const warnings = [];
  const wouldRemoveSelectedJobIds = new Set();
  const acceptedOrMaybeConflictJobIds = new Set();

  for (const candidate of candidateMap.values()) {
    const supportingRejectedJobs = rejectedSelected
      .filter(({ job }) => termMatches(pickFields(job, MANUAL_REJECT_RULE_FIELDS), candidate.term));
    const acceptedOrMaybeMatches = candidateMatchesJobs(candidate.term, acceptedOrMaybeSelectedJobs);
    const selectedMatches = candidateMatchesJobs(candidate.term, selectedItems);
    const minimumSupport = candidateMinimumSupport(candidate.sources);

    if (supportingRejectedJobs.length < minimumSupport) continue;
    if (acceptedOrMaybeMatches.length > 0) {
      for (const job of acceptedOrMaybeMatches) acceptedOrMaybeConflictJobIds.add(String(stableId(job)));
      warnings.push({
        type: "accepted_or_maybe_conflict",
        term: candidate.term,
        jobIds: acceptedOrMaybeMatches.map(stableId).map(String),
      });
      continue;
    }

    for (const job of selectedMatches) wouldRemoveSelectedJobIds.add(String(stableId(job)));

    evidence.push({
      term: candidate.term,
      supportingRejectedJobIds: supportingRejectedJobs.map(({ annotation }) => String(annotation.id)).sort(),
      rejectedMatches: supportingRejectedJobs.length,
      acceptedOrMaybeMatches: 0,
      selectedMatches: selectedMatches.length,
      reason: "Appears in rejected selected jobs and does not appear in accepted/maybe selected jobs.",
    });
  }

  evidence.sort((a, b) => a.term.localeCompare(b.term));

  return {
    schemaVersion: 1,
    type: "reject_preference_update",
    date,
    createdAt: now,
    inputs: {
      canonicalFile: `data/canonical/${date}.json`,
      selectedFile: `data/selected/${date}.json`,
      annotationsFile: `data/annotations/${date}.json`,
      preferencesFile: "config/preferences.linkedin.json",
      preferencesVersion: preferences.version,
      preferencesHash: hashPreferences(preferences),
      selectedHash: hashJson(selected),
      annotationsHash: hashJson(annotations),
    },
    summary: {
      canonicalCount: canonical.items?.length ?? 0,
      selectedCount: selected.items?.length ?? 0,
      annotationCount: annotationItems.length,
      rejectedCount: rejectedAnnotations.length,
      selectedFalsePositiveCount: rejectedSelected.length,
    },
    impact: {
      wouldRemoveSelectedJobIds: [...wouldRemoveSelectedJobIds].sort(),
      acceptedOrMaybeConflictJobIds: [...acceptedOrMaybeConflictJobIds].sort(),
    },
    proposedRule: {
      id: MANUAL_REJECT_RULE_ID,
      description: MANUAL_REJECT_RULE_DESCRIPTION,
      fields: MANUAL_REJECT_RULE_FIELDS,
      terms: evidence.map((item) => item.term),
    },
    evidence,
    warnings,
  };
}
```

- [ ] **Step 5: Verify proposal tests**

Run:

```powershell
node --test scripts/lib/tests/reject-preference-update.test.mjs
```

Expected: PASS for proposal-generation tests.

## Task 3: Add Apply Logic And Conflict Validation

**Files:**

- Modify: `scripts/lib/reject-preference-update.mjs`
- Modify: `scripts/lib/tests/reject-preference-update.test.mjs`

- [ ] **Step 1: Add failing apply tests**

First update the top import in `scripts/lib/tests/reject-preference-update.test.mjs` to include `applyRejectPreferenceProposal`:

```js
import {
  applyRejectPreferenceProposal,
  generateRejectPreferenceProposal,
  hashJson,
  hashPreferences,
} from "../reject-preference-update.mjs";
```

Then append these tests to `scripts/lib/tests/reject-preference-update.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test and verify apply tests fail**

Run:

```powershell
node --test scripts/lib/tests/reject-preference-update.test.mjs
```

Expected: FAIL with `applyRejectPreferenceProposal` not implemented.

- [ ] **Step 3: Implement apply helpers**

Append to `scripts/lib/reject-preference-update.mjs`:

```js
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableSortedTerms(values) {
  return [...new Set(values.map(normalizeCandidate).filter(isUsefulCandidate))].sort((a, b) => a.localeCompare(b));
}

function assertValidProposal(preferences, proposal) {
  if (proposal.schemaVersion !== 1) throw new Error("Unsupported reject preference proposal schemaVersion.");
  if (proposal.type !== "reject_preference_update") throw new Error("Unsupported reject preference proposal type.");
  if (proposal.proposedRule?.id !== MANUAL_REJECT_RULE_ID) throw new Error("Proposal does not target manual reject patterns.");
  const proposedTerms = new Set((proposal.proposedRule?.terms ?? []).map(normalizeCandidate));
  const hasProposedConflict = (proposal.warnings ?? []).some((warning) => {
    return warning.type === "accepted_or_maybe_conflict" && proposedTerms.has(normalizeCandidate(warning.term));
  });
  if (hasProposedConflict) {
    throw new Error("Cannot apply proposal with accepted/maybe conflicts.");
  }
  if (proposal.inputs?.preferencesVersion !== preferences.version) {
    throw new Error("Cannot apply proposal generated from a different preference schema version.");
  }
  if (proposal.inputs?.preferencesHash !== hashPreferences(preferences)) {
    throw new Error("Cannot apply proposal generated from a different preference hash.");
  }
}

export function applyRejectPreferenceProposal(preferences, proposal) {
  assertValidProposal(preferences, proposal);

  const next = cloneJson(preferences);
  next.rules ??= {};
  next.rules.exclude ??= [];

  const proposedRule = {
    id: MANUAL_REJECT_RULE_ID,
    description: MANUAL_REJECT_RULE_DESCRIPTION,
    fields: MANUAL_REJECT_RULE_FIELDS,
    terms: stableSortedTerms(proposal.proposedRule?.terms ?? []),
  };

  const manualIndex = next.rules.exclude.findIndex((rule) => rule.id === MANUAL_REJECT_RULE_ID);
  if (manualIndex >= 0) {
    const current = next.rules.exclude[manualIndex];
    next.rules.exclude[manualIndex] = {
      ...current,
      description: current.description ?? MANUAL_REJECT_RULE_DESCRIPTION,
      fields: current.fields?.length ? current.fields : MANUAL_REJECT_RULE_FIELDS,
      terms: stableSortedTerms([...(current.terms ?? []), ...proposedRule.terms]),
    };
    return next;
  }

  const [firstExclude] = next.rules.exclude;
  if (
    firstExclude?.id === "not_obvious_exclusion_yet"
    && Array.isArray(firstExclude.terms)
    && firstExclude.terms.length === 0
  ) {
    next.rules.exclude[0] = proposedRule;
    return next;
  }

  next.rules.exclude.push(proposedRule);
  return next;
}
```

- [ ] **Step 4: Verify apply tests**

Run:

```powershell
node --test scripts/lib/tests/reject-preference-update.test.mjs
npm test
```

Expected: both PASS.

## Task 4: Add Filesystem CLI

**Files:**

- Create: `scripts/update-reject-preferences.mjs`
- Modify: `scripts/lib/reject-preference-update.mjs`
- Modify: `scripts/lib/tests/reject-preference-update.test.mjs`

- [ ] **Step 1: Add filesystem workflow tests**

Update the top of `scripts/lib/tests/reject-preference-update.test.mjs`; ESM imports must stay at the file top.

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runRejectPreferenceUpdate } from "../../update-reject-preferences.mjs";
import {
  applyRejectPreferenceProposal,
  generateRejectPreferenceProposal,
  hashJson,
  hashPreferences,
} from "../reject-preference-update.mjs";
```

Add this helper below `basePreferences(...)`:

```js

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
```

Append these tests to the bottom of the file:

```js

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
  assert.equal(fs.existsSync(path.join(root, "data", "preference-proposals", `rejects-${date}.json`)), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "config", "preferences.linkedin.json"), "utf8")),
    preferences,
  );
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

  const proposalPath = path.join(root, "data", "preference-proposals", `rejects-${date}.json`);
  writeJson(proposalPath, {
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
  });

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

  const proposalPath = path.join(root, "data", "preference-proposals", `rejects-${date}.json`);
  writeJson(proposalPath, {
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
  });

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

  const proposalPath = path.join(root, "data", "preference-proposals", `rejects-${date}.json`);
  writeJson(proposalPath, {
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
  });

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] }),
    /selected hash/,
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

  const proposalPath = path.join(root, "data", "preference-proposals", `rejects-${date}.json`);
  writeJson(proposalPath, {
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
  });

  assert.throws(
    () => runRejectPreferenceUpdate({ cwd: root, argv: [date, "--apply", proposalPath] }),
    /JSON/,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "config", "preferences.linkedin.json"), "utf8")),
    preferences,
  );
});
```

- [ ] **Step 2: Run test and verify runner tests fail**

Run:

```powershell
node --test scripts/lib/tests/reject-preference-update.test.mjs
```

Expected: FAIL with module not found for `../../update-reject-preferences.mjs`.

- [ ] **Step 3: Implement CLI runner**

Create `scripts/update-reject-preferences.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectJobsFile } from "./select-jobs.mjs";
import {
  applyRejectPreferenceProposal,
  generateRejectPreferenceProposal,
  hashJson,
} from "./lib/reject-preference-update.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
}

function parseArgs(argv) {
  const [date, ...rest] = argv;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Usage: node scripts/update-reject-preferences.mjs <YYYY-MM-DD> [--apply <proposal.json>]");
  }
  const applyIndex = rest.indexOf("--apply");
  if (applyIndex === -1) return { date, mode: "proposal" };
  const proposalPath = rest[applyIndex + 1];
  if (!proposalPath) throw new Error("--apply requires a proposal JSON path.");
  return { date, mode: "apply", proposalPath };
}

export function runRejectPreferenceUpdate({ cwd = process.cwd(), argv = process.argv.slice(2), now = new Date().toISOString() } = {}) {
  const args = parseArgs(argv);
  const canonicalPath = path.join(cwd, "data", "canonical", `${args.date}.json`);
  const selectedPath = path.join(cwd, "data", "selected", `${args.date}.json`);
  const annotationsPath = path.join(cwd, "data", "annotations", `${args.date}.json`);
  const preferencesPath = path.join(cwd, "config", "preferences.linkedin.json");

  requireFile(canonicalPath, "canonical");
  requireFile(annotationsPath, "annotations");
  requireFile(preferencesPath, "preferences");
  requireFile(selectedPath, "selected");

  if (args.mode === "proposal") {
    const proposal = generateRejectPreferenceProposal({
      date: args.date,
      canonical: readJson(canonicalPath),
      selected: readJson(selectedPath),
      annotations: readJson(annotationsPath),
      preferences: readJson(preferencesPath),
      now,
    });
    const proposalPath = path.join(cwd, "data", "preference-proposals", `rejects-${args.date}.json`);
    writeJson(proposalPath, proposal);
    return { mode: "proposal", proposalPath, proposal };
  }

  const proposalPath = path.resolve(cwd, args.proposalPath);
  requireFile(proposalPath, "proposal");
  const beforeSelected = readJson(selectedPath);
  const annotations = readJson(annotationsPath);
  const preferences = readJson(preferencesPath);
  const proposal = readJson(proposalPath);
  if (proposal.date !== args.date) throw new Error("Proposal date does not match command date.");
  if (proposal.inputs?.selectedHash !== hashJson(beforeSelected)) {
    throw new Error("Cannot apply proposal generated from a different selected hash.");
  }
  if (proposal.inputs?.annotationsHash !== hashJson(annotations)) {
    throw new Error("Cannot apply proposal generated from a different annotations hash.");
  }

  const nextPreferences = applyRejectPreferenceProposal(preferences, proposal);
  let selection;
  try {
    writeJson(preferencesPath, nextPreferences);
    selection = selectJobsFile(canonicalPath, selectedPath, preferencesPath, { cwd, forceWrite: true });
  } catch (error) {
    writeJson(preferencesPath, preferences);
    throw error;
  }
  const afterSelected = readJson(selectedPath);

  return {
    mode: "apply",
    proposalPath,
    beforeSelectedCount: beforeSelected.items?.length ?? beforeSelected.selectedCount ?? 0,
    afterSelectedCount: afterSelected.items?.length ?? afterSelected.selectedCount ?? selection.selectedCount,
    selection,
  };
}

function printResult(result) {
  if (result.mode === "proposal") {
    console.log(`Reject preference proposal written: ${path.relative(process.cwd(), result.proposalPath).replaceAll(path.sep, "/")}`);
    console.log(`Selected false positives analyzed: ${result.proposal.summary.selectedFalsePositiveCount}`);
    console.log(`Recommended exclude terms: ${result.proposal.proposedRule.terms.length}`);
    console.log(`Would remove selected jobs: ${result.proposal.impact.wouldRemoveSelectedJobIds.length}`);
    console.log(`Accepted/maybe conflicts: ${(result.proposal.warnings ?? []).filter((warning) => warning.type === "accepted_or_maybe_conflict").length}`);
    console.log("Apply with:");
    console.log(`npm run preferences:update-rejects -- ${result.proposal.date} --apply ${path.relative(process.cwd(), result.proposalPath).replaceAll(path.sep, "/")}`);
    return;
  }

  console.log("Reject preference proposal applied.");
  console.log(`Selected count before: ${result.beforeSelectedCount}`);
  console.log(`Selected count after: ${result.afterSelectedCount}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    printResult(runRejectPreferenceUpdate());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Verify runner tests**

Run:

```powershell
node --test scripts/lib/tests/reject-preference-update.test.mjs
npm test
```

Expected: both PASS.

## Task 5: Wire npm Script, Ignore Runtime Output, Update README

**Files:**

- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Add npm script**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "review:today": "node scripts/run-apify-review.mjs",
    "enrich:accepted": "node scripts/enrich-accepted.mjs",
    "preferences:update-rejects": "node scripts/update-reject-preferences.mjs",
    "test": "node --test scripts/lib/tests/*.test.mjs",
    "start": "node app/server.mjs"
  }
}
```

- [ ] **Step 2: Ignore proposal runtime output**

Add to `.gitignore` near the local data entries:

```gitignore
data/preference-proposals/
```

- [ ] **Step 3: Document the command in README**

In `README.md`, under `## Preference Analysis`, replace the old global skill-only command block with:

```md
Generate an explicit reject-rule proposal for a reviewed date:

```powershell
npm run preferences:update-rejects -- 2026-05-07
```

This writes `data/preference-proposals/rejects-2026-05-07.json` and does not mutate `config/preferences.linkedin.json`.

After reviewing the proposal, apply it explicitly:

```powershell
npm run preferences:update-rejects -- 2026-05-07 --apply data/preference-proposals/rejects-2026-05-07.json
```

Apply mode updates `config/preferences.linkedin.json` and regenerates `data/selected/2026-05-07.json`. Preference file updates should only be applied after explicit confirmation.
```

Keep the existing note that preference updates need confirmation.

- [ ] **Step 4: Verify package command is discoverable**

Run:

```powershell
npm run preferences:update-rejects
```

Expected: FAIL with usage text:

```text
Usage: node scripts/update-reject-preferences.mjs <YYYY-MM-DD> [--apply <proposal.json>]
```

The command should exit non-zero because no date was provided.

## Task 6: End-To-End Local Verification

**Files:**

- Runtime only:
  - `data/preference-proposals/rejects-2026-05-07.json`
  - possibly `data/selected/2026-05-07.json` if apply is tested manually

- [ ] **Step 1: Run all tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 2: Generate a proposal against current local data**

Run:

```powershell
npm run preferences:update-rejects -- 2026-05-07
```

Expected:

```text
Reject preference proposal written: data/preference-proposals/rejects-2026-05-07.json
Selected false positives analyzed: <number>
Recommended exclude terms: <number>
Would remove selected jobs: <number>
Accepted/maybe conflicts: <number>
Apply with:
npm run preferences:update-rejects -- 2026-05-07 --apply data/preference-proposals/rejects-2026-05-07.json
```

- [ ] **Step 3: Inspect proposal shape**

Run:

```powershell
Get-Content data\preference-proposals\rejects-2026-05-07.json -TotalCount 80
```

Expected:

- `schemaVersion` is `1`
- `type` is `reject_preference_update`
- `summary.selectedFalsePositiveCount` is present
- `inputs.preferencesHash` is present
- `inputs.selectedHash` is present
- `inputs.annotationsHash` is present
- `impact.wouldRemoveSelectedJobIds` is present
- `impact.acceptedOrMaybeConflictJobIds` is present
- `proposedRule.id` is `manual_reject_patterns`
- `evidence` explains proposed terms

- [ ] **Step 4: Confirm default mode did not mutate preferences**

Run:

```powershell
git diff -- config/preferences.linkedin.json
```

Expected: no diff from proposal mode.

- [ ] **Step 5: Optional manual apply verification**

Only run this if the proposal terms are acceptable:

```powershell
npm run preferences:update-rejects -- 2026-05-07 --apply data/preference-proposals/rejects-2026-05-07.json
npm test
```

Expected:

- `config/preferences.linkedin.json` contains `manual_reject_patterns`
- `data/selected/2026-05-07.json` is regenerated
- tests pass

If the proposal is not acceptable, do not apply it. The feature is still implemented if proposal mode and tests pass.

## Task 7: Final Review

**Files:**

- All files changed in previous tasks

- [ ] **Step 1: Inspect focused diff**

Run:

```powershell
git diff -- scripts/select-jobs.mjs scripts/lib/preferences.mjs scripts/lib/reject-preference-update.mjs scripts/update-reject-preferences.mjs scripts/lib/tests/preferences.test.mjs scripts/lib/tests/reject-preference-update.test.mjs package.json .gitignore README.md
```

Expected:

- `scripts/select-jobs.mjs` behavior is unchanged except helper import.
- New proposal/apply functions are pure and tested.
- CLI uses date-scoped local files.
- Proposal mode does not write preferences.
- Apply mode writes preferences and reruns `selectJobsFile`.

- [ ] **Step 2: Run final tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Check status**

Run:

```powershell
git status --short
```

Expected tracked implementation/doc files are modified or new. Runtime data under `data/preference-proposals/` should not appear after `.gitignore` is updated.

## Implementation Notes

- The CLI should throw regular `Error` objects from pure functions and convert them to `console.error(...)` only in the executable entrypoint.
- Tests must use temp directories and must not write the real `config/preferences.linkedin.json`.
- Treat `preferences.version` as a schema version in V1. Use `inputs.preferencesHash` to prevent stale proposal apply after same-version content edits.
- Use `inputs.selectedHash` and `inputs.annotationsHash` to prevent applying a proposal after the reviewed selected output or annotations changed.
- Proposal mode must fail if `data/selected/<date>.json` is missing. Add a future explicit flag if regeneration in proposal mode becomes useful.
- Apply mode must call `selectJobsFile(..., { forceWrite: true })` so regenerated selected output reflects the new preferences even when selected IDs are unchanged.
- Apply mode must restore the previous `config/preferences.linkedin.json` if selected-output regeneration throws after writing the new preferences.
- Keep JSON output formatted with two-space indentation and a trailing newline, matching existing project style.
- Keep the first version CLI-only. Do not add server endpoints or frontend buttons.
- Do not use `rg` for implementation search in this Windows workspace unless it has been confirmed working; prefer `git grep` and PowerShell `Select-String` per project instruction.

## Self-Review Checklist

- Spec coverage: proposal-only default, explicit apply, selected false positives, preference/selected/annotations hash validation, impact IDs, conflict blocking, rollback, placeholder conversion, README, npm script, and `.gitignore` are all covered.
- Placeholder scan: no task says to add unspecified error handling or unspecified tests; every behavior has concrete test or code guidance.
- Type consistency: `manual_reject_patterns`, `reject_preference_update`, `proposedRule`, `impact`, `warnings`, `preferencesHash`, `selectedHash`, `annotationsHash`, and date-scoped paths are consistent across tests, library, CLI, and README.
