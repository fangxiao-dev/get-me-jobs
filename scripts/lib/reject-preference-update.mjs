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
    .toLowerCase()
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
    if (/^(exclude|reject|bad[_-]industry):/i.test(String(tag))) values.push(tag);
  }
  const note = String(annotation.note ?? "");
  for (const match of note.matchAll(/(?:exclude|reject|bad[_-]industry):\s*([^,;.]+)/gi)) {
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

export function serializeRejectPreferenceProposalMarkdown(proposal) {
  const terms = proposal.proposedRule?.terms ?? [];
  const evidence = proposal.evidence ?? [];
  const warnings = proposal.warnings ?? [];
  const lines = [
    `# Reject Preference Proposal ${proposal.date}`,
    "",
    `Created: ${proposal.createdAt ?? ""}`,
    "",
    "## Summary",
    "",
    `- Canonical jobs: ${proposal.summary?.canonicalCount ?? 0}`,
    `- Selected jobs: ${proposal.summary?.selectedCount ?? 0}`,
    `- Annotations: ${proposal.summary?.annotationCount ?? 0}`,
    `- Rejected annotations: ${proposal.summary?.rejectedCount ?? 0}`,
    `- Rejected selected jobs: ${proposal.summary?.selectedFalsePositiveCount ?? 0}`,
    `- Would remove selected jobs: ${proposal.impact?.wouldRemoveSelectedJobIds?.length ?? 0}`,
    "",
    "## Proposed Terms",
    "",
    ...(terms.length ? terms.map((term) => `- \`${term}\``) : ["- None"]),
    "",
    "## Evidence",
    "",
    ...(evidence.length
      ? evidence.map((item) => {
          const ids = (item.supportingRejectedJobIds ?? []).join(", ");
          return `- \`${item.term}\`: ${item.rejectedMatches} rejected match(es), ${item.selectedMatches} selected match(es). Supporting jobs: ${ids}`;
        })
      : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(warnings.length
      ? warnings.map((warning) => `- ${warning.type}: \`${warning.term}\` (${(warning.jobIds ?? []).join(", ")})`)
      : ["- None"]),
    "",
    "## Machine-Readable Proposal",
    "",
    "```json reject-preference-proposal",
    JSON.stringify(proposal, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

export function extractRejectPreferenceProposalFromMarkdown(markdown) {
  const match = String(markdown ?? "").match(/```json reject-preference-proposal\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("Markdown proposal does not contain a reject-preference-proposal JSON block.");
  return JSON.parse(match[1]);
}

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

function candidateSupportFields(candidate) {
  if (candidate.sources.has("explicit")) return MANUAL_REJECT_RULE_FIELDS;
  return [...candidate.sources].filter((source) => MANUAL_REJECT_RULE_FIELDS.includes(source));
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
  now,
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
    .filter((annotation) => !(annotation.tags ?? []).includes("good_topic"))
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
    const supportFields = candidateSupportFields(candidate);
    const supportingRejectedJobs = rejectedSelected
      .filter(({ job }) => termMatches(pickFields(job, supportFields), candidate.term));
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
    createdAt: now ?? `${date}T00:00:00.000Z`,
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
      fields: [...MANUAL_REJECT_RULE_FIELDS],
      terms: evidence.map((item) => item.term),
    },
    evidence,
    warnings,
  };
}

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

export function acceptedOrMaybeConflictsForProposal(selected, annotations, proposal) {
  const acceptedOrMaybeIds = new Set(
    (annotations.items ?? [])
      .filter((annotation) => ["accept", "maybe"].includes(annotation.decision))
      .map((annotation) => String(annotation.id)),
  );
  const acceptedOrMaybeSelectedJobs = (selected.items ?? [])
    .filter((item) => acceptedOrMaybeIds.has(String(stableId(item))));

  return stableSortedTerms(proposal.proposedRule?.terms ?? [])
    .map((term) => ({
      type: "accepted_or_maybe_conflict",
      term,
      jobIds: candidateMatchesJobs(term, acceptedOrMaybeSelectedJobs).map(stableId).map(String),
    }))
    .filter((warning) => warning.jobIds.length > 0);
}

export function assertNoAcceptedOrMaybeConflicts(selected, annotations, proposal) {
  const conflicts = acceptedOrMaybeConflictsForProposal(selected, annotations, proposal);
  if (conflicts.length > 0) {
    throw new Error("Cannot apply proposal with accepted/maybe conflicts.");
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
    fields: [...MANUAL_REJECT_RULE_FIELDS],
    terms: stableSortedTerms(proposal.proposedRule?.terms ?? []),
  };

  const manualIndex = next.rules.exclude.findIndex((rule) => rule.id === MANUAL_REJECT_RULE_ID);
  if (manualIndex >= 0) {
    const current = next.rules.exclude[manualIndex];
    next.rules.exclude[manualIndex] = {
      ...current,
      description: current.description ?? MANUAL_REJECT_RULE_DESCRIPTION,
      fields: current.fields?.length ? current.fields : [...MANUAL_REJECT_RULE_FIELDS],
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
