import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const NON_TECHNICAL_RE = /quota|rate.?limit|billing|unauthorized|forbidden|auth|credit/i;
const WORKPLACE_TYPES = new Set(["remote", "hybrid", "on_site", "unknown"]);

function buildPrompt(descriptionText) {
  return `Extract structured fields from this job description. Output ONLY a JSON object with these keys:
- "title": job title, or empty string if not present
- "companyName": hiring company name, or empty string if not present
- "location": job location, or empty string if not present
- "workplaceType": one of "remote", "hybrid", "on_site", "unknown"
- "descriptionText": the original job description text, lightly cleaned but not summarized

No markdown, no explanation, no code blocks. Output only raw JSON.

Job description:
${descriptionText}

Output: {"title":"...","companyName":"...","location":"...","workplaceType":"unknown","descriptionText":"..."}`;
}

function parseJsonObject(text) {
  const match = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object found");
  return JSON.parse(match[0]);
}

function normalizedWorkplaceType(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return WORKPLACE_TYPES.has(normalized) ? normalized : "unknown";
}

export function normalizeManualJobAiFields(value, fallbackDescriptionText = "") {
  return {
    title: String(value?.title ?? "").trim(),
    companyName: String(value?.companyName ?? "").trim(),
    location: String(value?.location ?? "").trim(),
    workplaceType: normalizedWorkplaceType(value?.workplaceType),
    descriptionText: String(value?.descriptionText ?? fallbackDescriptionText ?? "").trim(),
  };
}

function callCodex(prompt) {
  const tmpFile = path.join(os.tmpdir(), `manual-job-parse-codex-${Date.now()}.txt`);
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
  const prompt = buildPrompt(descriptionText.slice(0, 6000));
  const codex = callCodex(prompt);
  if (codex.text) return parseJsonObject(codex.text);
  const claude = callClaude(prompt);
  if (claude.text) return parseJsonObject(claude.text);
  throw new Error("AI CLI unavailable");
}

export async function parseManualJobDescription(payload, { analyze = defaultAnalyze } = {}) {
  const descriptionText = String(payload?.descriptionText ?? "").trim();
  if (!descriptionText) {
    const error = new Error("descriptionText is required");
    error.statusCode = 400;
    throw error;
  }
  const parsed = await analyze({ descriptionText });
  return normalizeManualJobAiFields(parsed, descriptionText);
}
