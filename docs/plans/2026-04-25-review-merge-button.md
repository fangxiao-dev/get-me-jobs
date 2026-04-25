# Review Merge Button Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Review-page `Merge Raw` button that incrementally merges new local raw files for the current date, regenerates selected jobs, and refreshes the review queue.

**Architecture:** Extract reusable functions from the existing CLI scripts so server and CLI share the same merge and selection behavior. Add `POST /api/merge` in `app/server.mjs`, then add a Review-page button in `app/public/app.js` that calls the endpoint, displays a compact result, and reloads state.

**Tech Stack:** Node.js 22 built-ins, vanilla HTML/CSS/JS, existing local JSON file stores.

---

### Task 1: Export Reusable Merge Function

**Files:**
- Modify: `scripts/merge-canonical.mjs`
- Test: `node scripts/merge-canonical.mjs 2026-04-25`

**Step 1: Refactor without behavior changes**

Move the current top-level merge logic into:

```js
export function mergeCanonicalForDate(dateArg, options = {}) {
  const root = options.rootDir ?? rootDir;
  const rawBase = options.rawDir ?? path.join(root, "data", "raw");
  const canonicalBase = options.canonicalDir ?? path.join(root, "data", "canonical");
  // Existing allRawFiles/latestDate/filesForDate/canonical loop logic,
  // but using root/rawBase/canonicalBase instead of module constants.
  return {
    date: targetDate,
    canonicalPath: path.relative(root, canonicalPath).replaceAll(path.sep, "/"),
    canonicalItems: canonical.items.length,
    files: summary,
  };
}
```

Keep CLI behavior by adding a direct-run guard:

```js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = mergeCanonicalForDate(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
```

Preserve current skip behavior:

```js
if (lastRawFileTime && time < lastRawFileTime) {
  summary.push({ file: name, skipped: true, reason: "not newer than canonical watermark" });
  continue;
}
```

**Step 2: Verify CLI still works**

Run:

```powershell
node scripts/merge-canonical.mjs 2026-04-25
```

Expected: JSON output for date `2026-04-25`, `canonicalItems` or equivalent count remains `50`, already-processed files are skipped.

**Step 3: Commit**

```bash
git add scripts/merge-canonical.mjs
git commit -m "refactor: export canonical merge function"
```

---

### Task 2: Export Reusable Selection Function

**Files:**
- Modify: `scripts/select-jobs.mjs`
- Test: `node scripts/select-jobs.mjs data/canonical/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json`

**Step 1: Export selection helpers**

Export the function needed by the server:

```js
export function selectJobsFile(rawPathArg, selectedPathArg, preferencesPathArg, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const rawPath = path.resolve(cwd, rawPathArg);
  const selectedPath = path.resolve(cwd, selectedPathArg ?? path.join("data", "selected", path.basename(rawPath)));
  const preferencesPath = path.resolve(cwd, preferencesPathArg ?? "config/preferences.linkedin.json");

  const raw = readJson(rawPath);
  const preferences = readJson(preferencesPath);
  const previousOutput = fs.existsSync(selectedPath) ? readJson(selectedPath) : null;
  const selected = selectItems(raw, preferences);
  // Existing stableId, selectionUnchanged, output, writeJson logic.
  return {
    rawPath,
    selectedPath,
    preferencesPath,
    rawCount: output.rawCount,
    selectedCount: output.selectedCount,
    written: !selectionUnchanged,
  };
}
```

Keep CLI behavior with the same direct-run guard pattern:

```js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , rawPathArg, selectedPathArg, preferencesPathArg] = process.argv;
  if (!rawPathArg) {
    console.error("Usage: node scripts/select-jobs.mjs <raw.json> [selected.json] [preferences.json]");
    process.exit(1);
  }
  console.log(JSON.stringify(selectJobsFile(rawPathArg, selectedPathArg, preferencesPathArg), null, 2));
}
```

Import `fileURLToPath` from `node:url` because the CLI guard needs it.

**Step 2: Verify CLI still works**

Run:

```powershell
node scripts/select-jobs.mjs data/canonical/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
```

Expected: `rawCount: 50`, `selectedCount: 8`.

**Step 3: Commit**

```bash
git add scripts/select-jobs.mjs
git commit -m "refactor: export job selection function"
```

---

### Task 3: Add `POST /api/merge`

**Files:**
- Modify: `app/server.mjs`
- Test: manual API call with local server

**Step 1: Import reusable functions**

At the top of `app/server.mjs`, add:

```js
import { mergeCanonicalForDate } from "../scripts/merge-canonical.mjs";
import { selectJobsFile } from "../scripts/select-jobs.mjs";
```

**Step 2: Add merge handler**

Add:

