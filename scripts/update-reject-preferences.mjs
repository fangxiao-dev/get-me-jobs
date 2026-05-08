import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectJobsFile } from "./select-jobs.mjs";
import {
  applyRejectPreferenceProposal,
  assertNoAcceptedOrMaybeConflicts,
  extractRejectPreferenceProposalFromMarkdown,
  generateRejectPreferenceProposal,
  hashJson,
  serializeRejectPreferenceProposalMarkdown,
} from "./lib/reject-preference-update.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
}

function parseArgs(argv) {
  const [date, ...rest] = argv;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Usage: node scripts/update-reject-preferences.mjs <YYYY-MM-DD> [--overwrite] [--apply <proposal.md>]");
  }

  const applyIndex = rest.indexOf("--apply");
  const overwrite = rest.includes("--overwrite");
  if (applyIndex === -1) return { date, mode: "proposal", overwrite };

  const proposalPath = rest[applyIndex + 1];
  if (!proposalPath) throw new Error("--apply requires a proposal Markdown path.");
  return { date, mode: "apply", proposalPath };
}

export function runRejectPreferenceUpdate({
  cwd = process.cwd(),
  argv = process.argv.slice(2),
  now = new Date().toISOString(),
} = {}) {
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
    const proposalPath = path.join(cwd, "docs", "preference-proposals", `rejects-${args.date}.md`);
    if (fs.existsSync(proposalPath) && !args.overwrite) {
      throw new Error(`Reject preference proposal already exists: ${proposalPath}`);
    }
    writeText(proposalPath, serializeRejectPreferenceProposalMarkdown(proposal));
    return { mode: "proposal", proposalPath, proposal };
  }

  const proposalPath = path.resolve(cwd, args.proposalPath);
  requireFile(proposalPath, "proposal");

  const beforeSelected = readJson(selectedPath);
  const annotations = readJson(annotationsPath);
  const preferences = readJson(preferencesPath);
  const proposal = extractRejectPreferenceProposalFromMarkdown(fs.readFileSync(proposalPath, "utf8"));

  if (proposal.date !== args.date) throw new Error("Proposal date does not match command date.");
  if (proposal.inputs?.selectedHash !== hashJson(beforeSelected)) {
    throw new Error("Cannot apply proposal generated from a different selected hash.");
  }
  if (proposal.inputs?.annotationsHash !== hashJson(annotations)) {
    throw new Error("Cannot apply proposal generated from a different annotations hash.");
  }
  assertNoAcceptedOrMaybeConflicts(beforeSelected, annotations, proposal);

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
