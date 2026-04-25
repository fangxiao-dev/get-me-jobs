# Review UI And Preference Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local review UI for accepting/rejecting job results with notes, then create a `preference-analyse` skill that turns human annotations into proposed updates for `config/preferences.linkedin.json`.

**Architecture:** Use a lightweight Node local server to serve static frontend files and read/write project JSON files. Keep selection rules data-driven in `config/preferences.linkedin.json`, keep human annotations in `annotations/*.json`, and keep preference analysis in a separate skill with deterministic helper scripts.

**Tech Stack:** Node.js 22, built-in `node:http`, vanilla HTML/CSS/JS, JSON files, Codex skill files.

---

### Task 1: Add Review API Server Skeleton

**Files:**
- Create: `app/server.mjs`
- Create: `app/public/index.html`
- Create: `app/public/app.js`
- Create: `app/public/styles.css`

**Step 1: Write the initial server**

Create `app/server.mjs` with a small `node:http` server. It should:

- Serve files from `app/public`.
- Listen on `127.0.0.1:4173` by default.
- Allow `PORT` override.
- Return JSON errors for API routes.

**Step 2: Add placeholder frontend files**

Create:

- `app/public/index.html`: root shell with `#app`.
- `app/public/app.js`: fetch `/api/state` and render a placeholder.
- `app/public/styles.css`: minimal readable layout.

**Step 3: Run the server**

Run:

```powershell
node app/server.mjs
```

Expected:

- Server prints `http://127.0.0.1:4173`.
- Browser can load the placeholder page.

### Task 2: Implement Data Loading Endpoint

**Files:**
- Modify: `app/server.mjs`
- Modify: `app/public/app.js`

**Step 1: Add JSON helpers**

In `app/server.mjs`, add helpers:

- `readJson(filePath, fallback)`
- `writeJson(filePath, value)`
- `safeJobId(item)` using `id`, `sourceJobId`, or `link`.
- `loadReviewState(date, source)`

**Step 2: Add `GET /api/state`**

Implement:

```text
GET /api/state?date=2026-04-25&source=linkedin
```

It should read:

- `raw/<date>.json`
- `selected/<date>.json`
- `annotations/<date>.<source>.json` if present

It should return:

```json
{
  "date": "2026-04-25",
  "source": "linkedin",
  "counts": { "raw": 50, "selected": 8, "rejected": 42, "annotations": 0 },
  "items": {
    "selected": [],
    "raw": [],
    "rejected": []
  },
  "annotations": {}
}
```

`rejected` means raw jobs whose IDs are not in selected.

**Step 3: Render counts**

Update `app/public/app.js` to render counts for Selected, Raw, and Rejected.

**Step 4: Verify**

Run:

```powershell
node app/server.mjs
```

Open:

```text
http://127.0.0.1:4173/?date=2026-04-25&source=linkedin
```

Expected:

- Selected count is 8.
- Raw count is 50.
- Rejected count is 42.

### Task 3: Implement Annotation Save Endpoint

**Files:**
- Modify: `app/server.mjs`
- Modify: `app/public/app.js`

**Step 1: Add annotation schema helpers**

Annotations should be stored at:

```text
annotations/<date>.<source>.json
```

Use this shape:

```json
{
  "source": "linkedin",
  "rawFile": "raw/2026-04-25.json",
  "selectedFile": "selected/2026-04-25.json",
  "createdAt": "iso",
  "updatedAt": "iso",
  "items": []
}
```

Each item:

```json
{
  "id": "job-id",
  "decision": "accept",
  "note": "text",
  "tags": ["good_topic"],
  "reviewedAt": "iso"
}
```

**Step 2: Add `POST /api/annotations`**

Request body:

```json
{
  "date": "2026-04-25",
  "source": "linkedin",
  "id": "4405313639",
  "decision": "accept",
  "note": "Looks relevant",
  "tags": ["good_topic"]
}
```

The server should upsert by `id` and preserve other annotation entries.

**Step 3: Add malformed JSON safety**

If the existing annotation file is malformed, copy it to:

```text
annotations/<date>.<source>.json.bak.<timestamp>
```

Then create a clean file.

**Step 4: Verify with curl or PowerShell**

