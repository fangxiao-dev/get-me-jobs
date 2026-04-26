import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeCanonicalForDate } from "../scripts/merge-canonical.mjs";
import { adaptLinkedinItem } from "../scripts/lib/adapt-linkedin.mjs";
import { extractedLinkedinJobToRawItem, scrapeLinkedinJob } from "../scripts/lib/scrape-linkedin-job.mjs";
import { selectJobsFile } from "../scripts/select-jobs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "public");
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const dataDir = path.join(rootDir, "data");
const rawDir = path.join(dataDir, "raw");
const canonicalDir = path.join(dataDir, "canonical");
const selectedDir = path.join(dataDir, "selected");
const annotationsDir = path.join(dataDir, "annotations");
const acceptedJobsPath = path.join(rootDir, "data", "accepted-jobs.json");
const applicationsPath = path.join(rootDir, "data", "applications.json");

const statuses = {
  accepted: "Accepted",
  applied_waiting: "Applied, waiting for response",
  interview_scheduled: "Interview scheduled, preparing",
  interview_completed: "Interview completed, waiting for result",
  employer_agreed: "Employer agreed, waiting for contract",
  closed: "Closed / rejected / withdrawn",
};

const eventStatusMap = {
  applied: "applied_waiting",
  interview_scheduled: "interview_scheduled",
  interview_completed: "interview_completed",
  employer_agreed: "employer_agreed",
  rejected: "closed",
  withdrawn: "closed",
  contract_signed: "closed",
  closed: "closed",
};

