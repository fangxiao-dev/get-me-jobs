import fs from "node:fs";
import path from "node:path";
import { loadJobSourcesManifest } from "./lib/job-sources-manifest.mjs";
import { finalizeReviewBatch } from "./lib/review-finalize.mjs";
import {
  localDateParts,
  parseDotenv,
  rawFilenameForRun,
  resolveTaskEntries,
} from "./lib/apify-review-command.mjs";

const rootDir = process.cwd();
const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

function usage() {
  console.log("Usage: npm run review:today");
  console.log("Runs all TASKID_* Apify tasks from .env, saves raw outputs, then merges/selects today's review batch.");
}

async function apifyJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    let details = "";
    try {
      const body = await response.json();
      details = body.error?.message ? `: ${body.error.message}` : `: ${JSON.stringify(body)}`;
    } catch {
      details = `: ${await response.text()}`;
    }
    const error = new Error(`${response.status} ${response.statusText}${details}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

async function listTasks(token) {
  const result = await apifyJson("https://api.apify.com/v2/actor-tasks?limit=100&desc=true", token);
  return result.data?.items ?? [];
}

async function taskInput(taskId, token) {
  return apifyJson(`https://api.apify.com/v2/actor-tasks/${encodeURIComponent(taskId)}/input`, token);
}

async function startTask(taskId, token) {
  return apifyJson(`https://api.apify.com/v2/actor-tasks/${encodeURIComponent(taskId)}/runs`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

async function waitForRun(runId, token) {
  let run = null;
  do {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    run = await apifyJson(`https://api.apify.com/v2/actor-runs/${runId}?waitForFinish=60`, token);
    console.log(`Run ${runId} status ${run.data.status}`);
  } while (!terminalStatuses.has(run.data.status));
  return run.data;
}

async function datasetItems(datasetId, token) {
  const items = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const page = await apifyJson(
      `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&clean=true&limit=${limit}&offset=${offset}`,
      token,
    );
    const pageItems = Array.isArray(page) ? page : [];
    items.push(...pageItems);
    offset += pageItems.length;
    if (pageItems.length < limit) break;
  }
  return items;
}

function writeRawFile(root, task, run, taskInputValue, items, index) {
  const rawDir = path.join(root, "data", "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const dateParts = localDateParts();
  const rawPath = path.join(rawDir, rawFilenameForRun(dateParts, index));
  const raw = {
    source: "linkedin",
    taskKey: task.key,
    taskId: task.taskId,
    taskName: task.taskName,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    runStatus: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    savedAt: new Date().toISOString(),
    taskInput: taskInputValue,
    count: items.length,
    items,
  };
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return rawPath;
}

async function runTask(root, task, token, index) {
  console.log(`Starting ${task.key}: ${task.taskName}`);
  const input = await taskInput(task.taskId, token);
  const started = await startTask(task.taskId, token);
  const runId = started.data.id;
  console.log(`Run ${runId} status ${started.data.status}`);
  const run = await waitForRun(runId, token);
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Run ${runId} ended with ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`);
  }
  const items = await datasetItems(run.defaultDatasetId, token);
  const rawPath = writeRawFile(root, task, run, input, items, index);
  console.log(`Saved ${items.length} items to ${path.relative(root, rawPath)}`);
  return {
    taskKey: task.key,
    taskName: task.taskName,
    runId,
    datasetId: run.defaultDatasetId,
    count: items.length,
    rawFile: path.relative(rootDir, rawPath).replaceAll(path.sep, "/"),
  };
}

export async function runApifyReview(options = {}) {
  const root = options.rootDir ?? rootDir;
  const manifest = options.manifest ?? loadJobSourcesManifest({ rootDir: root, manifestPath: options.manifestPath });
  const channel = manifest.channels.apify_linkedin;
  if (!channel.enabled) {
    throw new Error("Apify LinkedIn channel is disabled by config/job-sources.manifest.json");
  }

  const envPath = path.join(root, channel.envFile);
  if (!fs.existsSync(envPath)) throw new Error(".env not found");
  const env = parseDotenv(fs.readFileSync(envPath, "utf8"));
  const token = env.APIFY_TOKEN || env.APIFY;
  if (!token) throw new Error("APIFY_TOKEN/APIFY is missing in .env");

  const tasks = resolveTaskEntries(env, await listTasks(token), {
    taskEnvPrefix: channel.taskEnvPrefix,
  });
  const unresolved = tasks.filter((task) => task.unresolved);
  const runnable = tasks.filter((task) => !task.unresolved);
  if (!runnable.length) throw new Error("No runnable TASKID_* Apify tasks found");

  if (unresolved.length) {
    for (const task of unresolved) {
      console.warn(`Skipping unresolved ${task.key}`);
    }
  }

  const successes = [];
  const failures = [];
  for (const task of runnable) {
    try {
      successes.push(await runTask(root, task, token, successes.length));
    } catch (error) {
      failures.push({ taskKey: task.key, taskName: task.taskName, error: error.message ?? String(error) });
      console.warn(`Task ${task.key} failed: ${error.message ?? error}`);
    }
  }

  if (!successes.length) {
    const details = failures.map((failure) => `${failure.taskKey}: ${failure.error}`).join("\n");
    throw new Error(`No Apify tasks succeeded.\n${details}`);
  }

  const today = localDateParts().date;
  const finalized = finalizeReviewBatch(today, { rootDir: root, manifest, logger: console });
  return {
    ok: true,
    date: today,
    successes,
    failures,
    canonicalFile: finalized.canonicalFile,
    selectedFile: finalized.selectedFile,
    canonicalItems: finalized.canonicalItems,
    selectedCount: finalized.selectedCount,
    enrichment: finalized.enrichment,
  };
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const result = await runApifyReview();
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) {
      console.warn(`${result.failures.length} task(s) failed; review batch was generated from successful tasks.`);
    }
  } catch (error) {
    console.error(error.message ?? String(error));
    process.exit(1);
  }
}