Run:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4173/api/annotations' -ContentType 'application/json' -Body '{"date":"2026-04-25","source":"linkedin","id":"test","decision":"maybe","note":"smoke test","tags":[]}'
```

Expected:

- `annotations/2026-04-25.linkedin.json` exists.
- It contains an item with ID `test`.

### Task 4: Build Review UI Interactions

**Files:**
- Modify: `app/public/index.html`
- Modify: `app/public/app.js`
- Modify: `app/public/styles.css`

**Step 1: Render tabs**

Add tabs:

- Selected
- Raw
- Rejected

Default to Selected.

**Step 2: Render job cards**

Each card should show:

- title
- company
- location
- postedAt
- URL buttons for LinkedIn/apply
- matched selection terms from `_selection` when present
- description preview

**Step 3: Add decision buttons**

Add buttons:

- Accept
- Reject
- Maybe

Clicking saves immediately through `POST /api/annotations`.

**Step 4: Add note field**

Add textarea for natural-language note. Debounce saves by 500 ms.

**Step 5: Add tags**

Add checkbox tags:

- `good_topic`
- `not_ai`
- `not_thesis`
- `too_broad`
- `good_company`
- `language_issue`

Changing tags saves immediately.

**Step 6: Verify manually**

Expected:

- Decisions persist after refresh.
- Notes persist after refresh.
- Tabs do not lose annotation state.

### Task 5: Add Preference Analysis Skill

**Files:**
- Create: `C:\Users\Xiao\.codex\skills\preference-analyse\SKILL.md`
- Create: `C:\Users\Xiao\.codex\skills\preference-analyse\references\annotation-schema.md`
- Create: `C:\Users\Xiao\.codex\skills\preference-analyse\references\preference-schema.md`
- Create: `C:\Users\Xiao\.codex\skills\preference-analyse\references\analysis-workflow.md`
- Create: `C:\Users\Xiao\.codex\skills\preference-analyse\scripts\summarize-annotations.mjs`
- Create: `C:\Users\Xiao\.codex\skills\preference-analyse\scripts\propose-preference-diff.mjs`

**Step 1: Write `SKILL.md`**

The skill should trigger when the user asks to analyze job-review annotations, infer job-search preferences, update `config/preferences*.json`, or improve filtering from accept/reject/maybe notes.

It should instruct the model to:

- Run the bundled summary script first.
- Read annotations and current preferences.
- Identify false positives and false negatives.
- Propose preference changes.
- Ask for confirmation before editing preferences.

**Step 2: Add reference docs**

Document:

- Annotation schema.
- Preference schema.
- Analysis workflow.

**Step 3: Add summary script**

`summarize-annotations.mjs` should accept:

```powershell
node summarize-annotations.mjs <raw.json> <selected.json> <annotations.json> <preferences.json>
```

It should output:

- counts by decision
- accepted selected jobs
- rejected selected jobs
- accepted raw-but-rejected jobs
- common terms from accepted notes
- common terms from rejected notes

**Step 4: Add proposal script**

`propose-preference-diff.mjs` should produce a machine-readable draft:

```json
{
  "addTerms": [],
  "removeTerms": [],
  "addExcludeTerms": [],
  "notes": []
}
```

Keep it heuristic and conservative. The model does the semantic pass after reading the script output.

### Task 6: Add Preference Update Flow

**Files:**
- Modify: `scripts/select-jobs.mjs`
- Modify: `config/preferences.linkedin.json`
- Potentially create: `scripts/apply-preference-proposal.mjs`

**Step 1: Preserve metadata**

Ensure `selected/*.json` records:

- preference file path
- preference version
- selected reasons

This is mostly already present.

**Step 2: Decide whether to add apply script**

If proposals become frequent, add:

```text
scripts/apply-preference-proposal.mjs
```

For the first pass, manual confirmed edits to `config/preferences.linkedin.json` are acceptable.

**Step 3: Verify rerun**

After a confirmed preference edit, rerun:

```powershell
node scripts/select-jobs.mjs raw/2026-04-25.json selected/2026-04-25.json config/preferences.linkedin.json
```

Expected:

- selected count changes only as expected.
- `_selection` explains the new results.

### Task 7: Final Verification

**Files:**
- All files touched above.

**Step 1: Run selector**

```powershell
node scripts/select-jobs.mjs raw/2026-04-25.json selected/2026-04-25.json config/preferences.linkedin.json
```

Expected: exits 0.

**Step 2: Run server**

```powershell
node app/server.mjs
```

Expected: server starts and serves UI.

**Step 3: Browser smoke test**

Open:

```text
http://127.0.0.1:4173/?date=2026-04-25&source=linkedin
```

Expected:

- Selected, Raw, Rejected tabs work.
- At least one annotation can be created and persists after refresh.

**Step 4: Run preference analysis script**

```powershell
node C:\Users\Xiao\.codex\skills\preference-analyse\scripts\summarize-annotations.mjs raw/2026-04-25.json selected/2026-04-25.json annotations/2026-04-25.linkedin.json config/preferences.linkedin.json
```

Expected:

- exits 0
- prints useful counts and preference hints

---

Plan complete.