const statusStageMap = {
  accepted: "note",
  applied_waiting: "applied",
  interview_scheduled: "interview_scheduled",
  interview_completed: "interview_completed",
  employer_agreed: "employer_agreed",
  closed: "closed",
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

function sendError(res, status, message, details) {
  sendJson(res, status, { error: message, details });
}

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

function timestampForFile(value = new Date()) {
  const iso = value.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

function readStore(filePath, fallback) {
  try {
    return readJson(filePath, fallback);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const backupPath = `${filePath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.copyFileSync(filePath, backupPath);
      return fallback;
    }
    throw error;
  }
}

function emptyAcceptedJobs() {
  return { version: 1, items: [] };
}

function emptyApplications() {
  return { version: 1, items: [] };
}

function loadAcceptedJobs() {
  return readStore(acceptedJobsPath, emptyAcceptedJobs());
}

function loadApplications() {
  return readStore(applicationsPath, emptyApplications());
}

function saveAcceptedJobs(value) {
  writeJson(acceptedJobsPath, value);
}

function saveApplications(value) {
  writeJson(applicationsPath, value);
}

function safeJobId(item) {
  return String(item?.identity?.jobId ?? item?.id ?? item?.sourceJobId ?? item?.link ?? item?.url ?? "");
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (["refId", "trackingId", "trk", "position", "pageNum"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return normalizeText(value);
  }
}

function jobKey(source, item) {
  if (item?.identity?.jobId) return item.identity.jobId;
  if (item?.id) return `${source}:${item.id}`;
  if (item?.sourceJobId) return `${source}:${item.sourceJobId}`;
  if (item?.link || item?.url) return `${source}:url:${canonicalUrl(item.link ?? item.url)}`;
  return `${source}:text:${normalizeText(item.companyName)}|${normalizeText(item.title)}|${normalizeText(item.location)}`;
}

function batchIdFromFile(filePath) {
  return path.basename(filePath, ".json");
}

function latestCanonicalFile() {
  const files = fs.existsSync(canonicalDir) ? fs.readdirSync(canonicalDir) : [];
  const latestName = files
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .at(-1);
  return latestName ? path.join(canonicalDir, latestName) : null;
}

function resolveDataFile(filePath, fallbackDir) {
  if (!filePath) return null;
  const resolved = path.resolve(rootDir, filePath);
  const fallbackResolved = path.resolve(fallbackDir, path.basename(filePath));
  if (fs.existsSync(resolved)) return resolved;
  if (fs.existsSync(fallbackResolved)) return fallbackResolved;
  return resolved;
}

function relativeDataPath(filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/");
}

function annotationPath(date) {
  return path.join(annotationsDir, `${date}.json`);
}

function readAnnotationFile(filePath, date) {
  try {
    return readJson(filePath, {
      date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      const backupPath = `${filePath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.copyFileSync(filePath, backupPath);
      return {
        date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [],
        recoveredFromMalformedFile: path.basename(backupPath),
      };
    }
    throw error;
  }
}

function readAnnotationFileByRelativePath(relativePath) {
  const filePath = resolveDataFile(relativePath, annotationsDir);
  const date = path.basename(filePath, ".json");
  return { filePath, annotationFile: readAnnotationFile(filePath, date) };
}

function resolvePayloadFiles(payload) {
  const canonicalPath = payload.canonicalFile
    ? resolveDataFile(payload.canonicalFile, canonicalDir)
    : path.join(canonicalDir, `${payload.date}.json`);
  const selectedPath = payload.selectedFile
    ? resolveDataFile(payload.selectedFile, selectedDir)
    : path.join(selectedDir, `${batchIdFromFile(canonicalPath)}.json`);
  return {
    canonicalPath,
    selectedPath,
    canonicalFile: relativeDataPath(canonicalPath),
    selectedFile: relativeDataPath(selectedPath),
  };
}

function annotationsById(annotationFile) {
  return Object.fromEntries((annotationFile.items ?? []).map((item) => [String(item.id), item]));
}

function findJobForAnnotation(payload) {
  const files = resolvePayloadFiles(payload);
  const canonical = readJson(files.canonicalPath, { items: [] });
  const id = String(payload.id);
  const item = (canonical.items ?? []).find((candidate) => safeJobId(candidate) === id);
  if (!item) {
    const error = new Error(`Job not found for accepted annotation: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  return { item, files };
}

function acceptedJobFromItem(source, item, context) {
  return {
    jobKey: jobKey(source, item),
    source,
    sourceJobId: item.identity?.sourceJobId ?? safeJobId(item),
    title: item.title?.raw ?? item.title ?? null,
    companyName: item.company?.name ?? item.companyName ?? null,
    location: item.location?.raw ?? item.location ?? null,
    workplaceType: item.location?.workplaceType ?? item.workplaceType ?? "unknown",
    link: item.application?.jobUrl ?? item.links?.detail ?? item.link ?? item.url ?? null,
    applyUrl: item.application?.applyUrl ?? item.links?.apply ?? item.applyUrl ?? null,
    firstSeenAt: context.now,
    acceptedAt: context.now,
    canonicalFile: context.canonicalFile,
    annotationFile: context.annotationFile,
  };
}

function createEvent(type, note = "", date = new Date().toISOString().slice(0, 10), extra = {}) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    date,
    note,
    ...extra,
  };
}

export function applicationEventStage(type, currentStatus) {
  if (type !== "note") return undefined;
  return statusStageMap[currentStatus] ?? "note";
}

export function upsertManualAcceptedApplication(stores, item, context) {
  const acceptedJob = acceptedJobFromItem(item.identity?.source ?? "linkedin", item, {
    now: context.now,
    canonicalFile: context.canonicalFile ?? "",
    annotationFile: "",
  });
  const accepted = {
    version: stores.accepted?.version ?? 1,
    items: [...(stores.accepted?.items ?? [])],
  };
  const applications = {
    version: stores.applications?.version ?? 1,
    items: [...(stores.applications?.items ?? [])],
  };

  const acceptedIndex = accepted.items.findIndex((entry) => entry.jobKey === acceptedJob.jobKey);
  if (acceptedIndex >= 0) {
    accepted.items[acceptedIndex] = {
      ...accepted.items[acceptedIndex],
      ...acceptedJob,
      firstSeenAt: accepted.items[acceptedIndex].firstSeenAt ?? acceptedJob.firstSeenAt,
      acceptedAt: accepted.items[acceptedIndex].acceptedAt ?? acceptedJob.acceptedAt,
    };
  } else {
    accepted.items.push(acceptedJob);
  }

  const appIndex = applications.items.findIndex((entry) => entry.jobKey === acceptedJob.jobKey);
  const acceptedEvent = createEvent("accepted", "Accepted from manual LinkedIn import", context.now.slice(0, 10));
  if (appIndex >= 0) {
    const existing = applications.items[appIndex];
    const events = existing.events ?? [];
    applications.items[appIndex] = {
      ...defaultApplication(acceptedJob.jobKey),
      ...existing,
      events: events.some((event) => event.type === "accepted") ? events : [acceptedEvent, ...events],
    };
  } else {
    applications.items.push({
      ...defaultApplication(acceptedJob.jobKey),
      events: [acceptedEvent],
    });
  }

  return { accepted, applications };
}

function upsertAcceptedApplication(payload, context) {
  const { item, files } = findJobForAnnotation(payload);
  const acceptedJob = acceptedJobFromItem(payload.source, item, {
    now: context.now,
    canonicalFile: files.canonicalFile,
    annotationFile: context.annotationFile,
  });

  const accepted = loadAcceptedJobs();
  const acceptedItems = accepted.items ?? [];
  const acceptedIndex = acceptedItems.findIndex((entry) => entry.jobKey === acceptedJob.jobKey);
  if (acceptedIndex >= 0) {
    acceptedItems[acceptedIndex] = {
      ...acceptedItems[acceptedIndex],
      ...acceptedJob,
      firstSeenAt: acceptedItems[acceptedIndex].firstSeenAt ?? acceptedJob.firstSeenAt,
      acceptedAt: acceptedItems[acceptedIndex].acceptedAt ?? acceptedJob.acceptedAt,
    };
  } else {
    acceptedItems.push(acceptedJob);
  }
  saveAcceptedJobs({ version: accepted.version ?? 1, items: acceptedItems });

  const applications = loadApplications();
  const applicationItems = applications.items ?? [];
  const appIndex = applicationItems.findIndex((entry) => entry.jobKey === acceptedJob.jobKey);
  const acceptedEvent = createEvent("accepted", payload.note || "Accepted from review UI", context.now.slice(0, 10));

  if (appIndex >= 0) {
    const existing = applicationItems[appIndex];
    const events = existing.events ?? [];
    applicationItems[appIndex] = {
      ...existing,
      currentStatus: existing.currentStatus ?? "accepted",
      appliedAt: existing.appliedAt ?? null,
      nextActionAt: existing.nextActionAt ?? null,
      ownerNote: existing.ownerNote ?? "",
      events: events.some((event) => event.type === "accepted") ? events : [acceptedEvent, ...events],
    };
  } else {
    applicationItems.push({
      jobKey: acceptedJob.jobKey,
      currentStatus: "accepted",
      appliedAt: null,
      nextActionAt: null,
      ownerNote: "",
      events: [acceptedEvent],
    });
  }
  saveApplications({ version: applications.version ?? 1, items: applicationItems });
}

async function importLinkedinJobUrl(payload) {
  const url = String(payload.url ?? "").trim();
  if (!url) {
    const error = new Error("url is required");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const extracted = await scrapeLinkedinJob(url);
  const rawItem = extractedLinkedinJobToRawItem(extracted, now);
  const rawName = `linkedin-manual-${timestampForFile(new Date(now))}.json`;
  const rawRelative = `data/raw/${rawName}`;
  const rawFilePath = path.join(rawDir, rawName);
  writeJson(rawFilePath, {
    source: "linkedin",
    taskName: "manual-linkedin-job-import",
    runStatus: "MANUAL",
    savedAt: now,
    count: 1,
    items: [rawItem],
  });

  const job = adaptLinkedinItem(rawItem, {
    rawFile: rawRelative,
    collectedAt: now,
    runId: "manual",
    datasetId: "manual",
  });
  const next = upsertManualAcceptedApplication({
    accepted: loadAcceptedJobs(),
    applications: loadApplications(),
  }, job, {
    now,
    canonicalFile: "",
    rawFile: rawRelative,
  });
  saveAcceptedJobs(next.accepted);
  saveApplications(next.applications);
  return { jobKey: job.identity.jobId, rawFile: rawRelative };
}

function loadReviewState(options) {
  const { batchId, canonicalFile, selectedFile } = options;
  const canonicalPath = canonicalFile
    ? resolveDataFile(canonicalFile, canonicalDir)
    : path.join(canonicalDir, `${batchId}.json`);
  const selectedPath = selectedFile
    ? resolveDataFile(selectedFile, selectedDir)
    : path.join(selectedDir, `${batchIdFromFile(canonicalPath)}.json`);
  const effectiveBatchId = batchId ?? batchIdFromFile(canonicalPath);
  const annPath = annotationPath(effectiveBatchId);
  const accepted = loadAcceptedJobs();
  const acceptedKeys = new Set((accepted.items ?? []).map((item) => item.jobKey));

  const canonical = readJson(canonicalPath);
  if (!canonical) {
    const error = new Error(`Missing canonical file: ${path.relative(rootDir, canonicalPath)}`);
    error.statusCode = 404;
    throw error;
  }

  const selected = readJson(selectedPath, { items: [] });
  const annotationFile = readAnnotationFile(annPath, effectiveBatchId);
  const annotationMap = annotationsById(annotationFile);
  const selectedIds = new Set((selected.items ?? []).map(safeJobId));
  const canonicalItems = canonical.items ?? [];
  function withReviewMeta(item) {
    const key = jobKey(null, item);
    return {
      ...item,
      _reviewMeta: {
        jobKey: key,
        duplicateAccepted: acceptedKeys.has(key),
      },
    };
  }

  const selectedItems = (selected.items ?? [])
    .filter((item) => annotationMap[safeJobId(item)]?.decision !== "reject")
    .map(withReviewMeta)
    .filter((item) => !item._reviewMeta.duplicateAccepted);
  const rejectedItems = canonicalItems
    .filter((item) => !selectedIds.has(safeJobId(item)) || annotationMap[safeJobId(item)]?.decision === "reject")
    .map(withReviewMeta)
    .filter((item) => !item._reviewMeta.duplicateAccepted);
  const duplicateAccepted = canonicalItems.filter((item) => acceptedKeys.has(jobKey(null, item))).length;

  return {
    date: effectiveBatchId,
    batchId: effectiveBatchId,
    files: {
      canonical: path.relative(rootDir, canonicalPath),
      selected: path.relative(rootDir, selectedPath),
      annotations: path.relative(rootDir, annPath),
    },
    counts: {
      selected: selectedItems.length,
      rejected: rejectedItems.length,
      duplicateAccepted,
      annotations: Object.keys(annotationMap).length,
    },
    items: {
      selected: selectedItems,
      rejected: rejectedItems,
    },
    annotations: annotationMap,
  };
}

function mergeAndSelect(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) {
    const error = new Error("date must be YYYY-MM-DD");
    error.statusCode = 400;
    throw error;
  }

  const merge = mergeCanonicalForDate(date, { rootDir });
  const canonicalFile = path.join("data", "canonical", `${date}.json`);
  const selectedFile = path.join("data", "selected", `${date}.json`);
  const selection = selectJobsFile(canonicalFile, selectedFile, "config/preferences.linkedin.json", { cwd: rootDir });

  return {
    ok: true,
    date,
    canonicalFile: canonicalFile.replaceAll(path.sep, "/"),
    selectedFile: selectedFile.replaceAll(path.sep, "/"),
    canonicalItems: merge.canonicalItems,
    selectedCount: selection.selectedCount,
    files: merge.files,
  };
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function upsertAnnotation(payload) {
  const { date, id } = payload;
  if (!date || !id) {
    const error = new Error("date and id are required");
    error.statusCode = 400;
    throw error;
  }

  const filePath = annotationPath(date);
  const annotationFilePath = relativeDataPath(filePath);
  if (payload.decision === "accept") {
    findJobForAnnotation(payload);
  }
  const annotationFile = readAnnotationFile(filePath, date);
  const now = new Date().toISOString();
  const items = annotationFile.items ?? [];
  const index = items.findIndex((item) => String(item.id) === String(id));
  const nextItem = {
    id: String(id),
    decision: payload.decision ?? null,
    note: payload.note ?? "",
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    reviewedAt: now,
  };

  if (index >= 0) {
    items[index] = { ...items[index], ...nextItem };
  } else {
    items.push(nextItem);
  }

  const nextFile = {
    date,
    createdAt: annotationFile.createdAt ?? now,
    updatedAt: now,
    items,
  };
  writeJson(filePath, nextFile);
  if (payload.decision === "accept") {
    upsertAcceptedApplication(payload, { now, annotationFile: annotationFilePath });
  }
  return nextFile;
}

export function defaultApplication(jobKey) {
  return {
    jobKey,
    currentStatus: "accepted",
    appliedAt: null,
    nextActionAt: null,
    ownerNote: "",
    statusUrl: "",
    events: [],
  };
}

export function normalizeApplicationDetails(current, payload) {
  return {
    ...current,
    statusUrl: String(payload.statusUrl ?? current.statusUrl ?? "").trim(),
  };
}

function loadDashboardState() {
  const accepted = loadAcceptedJobs();
  const applications = loadApplications();
  const appMap = new Map((applications.items ?? []).map((item) => [item.jobKey, item]));
  const items = (accepted.items ?? []).map((job) => ({
    job,
    application: appMap.get(job.jobKey) ?? defaultApplication(job.jobKey),
  }));
  const counts = Object.fromEntries(Object.keys(statuses).map((status) => [status, 0]));
  counts.all = items.length;
  for (const item of items) {
    const status = item.application.currentStatus ?? "accepted";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return { statuses, counts, items };
}

function appendApplicationEvent(payload) {
  const { jobKey, type } = payload;
  if (!jobKey || !type) {
    const error = new Error("jobKey and type are required");
    error.statusCode = 400;
    throw error;
  }

  if (type === "reject") {
    return rejectDashboardJob(payload);
  }

  const accepted = loadAcceptedJobs();
  if (!(accepted.items ?? []).some((job) => job.jobKey === jobKey)) {
    const error = new Error(`Accepted job not found: ${jobKey}`);
    error.statusCode = 404;
    throw error;
  }

  const applications = loadApplications();
  const items = applications.items ?? [];
  let index = items.findIndex((item) => item.jobKey === jobKey);
  if (index < 0) {
    items.push(defaultApplication(jobKey));
    index = items.length - 1;
  }

  const current = items[index];
  const nextStatus = eventStatusMap[type] ?? current.currentStatus ?? "accepted";
  const event = createEvent(type, payload.note ?? "", payload.date || new Date().toISOString().slice(0, 10), {
    stage: applicationEventStage(type, current.currentStatus ?? "accepted"),
  });
  items[index] = {
    ...current,
    currentStatus: nextStatus,
    appliedAt: type === "applied" ? event.date : current.appliedAt ?? null,
    nextActionAt: payload.nextActionAt ?? current.nextActionAt ?? null,
    ownerNote: type === "note" && payload.note ? payload.note : current.ownerNote ?? "",
    events: [...(current.events ?? []), event],
  };

  saveApplications({ version: applications.version ?? 1, items });
  return items[index];
}

function updateApplicationDetails(payload) {
  const { jobKey } = payload;
  if (!jobKey) {
    const error = new Error("jobKey is required");
    error.statusCode = 400;
    throw error;
  }

  const accepted = loadAcceptedJobs();
  if (!(accepted.items ?? []).some((job) => job.jobKey === jobKey)) {
    const error = new Error(`Accepted job not found: ${jobKey}`);
    error.statusCode = 404;
    throw error;
  }

  const applications = loadApplications();
  const items = applications.items ?? [];
  let index = items.findIndex((item) => item.jobKey === jobKey);
  if (index < 0) {
    items.push(defaultApplication(jobKey));
    index = items.length - 1;
  }

  items[index] = normalizeApplicationDetails(items[index], payload);
  saveApplications({ version: applications.version ?? 1, items });
  return items[index];
}

function rejectDashboardJob(payload) {
  const { jobKey } = payload;
  if (!jobKey) {
    const error = new Error("jobKey is required");
    error.statusCode = 400;
    throw error;
  }

  const accepted = loadAcceptedJobs();
  const job = (accepted.items ?? []).find((item) => item.jobKey === jobKey);
  if (!job) {
    const error = new Error(`Accepted job not found: ${jobKey}`);
    error.statusCode = 404;
    throw error;
  }

  if (job.annotationFile) {
    const { filePath, annotationFile } = readAnnotationFileByRelativePath(job.annotationFile);
    const now = new Date().toISOString();
    const items = annotationFile.items ?? [];
    const id = String(job.sourceJobId);
    const index = items.findIndex((item) => String(item.id) === id);
    const nextItem = {
      id,
      decision: "reject",
      note: payload.note ?? "",
      tags: [],
      reviewedAt: now,
    };
    if (index >= 0) {
      items[index] = {
        ...items[index],
        ...nextItem,
        note: payload.note ? payload.note : items[index].note ?? "",
        tags: Array.isArray(items[index].tags) ? items[index].tags : [],
      };
    } else {
      items.push(nextItem);
    }
    writeJson(filePath, { ...annotationFile, updatedAt: now, items });
  }

  saveAcceptedJobs({
    version: accepted.version ?? 1,
    items: (accepted.items ?? []).filter((item) => item.jobKey !== jobKey),
  });

  const applications = loadApplications();
  saveApplications({
    version: applications.version ?? 1,
    items: (applications.items ?? []).filter((item) => item.jobKey !== jobKey),
  });

  return { jobKey, sourceJobId: job.sourceJobId };
}

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(publicDir, `.${requestedPath}`);
  if (!filePath.startsWith(publicDir)) {
    sendError(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendError(res, error.code === "ENOENT" ? 404 : 500, "Static file error", error.message);
      return;
    }

    const contentType = mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    const canonicalFile = url.searchParams.get("canonicalFile");
    const selectedFile = url.searchParams.get("selectedFile");
    const latest = canonicalFile ? null : latestCanonicalFile();
    const batchId = url.searchParams.get("batch") ?? url.searchParams.get("date") ?? (latest ? batchIdFromFile(latest) : null);
    if (!batchId && !canonicalFile) {
      sendError(res, 404, "No canonical batches found");
      return;
    }
    sendJson(res, 200, loadReviewState({ batchId, canonicalFile, selectedFile }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/merge") {
    const payload = await readRequestJson(req);
    const result = mergeAndSelect(payload.date);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/annotations") {
    const payload = await readRequestJson(req);
    const annotationFile = upsertAnnotation(payload);
    sendJson(res, 200, { ok: true, annotations: annotationsById(annotationFile) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    sendJson(res, 200, loadDashboardState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/applications/event") {
    const payload = await readRequestJson(req);
    const application = appendApplicationEvent(payload);
    sendJson(res, 200, { ok: true, application, dashboard: loadDashboardState() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/applications/details") {
    const payload = await readRequestJson(req);
    const application = updateApplicationDetails(payload);
    sendJson(res, 200, { ok: true, application, dashboard: loadDashboardState() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/applications/import-linkedin-url") {
    const payload = await readRequestJson(req);
    const imported = await importLinkedinJobUrl(payload);
    sendJson(res, 200, { ok: true, imported, dashboard: loadDashboardState() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/applications/reject") {
    const payload = await readRequestJson(req);
    const rejected = rejectDashboardJob(payload);
    sendJson(res, 200, { ok: true, rejected, dashboard: loadDashboardState() });
    return;
  }

  sendError(res, 404, "Unknown API route");
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, error.statusCode ?? 500, error.message ?? "Server error");
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  server.listen(port, host, () => {
    console.log(`Review UI server: http://${host}:${port}`);
  });
}