```js
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
    canonicalFile,
    selectedFile,
    canonicalItems: merge.canonicalItems,
    selectedCount: selection.selectedCount,
    files: merge.files,
  };
}
```

**Step 3: Wire API route**

In `handleApi`, before the annotation route, add:

```js
if (req.method === "POST" && url.pathname === "/api/merge") {
  const payload = await readRequestJson(req);
  const result = mergeAndSelect(payload.date);
  sendJson(res, 200, result);
  return;
}
```

**Step 4: Verify API manually**

Start server:

```powershell
node app/server.mjs
```

In another terminal:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4173/api/merge -ContentType application/json -Body '{"date":"2026-04-25"}'
```

Expected: `ok: true`, `selectedCount: 8`, and files skipped or merged.

**Step 5: Commit**

```bash
git add app/server.mjs
git commit -m "feat: add merge endpoint"
```

---

### Task 4: Add Review Page Button

**Files:**
- Modify: `app/public/app.js`
- Modify: `app/public/styles.css`
- Test: manual browser verification

**Step 1: Add UI state**

In `state`, add:

```js
mergeRunning: false,
mergeStatus: "",
```

**Step 2: Add API caller**

Add:

```js
async function mergeRawForCurrentDate() {
  if (!state.date || state.mergeRunning) return;
  state.mergeRunning = true;
  state.mergeStatus = "Merging raw files...";
  renderReview();

  try {
    const response = await fetch("/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: state.date }),
    });
    if (!response.ok) throw new Error((await response.json()).error ?? "Failed to merge raw files");
    const result = await response.json();
    state.mergeStatus = mergeStatusText(result);
    await loadState();
  } catch (error) {
    showError(error);
  } finally {
    state.mergeRunning = false;
    renderReview();
  }
}

function mergeStatusText(result) {
  const added = (result.files ?? []).reduce((sum, file) => sum + (file.addedCount ?? 0), 0);
  const duplicates = (result.files ?? []).reduce((sum, file) => sum + (file.duplicateCount ?? 0), 0);
  const rawCount = (result.files ?? []).reduce((sum, file) => sum + (file.rawCount ?? 0), 0);
  if (!rawCount && !(result.files ?? []).some((file) => !file.skipped)) {
    return "No new raw files";
  }
  return `Merged ${rawCount} raw jobs, added ${added}, duplicates ${duplicates}, selected ${result.selectedCount}`;
}
```

**Step 3: Render button on Review page**

In `renderReview`, after the summary is created, add:

```js
const actions = createEl("div", "review-actions");
const mergeButton = createEl("button", "action-button", state.mergeRunning ? "Merging..." : "Merge Raw");
mergeButton.type = "button";
mergeButton.disabled = state.mergeRunning;
mergeButton.addEventListener("click", () => mergeRawForCurrentDate().catch(showError));
actions.append(mergeButton);
if (state.mergeStatus) actions.append(createEl("span", "merge-status", state.mergeStatus));
app.querySelector(".page-header").insertBefore(actions, app.querySelector(".error-banner"));
```

**Step 4: Add small styles**

In `app/public/styles.css`, add:

```css
.review-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.merge-status {
  color: var(--muted);
}
```

**Step 5: Verify in browser**

Run:

```powershell
node scripts/start-review.mjs 2026-04-25 --no-open
```

Open `http://127.0.0.1:4173/?batch=2026-04-25`.

Expected:

- `Merge Raw` appears only on Review page.
- Clicking it disables the button during the request.
- With no newer raw files, it shows `No new raw files`.
- Selected/rejected counts remain stable.
- Existing annotations remain applied.

**Step 6: Commit**

```bash
git add app/public/app.js app/public/styles.css
git commit -m "feat: add Review merge raw button"
```

---

### Task 5: Final Verification

**Files:**
- No code changes expected.

**Step 1: Run unit tests**

```powershell
node --test scripts/lib/tests/*.test.mjs
```

Expected: all tests pass.

**Step 2: Run merge and selection through CLI**

```powershell
node scripts/merge-canonical.mjs 2026-04-25
node scripts/select-jobs.mjs data/canonical/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
```

Expected: canonical count remains stable with no new raw files; selected count remains `8`.

**Step 3: Check dashboard store consistency**

```powershell
node scripts/check-dashboard-data.mjs
```

Expected: no `problems`.

**Step 4: Manual UI check**

Start:

```powershell
node scripts/start-review.mjs 2026-04-25 --no-open
```

Verify:

- Review page loads.
- `Merge Raw` button works with no new raw files.
- No existing annotation is lost.
- Dashboard still loads.

**Step 5: Commit only if verification required tracked changes**

If no files changed during verification, do not create an empty commit.
