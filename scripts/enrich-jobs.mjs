#!/usr/bin/env node
/**
 * Enrich selected jobs with AI-generated summaries.
 *
 * Primary:  Codex CLI  (codex exec, reasoning effort = low)
 * Fallback: Claude CLI (claude -p) — only for non-technical failures
 *           such as quota exhaustion or auth issues.
 *
 * Usage:
 *   node scripts/enrich-jobs.mjs data/selected/2026-05-02.json
 *
 * Output:  data/enrichments/<date>.json
 * Idempotent — skips already-enriched jobs. Safe to re-run.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const enrichmentsDir = path.join(rootDir, "data", "enrichments");

// ── CLI helpers ────────────────────────────────────────────────────────────────

const NON_TECHNICAL_RE = /quota|rate.?limit|billing|unauthorized|forbidden|auth|credit/i;

function callCodex(prompt) {
  const tmpFile = path.join(os.tmpdir(), `enrich-codex-${Date.now()}.txt`);
  try {
    // Pass prompt via stdin ("-") to avoid shell word-splitting on Windows
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
  // Pass prompt via stdin to avoid shell word-splitting on Windows
  const result = spawnSync("claude", ["-p", "-"], {
    input: prompt,
    encoding: "utf8",
    shell: true,
    timeout: 60_000,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") return { unavailable: true };
    throw result.error;
  }
  if (result.status !== 0) throw new Error(`claude exit ${result.status}: ${(result.stderr ?? "").slice(0, 200)}`);
  const text = result.stdout.trim();
  if (!text) return { unavailable: true }; // Claude CLI returned nothing (TTY issue)
  return { text };
}

function parseEnrichment(text) {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("no JSON object found in output");
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

// ── Main ───────────────────────────────────────────────────────────────────────

export function enrichSelectedJobs(selectedFile, options = {}) {
  const logger = options.logger ?? console;
  const selectedPath = path.resolve(rootDir, selectedFile);
  if (!fs.existsSync(selectedPath)) {
    throw new Error(`File not found: ${selectedPath}`);
  }

  const selected = JSON.parse(fs.readFileSync(selectedPath, "utf8"));
  const items = selected.items ?? [];
  if (!items.length) {
    logger.log("No items to enrich.");
    return { enriched: 0, skipped: 0, failed: 0, enrichmentFile: null };
  }

  const dateMatch = path.basename(selectedPath).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) {
    throw new Error(`Cannot derive date from filename: ${path.basename(selectedPath)}`);
  }
  const date = dateMatch[1];

  fs.mkdirSync(enrichmentsDir, { recursive: true });
  const enrichmentPath = path.join(enrichmentsDir, `${date}.json`);
  const existing = fs.existsSync(enrichmentPath)
    ? JSON.parse(fs.readFileSync(enrichmentPath, "utf8"))
    : {};

  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  let codexUnavailable = false;
  let claudeUnavailable = false;

  for (const item of items) {
    const jobId = item.identity?.jobId ?? String(item.id ?? "");
    if (!jobId) continue;

    if (existing[jobId] && !existing[jobId].failed) {
      skipped++;
      continue;
    }

    const title = item.title?.raw ?? item.title ?? "";
    const descriptionText = (item.description?.text ?? "").slice(0, 3000);
    const prompt = buildPrompt(title, descriptionText);

    let text = null;

    // ── Try Codex ────────────────────────────────────────────────────────────
    if (!codexUnavailable) {
      try {
        const res = callCodex(prompt);
        if (res.unavailable) {
          logger.warn("  [INFO] Codex CLI not found, falling back to Claude for all jobs.");
          codexUnavailable = true;
        } else if (res.quotaError) {
          logger.warn(`  [QUOTA] Codex quota/auth error for ${jobId}, falling back to Claude.`);
          codexUnavailable = true;
        } else {
          text = res.text;
        }
      } catch (err) {
        logger.warn(`  [ERR] Codex technical error for ${jobId}: ${err.message}`);
        existing[jobId] = { failed: true, reason: "codex_error" };
        failed++;
        continue;
      }
    }

    // ── Fallback to Claude ───────────────────────────────────────────────────
    if (text == null && !claudeUnavailable) {
      try {
        const res = callClaude(prompt);
        if (res.unavailable) {
          logger.warn("  [INFO] Claude CLI not found either. Marking remaining jobs unavailable.");
          claudeUnavailable = true;
        } else {
          text = res.text;
        }
      } catch (err) {
        logger.warn(`  [ERR] Claude error for ${jobId}: ${err.message}`);
        existing[jobId] = { failed: true, reason: "claude_error" };
        failed++;
        continue;
      }
    }

    // ── Both unavailable ─────────────────────────────────────────────────────
    if (text == null) {
      for (const rest of items) {
        const rid = rest.identity?.jobId ?? String(rest.id ?? "");
        if (rid && !existing[rid]) existing[rid] = { failed: true, reason: "cli_unavailable" };
      }
      break;
    }

    // ── Parse output ─────────────────────────────────────────────────────────
    try {
      const data = parseEnrichment(text);
      existing[jobId] = { ...data, enrichedAt: new Date().toISOString() };
      logger.log(`  [OK] ${jobId}`);
      enriched++;
    } catch (err) {
      logger.warn(`  [FAIL] Parse error for ${jobId}: ${err.message}`);
      existing[jobId] = { failed: true, reason: "parse_error" };
      failed++;
    }
  }

  fs.writeFileSync(enrichmentPath, JSON.stringify(existing, null, 2), "utf8");
  return {
    enriched,
    skipped,
    failed,
    enrichmentFile: path.relative(rootDir, enrichmentPath).replaceAll(path.sep, "/"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const selectedFile = process.argv[2];
  if (!selectedFile) {
    console.error("Usage: node scripts/enrich-jobs.mjs <selected-file>");
    process.exit(1);
  }

  try {
    const result = enrichSelectedJobs(selectedFile);
    console.log(`\nDone. enriched=${result.enriched} skipped=${result.skipped} failed=${result.failed}`);
    if (result.enrichmentFile) console.log(`Written: ${result.enrichmentFile}`);
  } catch (error) {
    console.error(error.message ?? String(error));
    process.exit(1);
  }
}
