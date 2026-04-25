import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "public");
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const acceptedJobsPath = path.join(rootDir, "data", "accepted-jobs.json");
const applicationsPath = path.join(rootDir, "data", "applications.json");

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

function safeJobId(item) {
  return String(item?.id ?? item?.sourceJobId ?? item?.link ?? item?.url ?? "");
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
  if (item?.id) return `${source}:${item.id}`;
  if (item?.sourceJobId) return `${source}:${item.sourceJobId}`;
  if (item?.link || item?.url) return `${source}:url:${canonicalUrl(item.link ?? item.url)}`;
  return `${source}:text:${normalizeText(item.companyName)}|${normalizeText(item.title)}|${normalizeText(item.location)}`;
}

function latestBatchDate() {
  const rawDir = path.join(rootDir, "raw");
  const files = fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [];
  return files
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter(Boolean)
    .sort()
    .at(-1);
}

function annotationPath(date, source) {
  return path.join(rootDir, "annotations", `${date}.${source}.json`);
}

function readAnnotationFile(filePath, date, source) {
  try {
    return readJson(filePath, {
      source,
      rawFile: `raw/${date}.json`,
      selectedFile: `selected/${date}.json`,
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
        source,
        rawFile: `raw/${date}.json`,
        selectedFile: `selected/${date}.json`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [],
        recoveredFromMalformedFile: path.basename(backupPath),
      };
    }
    throw error;
  }
}

function annotationsById(annotationFile) {
  return Object.fromEntries((annotationFile.items ?? []).map((item) => [String(item.id), item]));
}

function loadReviewState(date, source) {
  const rawPath = path.join(rootDir, "raw", `${date}.json`);
  const selectedPath = path.join(rootDir, "selected", `${date}.json`);
  const annotationsPath = annotationPath(date, source);
  const accepted = loadAcceptedJobs();
  const acceptedKeys = new Set((accepted.items ?? []).map((item) => item.jobKey));

  const raw = readJson(rawPath);
  if (!raw) {
    const error = new Error(`Missing raw file: raw/${date}.json`);
    error.statusCode = 404;
    throw error;
  }

  const selected = readJson(selectedPath, { items: [] });
  const annotationFile = readAnnotationFile(annotationsPath, date, source);
  const selectedIds = new Set((selected.items ?? []).map(safeJobId));
  const rawItems = raw.items ?? [];
  function withReviewMeta(item) {
    const key = jobKey(source, item);
    return {
      ...item,
      _reviewMeta: {
        jobKey: key,
        duplicateAccepted: acceptedKeys.has(key),
      },
    };
  }

  const selectedItems = (selected.items ?? [])
    .map(withReviewMeta)
    .filter((item) => !item._reviewMeta.duplicateAccepted);
  const rejectedItems = rawItems
    .filter((item) => !selectedIds.has(safeJobId(item)))
    .map(withReviewMeta)
    .filter((item) => !item._reviewMeta.duplicateAccepted);
  const duplicateAccepted = rawItems.filter((item) => acceptedKeys.has(jobKey(source, item))).length;
  const annotationMap = annotationsById(annotationFile);

  return {
    date,
    source,
    files: {
      raw: path.relative(rootDir, rawPath),
      selected: path.relative(rootDir, selectedPath),
      annotations: path.relative(rootDir, annotationsPath),
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

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function upsertAnnotation(payload) {
  const { date, source, id } = payload;
  if (!date || !source || !id) {
    const error = new Error("date, source, and id are required");
    error.statusCode = 400;
    throw error;
  }

  const filePath = annotationPath(date, source);
  const annotationFile = readAnnotationFile(filePath, date, source);
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
    source,
    rawFile: `raw/${date}.json`,
    selectedFile: `selected/${date}.json`,
    createdAt: annotationFile.createdAt ?? now,
    updatedAt: now,
    items,
  };
  writeJson(filePath, nextFile);
  return nextFile;
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
    const date = url.searchParams.get("date") ?? latestBatchDate();
    if (!date) {
      sendError(res, 404, "No raw batches found");
      return;
    }
    const source = url.searchParams.get("source") ?? "linkedin";
    sendJson(res, 200, loadReviewState(date, source));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/annotations") {
    const payload = await readRequestJson(req);
    const annotationFile = upsertAnnotation(payload);
    sendJson(res, 200, { ok: true, annotations: annotationsById(annotationFile) });
    return;
  }

  sendError(res, 404, "Unknown API route");
}

const server = http.createServer(async (req, res) => {
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

server.listen(port, host, () => {
  console.log(`Review UI server: http://${host}:${port}`);
});
