# Application Status Link And Stage Notes Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a manually maintained application-status URL to each dashboard job and make per-stage notes easy to review while collapsed by default.

**Architecture:** Keep status tracking on `data/applications.json`, not accepted job records. Add a small application details API for `statusUrl`, keep stage notes as timeline events, and render those notes behind one outer collapsed `Stage notes (N)` section on each dashboard card.

**Tech Stack:** Local Node.js server, vanilla JavaScript, CSS, `node:test`.

---

### Task 1: Application Status URL Data

**Files:**
- Modify: `app/server.mjs`
- Test: `scripts/lib/tests/application-dashboard.test.mjs`

**Steps:**
1. Write failing tests for default application shape and manual status URL patching.
2. Export small pure helpers from `app/server.mjs`.
3. Add `statusUrl` to new/default application records.
4. Add `POST /api/applications/details` to update only application tracking fields.
5. Run `node --test scripts/lib/tests/application-dashboard.test.mjs`.

### Task 2: Dashboard UI

**Files:**
- Modify: `app/public/app.js`
- Modify: `app/public/styles.css`
- Test: `scripts/lib/tests/application-dashboard-ui.test.mjs`

**Steps:**
1. Write failing tests for stage note grouping.
2. Render `Status` as a separate link from `Source` and `Apply`.
3. Add an inline status-link editor on each dashboard card.
4. Render stage notes as an outer collapsed `Stage notes (N)` details element. When opened, it contains collapsed details grouped by stage.
5. Run relevant `node --test` files.

**Final stage-note behavior:**
- Default dashboard cards show only `Stage notes (N)`.
- Expanding `Stage notes (N)` reveals only per-stage note groups that contain at least one note.
- Per-stage groups remain collapsed by default.
- `N` counts only notes attached to displayed stage groups: `applied`, `interview_scheduled`, `interview_completed`, `employer_agreed`, `closed`, and general `note`.
- `accepted` event notes are provenance metadata and are not counted or shown as stage notes.
- Free-form `Add Note` events belong to the current application stage. New events should persist a `stage` value; older `note` events without a stage may be displayed under the current status as a compatibility fallback.

### Task 3: Verification

**Files:**
- Check: `scripts/check-dashboard-data.mjs`
- Check: dashboard in browser or local server smoke test

**Steps:**
1. Run all Node tests.
2. Run `node scripts/check-dashboard-data.mjs`.
3. Start `node app/server.mjs` and verify the dashboard route loads.
