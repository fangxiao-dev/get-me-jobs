import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const NON_TECHNICAL_RE = /quota|rate.?limit|billing|unauthorized|forbidden|auth|credit/i;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}

function buildPrompt(descriptionText) {
  return `Analyze this job posting. Output ONLY a JSON object with exactly these two keys:
- "aufgaben": a short English phrase (not a full sentence) summarizing the main tasks/responsibilities
- "techReqs": exactly 3 core technical requirements as short English phrases, comma-separated

No markdown, no explanation, no code blocks. Output only the raw JSON.

Description:
${descriptionText}

Output: {"aufgaben":"...","techReqs":"..."}`;
}

function parseEnrichment(text) {
  const match = String(text ?? "").match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("no JSON object found");
  const data = JSON.parse(match[0]);
  if (!data.aufgaben || !data.techReqs) throw new Error("missing required keys");
  return { aufgaben: String(data.aufgaben), techReqs: String(data.techReqs) };
}

function normalizeEnrichment(value) {
  if (!value?.aufgaben || !value?.techReqs) throw new Error("missing required keys");
  return {
    aufgaben: String(value.aufgaben),
    techReqs: String(value.techReqs),
  };
}

function callCodex(prompt) {
  const tmpFile = path.join(os.tmpdir(), `manual-import-enrich-codex-${Date.now()}.txt`);
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
      if (NON_TECHNICAL_RE.test(stderr)) return { unavailable: true };
      throw new Error(`codex exit ${result.status}: ${stderr}`);
    }
    return { text: fs.existsSync(tmpFile) ? fs.readFileSync(tmpFile, "utf8").trim() : "" };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function callClaude(prompt) {
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
  return { text: result.stdout.trim() };
}

async function defaultAnalyze({ descriptionText }) {
  const prompt = buildPrompt(descriptionText.slice(0, 3000));
  const codex = callCodex(prompt);
  if (codex.text) return parseEnrichment(codex.text);
  const claude = callClaude(prompt);
  if (claude.text) return parseEnrichment(claude.text);
  throw new Error("AI CLI unavailable");
}

function enrichmentDateFromNow(now) {
  return String(now ?? new Date().toISOString()).slice(0, 10);
}

export async function upsertManualImportAiEnrichment({ rootDir, job, now, analyze = defaultAnalyze }) {
  const date = enrichmentDateFromNow(now);
  const enrichmentPath = path.join(rootDir, "data", "enrichments", `${date}.json`);
  const existing = readJson(enrichmentPath, {});
  const jobKey = job.jobKey;
  const descriptionText = job.description?.text ?? "";

  if (existing[jobKey] && !existing[jobKey].failed) {
    return { ok: true, skipped: true, enrichmentFile: relativePath(rootDir, enrichmentPath), jobKey };
  }

  try {
    const data = normalizeEnrichment(await analyze({ descriptionText }));
    existing[jobKey] = { ...data, enrichedAt: new Date().toISOString() };
    writeJson(enrichmentPath, existing);
    return { ok: true, enrichmentFile: relativePath(rootDir, enrichmentPath), jobKey };
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      reason: "manual_import_ai_unavailable",
      enrichmentFile: relativePath(rootDir, enrichmentPath),
      jobKey,
      error: error.message ?? String(error),
    };
  }
}

export function dashboardEnrichmentDatesForJob(job) {
  const canonicalDate = (job.canonicalFile ?? "").match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (canonicalDate) return [canonicalDate];
  const acceptedDate = String(job.acceptedAt ?? job.firstSeenAt ?? "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return acceptedDate ? [acceptedDate] : [];
}

export function readDashboardEnrichments(rootDir, acceptedJobs) {
  const enrichments = {};
  const seenDates = new Set();
  for (const job of acceptedJobs ?? []) {
    for (const date of dashboardEnrichmentDatesForJob(job)) {
      if (seenDates.has(date)) continue;
      seenDates.add(date);
      Object.assign(enrichments, readJson(path.join(rootDir, "data", "enrichments", `${date}.json`), {}));
    }
  }
  return enrichments;
}
