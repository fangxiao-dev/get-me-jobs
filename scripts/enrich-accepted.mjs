#!/usr/bin/env node
/**
 * Enrich accepted + applied jobs across all batches.
 *
 * Reads data/accepted-jobs.json, groups by batch date, finds full job data
 * (including description) from selected/canonical files, then calls the same
 * Codex-first enrichment logic as enrich-jobs.mjs.
 *
 * Usage:
 *   node scripts/enrich-accepted.mjs
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const enrichmentsDir = path.join(rootDir, "data", "enrichments");

// ── Shared enrichment logic (same as enrich-jobs.mjs) ─────────────────────────

const NON_TECHNICAL_RE = /quota|rate.?limit|billing|unauthorized|forbidden|auth|credit/i;

function callCodex(prompt) {
  const tmpFile = path.join(os.tmpdir(), `enrich-codex-${Date.now()}.txt`);
  try {
    const result = spawnSync(
      "codex",
      ["exec", "--ephemeral", "-c", "model_reasoning_effort=low", "-o", tmpFile, "-"],
      { input: prompt, encoding: "utf8", shell: true, timeout: 90_000 },
    );
    if (result.error) {
      if (result.error.code === "ENOENT") return { unavailable: true };
      throw result.error;
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? "").slice(0, 400);
      if (NON_TECHNICAL_RE.test(stderr)) return { quotaError: true, detail: stderr };
      throw new Error(`codex exit ${result.status}: ${stderr}`);
    }
    const text = fs.existsSync(tmpFile) ? fs.readFileSync(tmpFile, "utf8").trim() : "";
    return { text };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function callClaude(prompt) {
  const result = spawnSync("claude", ["-p", "-"], {
    input: prompt, encoding: "utf8", shell: true, timeout: 60_000,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") return { unavailable: true };
    throw result.error;
  }
  if (result.status !== 0) throw new Error(`claude exit ${result.status}: ${(result.stderr ?? "").slice(0, 200)}`);
  const text = result.stdout.trim();
  if (!text) return { unavailable: true };
  return { text };
}

function parseEnrichment(text) {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("no JSON object found");
  const data = JSON.parse(match[0]);
  if (!data.aufgaben || !data.techReqs) throw new Error("missing required keys");
  return { aufgaben: String(data.aufgaben), techReqs: String(data.techReqs) };
}

function buildPrompt(title, descriptionText) {
  return `Analyze this job posting. Output ONLY a JSON object with exactly these two keys:
- "aufgaben": a short English phrase (not a full sentence) summarizing the main tasks/responsibilities
- "techReqs": exactly 3 core technical requirements as short English phrases, comma-separated

No markdown, no explanation, no code blocks. Output only the raw JSON.

Job title: ${title}

Description:
${descriptionText}

Output: {"aufgaben":"...","techReqs":"..."}`;
}

async function enrichItem(jobId, title, descText, existing, codexUnavailable, claudeUnavailable) {
  if (existing[jobId] && !existing[jobId].failed) return { result: existing[jobId], codexUnavailable, claudeUnavailable };

  const prompt = buildPrompt(title, descText.slice(0, 3000));
  let text = null;

  if (!codexUnavailable) {
    try {
      const res = callCodex(prompt);
      if (res.unavailable) { console.warn("  [INFO] Codex CLI not found, switching to Claude."); codexUnavailable = true; }
      else if (res.quotaError) { console.warn("  [QUOTA] Codex quota error, switching to Claude."); codexUnavailable = true; }
      else text = res.text;
    } catch (err) {
      console.warn(`  [ERR] Codex error for ${jobId}: ${err.message}`);
      return { result: { failed: true, reason: "codex_error" }, codexUnavailable, claudeUnavailable };
    }
  }

  if (text == null && !claudeUnavailable) {
    try {
      const res = callClaude(prompt);
      if (res.unavailable) { console.warn("  [INFO] Claude CLI not found."); claudeUnavailable = true; }
      else text = res.text;
    } catch (err) {
      console.warn(`  [ERR] Claude error for ${jobId}: ${err.message}`);
      return { result: { failed: true, reason: "claude_error" }, codexUnavailable, claudeUnavailable };
    }
  }

  if (text == null) {
    return { result: { failed: true, reason: "cli_unavailable" }, codexUnavailable, claudeUnavailable };
  }

  try {
    const data = parseEnrichment(text);
    return { result: { ...data, enrichedAt: new Date().toISOString() }, codexUnavailable, claudeUnavailable };
  } catch (err) {
    console.warn(`  [FAIL] Parse error for ${jobId}: ${err.message}`);
    return { result: { failed: true, reason: "parse_error" }, codexUnavailable, claudeUnavailable };
  }
}

// ── Load source data ───────────────────────────────────────────────────────────

const acceptedJobs = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "accepted-jobs.json"), "utf8"));

// Group accepted jobs by batch date
const byDate = new Map();
for (const job of acceptedJobs.items ?? []) {
  const dateMatch = (job.canonicalFile ?? "").match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) continue;
  const date = dateMatch[1];
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push(job.jobKey);
}

// ── Process each batch ─────────────────────────────────────────────────────────

fs.mkdirSync(enrichmentsDir, { recursive: true });

let totalEnriched = 0;
let totalSkipped = 0;
let totalFailed = 0;
let codexUnavailable = false;
let claudeUnavailable = false;

for (const [date, jobKeys] of [...byDate.entries()].sort()) {
  console.log(`\n── Batch ${date} (${jobKeys.length} jobs) ──`);

  const targetIds = new Set(jobKeys);

  // Build item map: selected first (richer data), canonical as fallback for jobs not in selected
  const selectedPath = path.join(rootDir, "data", "selected", `${date}.json`);
  const canonicalPath = path.join(rootDir, "data", "canonical", `${date}.json`);

  if (!fs.existsSync(selectedPath) && !fs.existsSync(canonicalPath)) {
    console.warn(`  [SKIP] No data file found for ${date}`);
    continue;
  }

  const itemMap = new Map();
  for (const sourcePath of [canonicalPath, selectedPath]) {
    if (!fs.existsSync(sourcePath)) continue;
    const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    for (const item of source.items ?? []) {
      const id = item.identity?.jobId ?? String(item.id ?? "");
      if (id) itemMap.set(id, item); // selected overwrites canonical if both exist
    }
  }

  const enrichmentPath = path.join(enrichmentsDir, `${date}.json`);
  const existing = fs.existsSync(enrichmentPath)
    ? JSON.parse(fs.readFileSync(enrichmentPath, "utf8"))
    : {};

  for (const jobKey of jobKeys) {
    const item = itemMap.get(jobKey);
    if (!item) {
      console.warn(`  [MISS] ${jobKey} not found in ${path.basename(sourcePath)}`);
      continue;
    }

    const jobId = item.identity?.jobId ?? jobKey;

    if (existing[jobId] && !existing[jobId].failed) {
      console.log(`  [SKIP] ${jobId}`);
      totalSkipped++;
      continue;
    }

    const title = item.title?.raw ?? item.title ?? "";
    const descText = item.description?.text ?? "";

    const out = await enrichItem(jobId, title, descText, existing, codexUnavailable, claudeUnavailable);
    codexUnavailable = out.codexUnavailable;
    claudeUnavailable = out.claudeUnavailable;
    existing[jobId] = out.result;

    if (out.result.failed) {
      console.log(`  [FAIL] ${jobId} — ${out.result.reason}`);
      totalFailed++;
    } else {
      console.log(`  [OK]   ${jobId}`);
      totalEnriched++;
    }

    if (claudeUnavailable && codexUnavailable) {
      console.warn("  Both CLIs unavailable. Stopping.");
      break;
    }
  }

  fs.writeFileSync(enrichmentPath, JSON.stringify(existing, null, 2), "utf8");
  console.log(`  Saved: ${path.relative(rootDir, enrichmentPath)}`);

  if (claudeUnavailable && codexUnavailable) break;
}

console.log(`\n════════════════════════════════════`);
console.log(`enriched=${totalEnriched}  skipped=${totalSkipped}  failed=${totalFailed}`);
