# Application Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the local job review tool with cross-batch deduplication, accepted-job registry, and an English application tracking dashboard with timeline events.

**Architecture:** Keep the current local Node server and vanilla frontend. Add deterministic file-backed stores under `data/` for accepted jobs and application tracking, derive Review views from the latest batch by default, and keep application tracking separate from annotations and preference rules.

**Tech Stack:** Node.js 22 built-in modules, vanilla HTML/CSS/JS, JSON files, existing `scripts/select-jobs.mjs`.

---

### Task 1: Add Data Store Helpers

**Files:**
- Modify: `app/server.mjs`

**Step 1: Add constants**

Add these paths near the existing path helpers:

```js
const acceptedJobsPath = path.join(rootDir, "data", "accepted-jobs.json");
const applicationsPath = path.join(rootDir, "data", "applications.json");
```

**Step 2: Add safe store reader**

Add:

```js
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
```

**Step 3: Add store loaders**

Add:

```js
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
```

**Step 4: Verify syntax**

Run:

```powershell
node --check app/server.mjs
```

Expected: exits 0.

### Task 2: Add Stable Job Keys And Latest Batch Discovery

**Files:**
- Modify: `app/server.mjs`

**Step 1: Add job key helpers**

Add:

```js
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
```

**Step 2: Add latest date helper**

Add:

```js
function latestBatchDate() {
  const files = fs.existsSync(path.join(rootDir, "raw"))
    ? fs.readdirSync(path.join(rootDir, "raw"))
    : [];
  return files
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter(Boolean)
    .sort()
    .at(-1);
}
```

**Step 3: Update `/api/state` date default**

Change `GET /api/state` so missing `date` uses `latestBatchDate()` instead of today's date.

If no latest date exists, return a 404 JSON error:

```json
{ "error": "No raw batches found" }
```

**Step 4: Verify**

Run:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:4173/api/state?source=linkedin'
```

Expected: `date` is `2026-04-25`.

### Task 3: Remove Raw Tab And Add Dedup Metadata To Review State

**Files:**
- Modify: `app/server.mjs`
- Modify: `app/public/app.js`
- Modify: `app/public/styles.css`

**Step 1: Add accepted key set**

In `loadReviewState(date, source)`, load accepted jobs:

```js
const accepted = loadAcceptedJobs();
const acceptedKeys = new Set((accepted.items ?? []).map((item) => item.jobKey));
```

**Step 2: Classify selected/rejected**

Decorate each job with `_reviewMeta`:

```js
function withReviewMeta(item) {
  const key = jobKey(source, item);
  return {
    ...item,
    _reviewMeta: {
      jobKey: key,
      duplicateAccepted: acceptedKeys.has(key)
    }
  };
}
```

Use `withReviewMeta` for selected and rejected lists.

**Step 3: Hide accepted duplicates from default queues**

Change returned lists:

```js
const selectedItems = (selected.items ?? []).map(withReviewMeta).filter((item) => !item._reviewMeta.duplicateAccepted);
const rejectedItems = rawItems
  .filter((item) => !selectedIds.has(safeJobId(item)))
  .map(withReviewMeta)
  .filter((item) => !item._reviewMeta.duplicateAccepted);
```

Return counts:

```js
counts: {
  selected,
  rejected,
  duplicateAccepted
}
```

Do not return a `raw` list for the UI.

**Step 4: Update frontend tabs**

Change `tabs` in `app/public/app.js` to:

```js
const tabs = [
  ["selected", "Selected"],
  ["rejected", "Rejected"],
];
```

Remove Raw count rendering from the summary.

**Step 5: Add duplicate badge rendering**

If `_reviewMeta.duplicateAccepted` is true, render `Accepted before`.

**Step 6: Verify**

Open:

```text
http://127.0.0.1:4173/?source=linkedin
```

Expected:

- Page defaults to latest date.
- Only `Selected` and `Rejected` tabs appear.
- No `Raw` tab appears.

### Task 4: Upsert Accepted Jobs On Accept

**Files:**
- Modify: `app/server.mjs`

**Step 1: Add compact accepted job serializer**

Add:

```js
function acceptedJobFromItem(source, item, context) {
  return {
    jobKey: jobKey(source, item),
    source,
    sourceJobId: safeJobId(item),
    title: item.title ?? null,
    companyName: item.companyName ?? null,
    location: item.location ?? null,
    link: item.link ?? item.url ?? null,
    applyUrl: item.applyUrl ?? null,
    firstSeenAt: context.now,
    acceptedAt: context.now,
    rawFile: context.rawFile,
    annotationFile: context.annotationFile
  };
}
```

**Step 2: Add raw job lookup**

When processing `POST /api/annotations`, if `decision === "accept"`, load the relevant raw and selected files and find the job by `id`.

Lookup order:

1. selected items
2. raw items

**Step 3: Upsert `data/accepted-jobs.json`**

If accepted job exists, preserve `firstSeenAt` and update the rest. If not, append it.

**Step 4: Verify**

Post an accept annotation:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4173/api/annotations' -ContentType 'application/json' -Body '{"date":"2026-04-25","source":"linkedin","id":"4405313639","decision":"accept","note":"test accept","tags":["good_topic"]}'
```

Expected:

- `annotations/2026-04-25.linkedin.json` contains the annotation.
- `data/accepted-jobs.json` contains `linkedin:4405313639`.

### Task 5: Create Application Records And Timeline Events

**Files:**
- Modify: `app/server.mjs`

**Step 1: Add status constants**

Add:

```js
const statuses = {
  accepted: "Accepted",
  applied_waiting: "Applied, waiting for response",
  interview_scheduled: "Interview scheduled, preparing",
  interview_completed: "Interview completed, waiting for result",
  employer_agreed: "Employer agreed, waiting for contract",
  closed: "Closed / rejected / withdrawn"
};
```

**Step 2: Add event helper**

Add:

```js
function createEvent(type, note = "", date = new Date().toISOString().slice(0, 10)) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    date,
    note
  };
}
```

**Step 3: Add application upsert on accept**

When a job is accepted, ensure `data/applications.json` contains:

```json
{
  "jobKey": "linkedin:4405313639",
  "currentStatus": "accepted",
  "appliedAt": null,
  "nextActionAt": null,
  "ownerNote": "",
  "events": [
    { "type": "accepted", "date": "...", "note": "Accepted from review UI" }
  ]
}
```

Do not duplicate the `accepted` event if it already exists.

**Step 4: Verify**

Repeat the accept POST.

Expected:

- `data/applications.json` contains one application item.
- It has exactly one `accepted` event.

### Task 6: Add Dashboard API

**Files:**
- Modify: `app/server.mjs`

**Step 1: Add `GET /api/dashboard`**

Return:

```json
{
  "statuses": {},
  "counts": {},
  "items": [
    {
      "job": {},
      "application": {}
    }
  ]
}
```

Join `data/accepted-jobs.json` and `data/applications.json` by `jobKey`.

**Step 2: Add `POST /api/applications/event`**

Request:

```json
{
  "jobKey": "linkedin:4405313639",
  "type": "applied",
  "date": "2026-04-26",
  "note": "Applied via company website",
  "nextActionAt": "2026-05-02"
}
```

Update `currentStatus` based on event type:

- `applied` -> `applied_waiting`
- `interview_scheduled` -> `interview_scheduled`
- `interview_completed` -> `interview_completed`
- `employer_agreed` -> `employer_agreed`
- `rejected`, `withdrawn`, `contract_signed` -> `closed`
- `note` -> keep existing status

Append event to `events`.

**Step 3: Verify**

Run:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:4173/api/dashboard'
```

Expected: accepted job appears with application status.

### Task 7: Build Dashboard UI

**Files:**
- Modify: `app/public/index.html`
- Modify: `app/public/app.js`
- Modify: `app/public/styles.css`

**Step 1: Add top navigation**

Add English navigation:

```text
Review | Dashboard
```

Use URL state:

```text
/?view=review
/?view=dashboard
```

Default to `review`.

**Step 2: Add dashboard state loader**

In `app/public/app.js`, add `loadDashboard()` that fetches `/api/dashboard`.

**Step 3: Render dashboard layout**

Use a dense work-surface layout:

- top summary counts
- status tabs
- search input
- job list
- timeline under each job or in an expanded details section

Avoid:

- hero sections
- decorative cards inside cards
- gradient/orb backgrounds
- oversized headings inside cards

**Step 4: Render action buttons**

For each job, render:

- `Mark Applied`
- `Schedule Interview`
- `Mark Interview Completed`
- `Mark Employer Agreed`
- `Close`
- `Add Note`

Each button should open a compact inline form with date and note, then call `POST /api/applications/event`.

**Step 5: Verify manually**

Expected:

- Dashboard is English-only.
- Accepted jobs appear.
- Status filter works.
- Adding an event updates the timeline and current status.

### Task 8: Add Dedupe Verification Script

**Files:**
- Create: `scripts/check-dashboard-data.mjs`

**Step 1: Implement checks**

Script should read:

- `data/accepted-jobs.json`
- `data/applications.json`

Check:

- no duplicate `jobKey` in accepted jobs
- no duplicate `jobKey` in applications
- every application has an accepted job
- every accepted job has an application

**Step 2: Print result**

Output:

```json
{
  "acceptedJobs": 1,
  "applications": 1,
  "problems": []
}
```

**Step 3: Verify**

Run:

```powershell
node scripts/check-dashboard-data.mjs
```

Expected: exits 0 with empty `problems`.

### Task 9: Update Project Docs

**Files:**
- Modify: `project-context.md`
- Modify: `.AGENTS.md`

**Step 1: Update workflow**

Update workflow to include:

```text
accepted-jobs registry -> application dashboard -> timeline tracking
```

**Step 2: Update verification**

Add:

```powershell
node scripts/check-dashboard-data.mjs
```

Add dashboard manual verification:

- Review has Selected and Rejected only.
- Dashboard can update timeline and status.

**Step 3: Verify docs are concise**

Run:

```powershell
git diff -- .AGENTS.md project-context.md
```

Expected: docs stay operational and brief.

### Task 10: Final Verification

**Files:**
- All changed files.

**Step 1: Run selector**

```powershell
node scripts/select-jobs.mjs raw/2026-04-25.json selected/2026-04-25.json config/preferences.linkedin.json
```

Expected:

- exits 0
- selected count remains explainable

**Step 2: Run dashboard data check**

```powershell
node scripts/check-dashboard-data.mjs
```

Expected:

- exits 0
- no duplicate or orphan problems

**Step 3: Start server**

```powershell
node app/server.mjs
```

Expected:

- server starts on `http://127.0.0.1:4173`

**Step 4: Browser verification**

Open:

```text
http://127.0.0.1:4173/?source=linkedin
```

Expected:

- Review defaults to latest data.
- Review shows Selected and Rejected only.
- Accept creates accepted job and application record.
- Dashboard shows accepted job.
- Timeline actions update status and append events.

**Step 5: Git status**

```powershell
git status --short
```

Expected:

- only intentional files changed
- no `.env`

---

Plan complete.
