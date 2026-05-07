# Local LinkedIn Assisted Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents unless the user explicitly asks for parallel execution.

**Goal:** Build an isolated local Actor-style PoC that opens one user-provided LinkedIn jobs search page, uses controlled scrolling only inside the left-side results list to preview up to 25 job URLs, and after one confirmation processes at most 25 jobs in 5-job batches with stop-on-anomaly behavior.

**Architecture:** The first implementation lives entirely under `tmp/linkedin-assisted-collector/`, which is already ignored by the repository `.gitignore`. It uses a small local Node/Playwright CLI with Apify Actor-compatible folder structure, fixture-driven tests, cookie normalization, URL preview, strict batch limits, and dry-run output by default. Promotion into tracked project scripts or `data/raw/` is a separate explicit approval step after local validation.

**Tech Stack:** Node.js ESM, Playwright, Node built-in test runner, Apify Actor folder conventions, local filesystem JSON output.

---

## Source Design

This plan implements the design in:

- `docs/plans/2026-05-07-local-linkedin-assisted-collector-design.md`

Non-negotiable constraints from the design:

- Local machine only.
- No account password storage.
- Cookie file path stays outside the repository by default.
- Same User-Agent as the browser that exported cookies.
- One search page URL per run.
- Extract job detail URLs only from the current page's left-side results list.
- Controlled URL discovery may scroll only the left-side results list.
- Result-list scrolling is capped at 12 rounds, random 300-600 px per round, random 2-5 seconds wait per round, and 2 consecutive no-new rounds.
- No automatic pagination.
- No infinite scroll.
- No whole-page scrolling for URL discovery.
- No right-side detail panel scrolling for URL discovery.
- One URL preview confirmation before detail extraction.
- Batch size hard-capped at 5.
- Total jobs hard-capped at 25.
- Stop immediately on login, CAPTCHA, checkpoint, verification, access restriction, repeated extraction failure, repeated navigation failure, or user abort.
- First implementation defaults to `dryRun: true`.
- No writes to existing project data unless a later explicit integration step is approved.

## File Structure

Create only new files under `tmp/linkedin-assisted-collector/` during PoC implementation:

```text
tmp/linkedin-assisted-collector/
  .actor/
    actor.json
    input_schema.json
  package.json
  src/
    batch-runner.mjs
    browser.mjs
    cookies.mjs
    extract-job.mjs
    extract-search.mjs
    input.mjs
    main.mjs
    output.mjs
    result-list-scroll.mjs
    stop-conditions.mjs
    url.mjs
  storage/
    key_value_stores/
      default/
        INPUT.example.json
  test/
    batch-runner.test.mjs
    cookies.test.mjs
    extract-job.test.mjs
    extract-search.test.mjs
    input.test.mjs
    output.test.mjs
    stop-conditions.test.mjs
    url.test.mjs
    fixtures/
      job-detail.html
      job-detail-missing-company.html
      login-wall.html
      search-page.html
      security-checkpoint.html
```

Do not modify root `package.json`, root `package-lock.json`, existing `scripts/`, existing `app/`, or existing `data/`.

## Task 1: Create Isolated Actor-Style Scaffold

**Files:**

- Create: `tmp/linkedin-assisted-collector/package.json`
- Create: `tmp/linkedin-assisted-collector/.actor/actor.json`
- Create: `tmp/linkedin-assisted-collector/.actor/input_schema.json`
- Create: `tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.example.json`

- [ ] **Step 1: Create the local package**

Create `tmp/linkedin-assisted-collector/package.json`:

```json
{
  "name": "local-linkedin-assisted-collector",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "start": "node src/main.mjs",
    "preview": "node src/main.mjs --preview-only"
  },
  "dependencies": {
    "playwright": "1.59.1"
  }
}
```

- [ ] **Step 2: Add Actor metadata**

Create `tmp/linkedin-assisted-collector/.actor/actor.json`:

```json
{
  "actorSpecification": 1,
  "name": "local-linkedin-assisted-collector",
  "title": "Local LinkedIn Assisted Collector",
  "description": "Local, user-confirmed LinkedIn job page assisted collector. Runs on the user's machine only.",
  "version": "0.1",
  "buildTag": "latest",
  "input": "./input_schema.json",
  "storages": {
    "dataset": "./dataset_schema.json"
  }
}
```

- [ ] **Step 3: Add input schema**

Create `tmp/linkedin-assisted-collector/.actor/input_schema.json`:

```json
{
  "title": "Local LinkedIn Assisted Collector Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "searchPageUrl": {
      "title": "LinkedIn search page URL",
      "type": "string",
      "description": "One user-provided LinkedIn jobs search page URL."
    },
    "cookiesPath": {
      "title": "Cookie JSON path",
      "type": "string",
      "description": "Absolute path to a Cookie-Editor style LinkedIn cookies JSON file stored outside this repository."
    },
    "userAgent": {
      "title": "Browser User-Agent",
      "type": "string",
      "description": "The exact User-Agent from the browser session used to export cookies."
    },
    "maxJobs": {
      "title": "Maximum jobs",
      "type": "integer",
      "default": 25,
      "minimum": 1,
      "maximum": 25
    },
    "batchSize": {
      "title": "Batch size",
      "type": "integer",
      "default": 5,
      "minimum": 1,
      "maximum": 5
    },
    "dryRun": {
      "title": "Dry run",
      "type": "boolean",
      "default": true
    },
    "headed": {
      "title": "Show browser",
      "type": "boolean",
      "default": true
    }
  },
  "required": ["searchPageUrl", "cookiesPath", "userAgent"]
}
```

- [ ] **Step 4: Add example local input**

Create `tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.example.json`:

```json
{
  "searchPageUrl": "https://www.linkedin.com/jobs/search/?keywords=example",
  "cookiesPath": "C:/Users/Xiao/secure/linkedin-cookies.json",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "maxJobs": 25,
  "batchSize": 5,
  "dryRun": true,
  "headed": true
}
```

- [ ] **Step 5: Install local dependencies in the isolated directory**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm install
Pop-Location
```

Expected:

- `tmp/linkedin-assisted-collector/package-lock.json` is created inside the ignored `tmp/` tree.
- Root `package.json` and root `package-lock.json` are unchanged.

## Task 2: Input Validation And Hard Limits

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/input.mjs`
- Create: `tmp/linkedin-assisted-collector/test/input.test.mjs`

- [ ] **Step 1: Write failing input tests**

Create `tmp/linkedin-assisted-collector/test/input.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInput } from '../src/input.mjs';

test('validateInput applies safe defaults', () => {
  const input = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36'
  });

  assert.equal(input.maxJobs, 25);
  assert.equal(input.batchSize, 5);
  assert.equal(input.dryRun, true);
  assert.equal(input.headed, true);
  assert.deepEqual(input.jobDelaySeconds, { min: 8, max: 25 });
  assert.deepEqual(input.batchCooldownMinutes, { min: 2, max: 6 });
});

test('validateInput rejects non-LinkedIn search URLs', () => {
  assert.throws(
    () => validateInput({
      searchPageUrl: 'https://example.com/jobs',
      cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
      userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36'
    }),
    /searchPageUrl must be a LinkedIn jobs URL/
  );
});

test('validateInput enforces hard caps', () => {
  const input = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    maxJobs: 100,
    batchSize: 20
  });

  assert.equal(input.maxJobs, 25);
  assert.equal(input.batchSize, 5);
});

test('validateInput rejects cookie paths inside the repository when rootDir is provided', () => {
  assert.throws(
    () => validateInput({
      searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      cookiesPath: 'D:/CodeSpace/job-finder/tmp/linkedin-cookies.json',
      userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
      rootDir: 'D:/CodeSpace/job-finder'
    }),
    /cookiesPath must be outside the repository/
  );
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm test -- test/input.test.mjs
Pop-Location
```

Expected:

- Fails with module-not-found or missing export for `src/input.mjs`.

- [ ] **Step 3: Implement validation**

Create `tmp/linkedin-assisted-collector/src/input.mjs`:

```js
import path from 'node:path';

const DEFAULTS = {
  maxJobs: 25,
  batchSize: 5,
  dryRun: true,
  headed: true,
  jobDelaySeconds: { min: 8, max: 25 },
  batchCooldownMinutes: { min: 2, max: 6 }
};

function clampInteger(value, fallback, min, max) {
  const number = Number.isInteger(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
}

function isLinkedInJobsUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith('linkedin.com') && url.pathname.startsWith('/jobs/');
  } catch {
    return false;
  }
}

function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateInput(rawInput) {
  const input = { ...DEFAULTS, ...rawInput };

  if (!isLinkedInJobsUrl(input.searchPageUrl)) {
    throw new Error('searchPageUrl must be a LinkedIn jobs URL');
  }
  if (!input.cookiesPath || typeof input.cookiesPath !== 'string') {
    throw new Error('cookiesPath is required');
  }
  if (!input.userAgent || typeof input.userAgent !== 'string') {
    throw new Error('userAgent is required');
  }
  if (input.rootDir && isPathInside(input.rootDir, input.cookiesPath)) {
    throw new Error('cookiesPath must be outside the repository');
  }

  return {
    ...input,
    maxJobs: clampInteger(input.maxJobs, DEFAULTS.maxJobs, 1, 25),
    batchSize: clampInteger(input.batchSize, DEFAULTS.batchSize, 1, 5),
    dryRun: input.dryRun !== false,
    headed: input.headed !== false,
    jobDelaySeconds: input.jobDelaySeconds ?? DEFAULTS.jobDelaySeconds,
    batchCooldownMinutes: input.batchCooldownMinutes ?? DEFAULTS.batchCooldownMinutes
  };
}
```

- [ ] **Step 4: Verify input tests pass**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
node --test test/input.test.mjs
Pop-Location
```

Expected:

- All `input.test.mjs` tests pass.

## Task 3: Cookie Loading And Redacted Logging

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/cookies.mjs`
- Create: `tmp/linkedin-assisted-collector/test/cookies.test.mjs`

- [ ] **Step 1: Write failing cookie tests**

Create `tmp/linkedin-assisted-collector/test/cookies.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCookies, normalizeCookie, summarizeCookies } from '../src/cookies.mjs';

test('normalizeCookie maps Cookie-Editor fields to Playwright fields', () => {
  const cookie = normalizeCookie({
    name: 'li_at',
    value: 'secret',
    domain: '.linkedin.com',
    path: '/',
    expirationDate: 1800000000,
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction'
  });

  assert.deepEqual(cookie, {
    name: 'li_at',
    value: 'secret',
    domain: '.linkedin.com',
    path: '/',
    expires: 1800000000,
    secure: true,
    httpOnly: true,
    sameSite: 'None'
  });
});

test('loadCookies reads JSON array and normalizes cookies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-cookies-'));
  const file = path.join(dir, 'cookies.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'bcookie', value: 'secret', domain: '.linkedin.com' }]));

  const cookies = loadCookies(file);

  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, 'bcookie');
  assert.equal(cookies[0].value, 'secret');
  assert.equal(cookies[0].path, '/');
  assert.equal(cookies[0].expires, -1);
});

test('summarizeCookies redacts values', () => {
  const summary = summarizeCookies([
    { name: 'li_at', value: 'secret', domain: '.linkedin.com' },
    { name: 'JSESSIONID', value: 'secret2', domain: '.linkedin.com' }
  ]);

  assert.deepEqual(summary, {
    count: 2,
    cookies: [
      { name: 'li_at', domain: '.linkedin.com', value: '<redacted>' },
      { name: 'JSESSIONID', domain: '.linkedin.com', value: '<redacted>' }
    ]
  });
});
```

- [ ] **Step 2: Run failing cookie tests**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
node --test test/cookies.test.mjs
Pop-Location
```

Expected:

- Fails because `src/cookies.mjs` does not exist.

- [ ] **Step 3: Implement cookie support**

Create `tmp/linkedin-assisted-collector/src/cookies.mjs`:

```js
import fs from 'node:fs';

export function normalizeSameSite(value) {
  const key = String(value ?? 'lax').toLowerCase();
  if (key === 'strict') return 'Strict';
  if (key === 'none' || key === 'no_restriction') return 'None';
  return 'Lax';
}

export function normalizeCookie(cookie) {
  if (!cookie?.name || !cookie?.domain) {
    throw new Error('Cookie must include name and domain');
  }
  return {
    name: String(cookie.name),
    value: String(cookie.value ?? ''),
    domain: String(cookie.domain),
    path: cookie.path ? String(cookie.path) : '/',
    expires: Number.isFinite(cookie.expirationDate) ? cookie.expirationDate : -1,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: normalizeSameSite(cookie.sameSite)
  };
}

export function loadCookies(cookiesPath) {
  const parsed = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('Cookie file must contain a JSON array');
  }
  return parsed.map(normalizeCookie);
}

export function summarizeCookies(cookies) {
  return {
    count: cookies.length,
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      value: '<redacted>'
    }))
  };
}
```

- [ ] **Step 4: Verify cookie tests pass**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
node --test test/cookies.test.mjs
Pop-Location
```

Expected:

- All `cookies.test.mjs` tests pass.

## Task 4: URL Normalization And Search Page Preview Extraction

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/url.mjs`
- Create: `tmp/linkedin-assisted-collector/src/extract-search.mjs`
- Create: `tmp/linkedin-assisted-collector/test/url.test.mjs`
- Create: `tmp/linkedin-assisted-collector/test/extract-search.test.mjs`
- Create: `tmp/linkedin-assisted-collector/test/fixtures/search-page.html`

- [ ] **Step 1: Create fixture search page**

Create `tmp/linkedin-assisted-collector/test/fixtures/search-page.html`:

```html
<!doctype html>
<html>
  <body>
    <a href="/jobs/view/4400000001/?position=1&refId=abc&trackingId=track">Job 1</a>
    <a href="https://www.linkedin.com/jobs/view/4400000002/?trk=public_jobs">Job 2</a>
    <a href="https://www.linkedin.com/jobs/view/4400000001/?position=2&refId=def">Duplicate Job 1</a>
    <a href="https://www.linkedin.com/company/example">Company</a>
  </body>
</html>
```

- [ ] **Step 2: Write failing URL tests**

Create `tmp/linkedin-assisted-collector/test/url.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLinkedInJobId, normalizeLinkedInJobUrl } from '../src/url.mjs';

test('extractLinkedInJobId reads id from jobs view URL', () => {
  assert.equal(extractLinkedInJobId('https://www.linkedin.com/jobs/view/4400000001/?trk=x'), '4400000001');
});

test('normalizeLinkedInJobUrl removes tracking parameters', () => {
  assert.equal(
    normalizeLinkedInJobUrl('https://www.linkedin.com/jobs/view/4400000001/?position=1&refId=abc&trackingId=track&keep=yes'),
    'https://www.linkedin.com/jobs/view/4400000001/?keep=yes'
  );
});
```

- [ ] **Step 3: Write failing extraction tests**

Create `tmp/linkedin-assisted-collector/test/extract-search.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { extractVisibleJobUrls } from '../src/extract-search.mjs';

test('extractVisibleJobUrls returns deduped LinkedIn job URLs capped by maxJobs', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const html = fs.readFileSync(path.join('test', 'fixtures', 'search-page.html'), 'utf8');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  const urls = await extractVisibleJobUrls(page, {
    baseUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    maxJobs: 25
  });

  await browser.close();

  assert.deepEqual(urls, [
    {
      id: '4400000001',
      originalUrl: 'https://www.linkedin.com/jobs/view/4400000001/?position=1&refId=abc&trackingId=track',
      normalizedUrl: 'https://www.linkedin.com/jobs/view/4400000001/'
    },
    {
      id: '4400000002',
      originalUrl: 'https://www.linkedin.com/jobs/view/4400000002/?trk=public_jobs',
      normalizedUrl: 'https://www.linkedin.com/jobs/view/4400000002/'
    }
  ]);
});
```

- [ ] **Step 4: Implement URL helpers**

Create `tmp/linkedin-assisted-collector/src/url.mjs`:

```js
const TRACKING_PARAMS = new Set(['refId', 'trackingId', 'trk', 'position', 'pageNum']);

export function extractLinkedInJobId(value) {
  try {
    const url = new URL(value, 'https://www.linkedin.com');
    const match = /\/jobs\/view\/(\d+)/.exec(url.pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function normalizeLinkedInJobUrl(value) {
  const url = new URL(value, 'https://www.linkedin.com');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function isLinkedInJobDetailUrl(value) {
  try {
    const url = new URL(value, 'https://www.linkedin.com');
    return url.hostname.endsWith('linkedin.com') && /^\/jobs\/view\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Implement search extraction**

Create `tmp/linkedin-assisted-collector/src/extract-search.mjs`:

```js
import { extractLinkedInJobId, isLinkedInJobDetailUrl, normalizeLinkedInJobUrl } from './url.mjs';

export async function extractVisibleJobUrls(page, { baseUrl, maxJobs }) {
  const hrefs = await page.$$eval('a[href]', (anchors) =>
    anchors.map((anchor) => anchor.getAttribute('href')).filter(Boolean)
  );

  const byNormalizedUrl = new Map();
  for (const href of hrefs) {
    const originalUrl = new URL(href, baseUrl).toString();
    if (!isLinkedInJobDetailUrl(originalUrl)) continue;
    const id = extractLinkedInJobId(originalUrl);
    if (!id) continue;
    const normalizedUrl = normalizeLinkedInJobUrl(originalUrl);
    if (!byNormalizedUrl.has(normalizedUrl)) {
      byNormalizedUrl.set(normalizedUrl, { id, originalUrl, normalizedUrl });
    }
    if (byNormalizedUrl.size >= maxJobs) break;
  }

  return [...byNormalizedUrl.values()];
}
```

- [ ] **Step 6: Verify URL and search extraction tests pass**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
node --test test/url.test.mjs test/extract-search.test.mjs
Pop-Location
```

Expected:

- URL normalization and fixture extraction tests pass without visiting LinkedIn.

## Task 5: Stop Conditions And Job Detail Extraction

## Task 4A: Controlled Left Result-List Scrolling

**Files:**

- Modify: `tmp/linkedin-assisted-collector/src/input.mjs`
- Modify: `tmp/linkedin-assisted-collector/test/input.test.mjs`
- Modify: `tmp/linkedin-assisted-collector/src/extract-search.mjs`
- Modify: `tmp/linkedin-assisted-collector/test/extract-search.test.mjs`
- Create: `tmp/linkedin-assisted-collector/src/result-list-scroll.mjs`
- Create: `tmp/linkedin-assisted-collector/test/result-list-scroll.test.mjs`
- Modify: `tmp/linkedin-assisted-collector/src/main.mjs`

This task upgrades URL preview from initial visible anchors to hard-limited scrolling inside the left-side LinkedIn results list only.

- [ ] **Step 1: Extend input defaults and validation**

Add `resultScroll` to `DEFAULTS` in `src/input.mjs`:

```js
resultScroll: {
  enabled: true,
  maxScrolls: 12,
  pixels: { min: 300, max: 600 },
  waitSeconds: { min: 2, max: 5 },
  stopAfterNoNewRounds: 2
}
```

Add `normalizeResultScroll()`:

```js
function normalizeResultScroll(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    enabled: input.enabled !== false,
    maxScrolls: clampInteger(input.maxScrolls, DEFAULTS.resultScroll.maxScrolls, 0, 12),
    pixels: normalizeRange(input.pixels, DEFAULTS.resultScroll.pixels, {
      minAllowed: 1,
      maxAllowed: 600
    }),
    waitSeconds: normalizeRange(input.waitSeconds, DEFAULTS.resultScroll.waitSeconds, {
      minAllowed: 2,
      maxAllowed: 8
    }),
    stopAfterNoNewRounds: clampInteger(
      input.stopAfterNoNewRounds,
      DEFAULTS.resultScroll.stopAfterNoNewRounds,
      1,
      2
    )
  };
}
```

Return `resultScroll: normalizeResultScroll(input.resultScroll)` from `validateInput`.

- [ ] **Step 2: Add input validation tests**

Add to `test/input.test.mjs`:

```js
test('validateInput applies and clamps result-list scroll limits', () => {
  const input = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    resultScroll: {
      enabled: true,
      maxScrolls: 99,
      pixels: { min: 300, max: 900 },
      waitSeconds: { min: 1, max: 20 },
      stopAfterNoNewRounds: 10
    }
  });

  assert.deepEqual(input.resultScroll, {
    enabled: true,
    maxScrolls: 12,
    pixels: { min: 300, max: 600 },
    waitSeconds: { min: 2, max: 5 },
    stopAfterNoNewRounds: 2
  });
});
```

- [ ] **Step 3: Scope URL extraction to a page or locator**

Keep `extractVisibleJobUrls(scope, options)` generic so `scope` can be either a Playwright `page` or a locator for the result list:

```js
export async function extractVisibleJobUrls(scope, { baseUrl, maxJobs }) {
  const hrefs = await scope.$$eval('a[href]', (anchors) =>
    anchors
      .filter((anchor) => {
        const style = globalThis.getComputedStyle(anchor);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (anchor.hidden || anchor.closest('[hidden], [aria-hidden="true"]')) return false;
        return anchor.getClientRects().length > 0;
      })
      .map((anchor) => anchor.getAttribute('href'))
      .filter(Boolean)
  );
  // Keep existing normalize/dedupe/cap logic.
}
```

- [ ] **Step 4: Create result-list scroll module**

Create `tmp/linkedin-assisted-collector/src/result-list-scroll.mjs`:

```js
import { extractVisibleJobUrls } from './extract-search.mjs';

function defaultRandomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function findResultListScroller(page) {
  const candidates = [
    '.jobs-search-results-list',
    '[aria-label*="Search results"]',
    '[data-view-name*="job-search"]'
  ];

  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      const scrollable = await locator.evaluate((el) => el.scrollHeight > el.clientHeight).catch(() => false);
      if (scrollable) return locator;
    }
  }

  return null;
}

export async function collectJobUrlsWithResultListScroll(
  page,
  { baseUrl, maxJobs, resultScroll, sleep = defaultSleep, randomBetween = defaultRandomBetween }
) {
  const scroller = await findResultListScroller(page);
  if (!scroller) {
    const urls = await extractVisibleJobUrls(page, { baseUrl, maxJobs });
    return {
      urls,
      scrollCount: 0,
      noNewRounds: 0,
      stopReason: urls.length ? 'result_list_not_found_fallback' : 'result_list_not_found'
    };
  }

  const byId = new Map();
  let scrollCount = 0;
  let noNewRounds = 0;

  const collect = async () => {
    const before = byId.size;
    const urls = await extractVisibleJobUrls(scroller, { baseUrl, maxJobs });
    for (const url of urls) {
      if (!byId.has(url.id)) byId.set(url.id, url);
      if (byId.size >= maxJobs) break;
    }
    return byId.size - before;
  };

  await collect();

  if (resultScroll.enabled === false) {
    return { urls: [...byId.values()], scrollCount, noNewRounds, stopReason: 'scroll_disabled' };
  }

  while (byId.size < maxJobs && scrollCount < resultScroll.maxScrolls) {
    const pixels = randomBetween(resultScroll.pixels.min, resultScroll.pixels.max);
    await scroller.evaluate((el, value) => { el.scrollTop += value; }, pixels);
    scrollCount += 1;
    const waitSeconds = randomBetween(resultScroll.waitSeconds.min, resultScroll.waitSeconds.max);
    await sleep(waitSeconds * 1000);
    const added = await collect();
    noNewRounds = added > 0 ? 0 : noNewRounds + 1;
    if (noNewRounds >= resultScroll.stopAfterNoNewRounds) {
      return { urls: [...byId.values()], scrollCount, noNewRounds, stopReason: 'no_new_urls' };
    }
  }

  return {
    urls: [...byId.values()],
    scrollCount,
    noNewRounds,
    stopReason: byId.size >= maxJobs ? 'max_jobs_reached' : 'max_scrolls_reached'
  };
}
```

- [ ] **Step 5: Add result-list scroll fixture test**

Create `tmp/linkedin-assisted-collector/test/result-list-scroll.test.mjs` with a fixture page containing:

- a scrollable `.jobs-search-results-list`
- at least two job links inside it
- one job link outside it
- a tall `body`

Test requirements:

- `findResultListScroller()` returns the `.jobs-search-results-list` element.
- `collectJobUrlsWithResultListScroll()` collects inside-list jobs only.
- `window.scrollY` remains `0` before and after collection.
- `scrollCount` is greater than `0`.
- the outside-list job is not collected.
- collection stops with `no_new_urls`, `max_jobs_reached`, or `max_scrolls_reached`.

- [ ] **Step 6: Wire preview flow through controlled result-list scrolling**

In `src/main.mjs`, replace direct `extractVisibleJobUrls()` preview collection with:

```js
import { collectJobUrlsWithResultListScroll } from './result-list-scroll.mjs';

const preview = await collectJobUrlsWithResultListScroll(session.page, {
  baseUrl: input.searchPageUrl,
  maxJobs: input.maxJobs,
  resultScroll: input.resultScroll
});
const urls = preview.urls;
```

In preview-only mode, print `preview` metadata with URLs:

```js
console.log(JSON.stringify({ previewOnly: true, preview, urls }, null, 2));
```

If zero URLs are found, set `stopReason` to `preview.stopReason || 'no_visible_job_urls'`.

- [ ] **Step 7: Verify no-LinkedIn tests**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm test
Pop-Location
```

Expected:

- All fixture/unit tests pass.
- Tests prove the page does not scroll during URL collection.
- Tests prove collection remains capped at 25.

## Task 4B: Manual Preview Verification With Controlled Result-List Scroll

**Files:**

- Modify only ignored input: `tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.json`
- No tracked project files.
- No project `data/`.

- [ ] **Step 1: Preview with controlled list scroll enabled**

Use the current LinkedIn search page input with:

```json
{
  "maxJobs": 25,
  "dryRun": true,
  "resultScroll": {
    "enabled": true,
    "maxScrolls": 12,
    "pixels": { "min": 300, "max": 600 },
    "waitSeconds": { "min": 2, "max": 5 },
    "stopAfterNoNewRounds": 2
  }
}
```

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm run preview
Pop-Location
```

Expected:

- Headed browser opens the search page.
- Only the left-side results list scrolls.
- The whole page does not scroll for URL discovery.
- The right-side detail pane is not scrolled for URL discovery.
- Preview prints at most 25 normalized job URLs.
- Preview summary includes `scrollCount`, `noNewRounds`, and URL collection `stopReason`.
- The tool does not fetch job details.
- The tool writes no output.

## Task 5: Stop Conditions And Job Detail Extraction

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/stop-conditions.mjs`
- Create: `tmp/linkedin-assisted-collector/src/extract-job.mjs`
- Create: `tmp/linkedin-assisted-collector/test/stop-conditions.test.mjs`
- Create: `tmp/linkedin-assisted-collector/test/extract-job.test.mjs`
- Create: `tmp/linkedin-assisted-collector/test/fixtures/job-detail.html`
- Create: `tmp/linkedin-assisted-collector/test/fixtures/job-detail-missing-company.html`
- Create: `tmp/linkedin-assisted-collector/test/fixtures/login-wall.html`
- Create: `tmp/linkedin-assisted-collector/test/fixtures/security-checkpoint.html`

- [ ] **Step 1: Create fixtures**

Create `tmp/linkedin-assisted-collector/test/fixtures/job-detail.html`:

```html
<!doctype html>
<html>
  <body>
    <h1>Machine Learning Working Student</h1>
    <a href="https://www.linkedin.com/company/example-company/">Example GmbH</a>
    <span class="job-location">Berlin, Germany</span>
    <div id="job-details"><p>Build internal AI tooling.</p></div>
    <a class="apply" href="https://example.com/apply">Apply</a>
  </body>
</html>
```

Create `tmp/linkedin-assisted-collector/test/fixtures/job-detail-missing-company.html`:

```html
<!doctype html>
<html>
  <body>
    <h1>Machine Learning Working Student</h1>
    <div id="job-details"><p>Build internal AI tooling.</p></div>
  </body>
</html>
```

Create `tmp/linkedin-assisted-collector/test/fixtures/login-wall.html`:

```html
<!doctype html>
<html>
  <body>
    <form action="/login"><input name="session_key"></form>
    <h1>Sign in to LinkedIn</h1>
  </body>
</html>
```

Create `tmp/linkedin-assisted-collector/test/fixtures/security-checkpoint.html`:

```html
<!doctype html>
<html>
  <body>
    <h1>Security verification</h1>
    <p>checkpoint required</p>
  </body>
</html>
```

- [ ] **Step 2: Write failing stop condition tests**

Create `tmp/linkedin-assisted-collector/test/stop-conditions.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { detectStopCondition } from '../src/stop-conditions.mjs';

async function withFixture(name, fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(path.join('test', 'fixtures', name), 'utf8'));
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

test('detectStopCondition detects login wall', async () => {
  await withFixture('login-wall.html', async (page) => {
    const stop = await detectStopCondition(page);
    assert.equal(stop.reason, 'login_required');
  });
});

test('detectStopCondition detects security checkpoint', async () => {
  await withFixture('security-checkpoint.html', async (page) => {
    const stop = await detectStopCondition(page);
    assert.equal(stop.reason, 'security_checkpoint');
  });
});

test('detectStopCondition returns null on normal job page', async () => {
  await withFixture('job-detail.html', async (page) => {
    const stop = await detectStopCondition(page);
    assert.equal(stop, null);
  });
});
```

- [ ] **Step 3: Write failing job extraction tests**

Create `tmp/linkedin-assisted-collector/test/extract-job.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { extractJobDetail } from '../src/extract-job.mjs';

test('extractJobDetail returns minimum raw LinkedIn item shape', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(path.join('test', 'fixtures', 'job-detail.html'), 'utf8'));

  const item = await extractJobDetail(page, {
    jobId: '4400000001',
    jobUrl: 'https://www.linkedin.com/jobs/view/4400000001/',
    inputUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai'
  });

  await browser.close();

  assert.equal(item.id, '4400000001');
  assert.equal(item.title, 'Machine Learning Working Student');
  assert.equal(item.companyName, 'Example GmbH');
  assert.equal(item.companyLinkedinUrl, 'https://www.linkedin.com/company/example-company/');
  assert.equal(item.location, 'Berlin, Germany');
  assert.equal(item.descriptionText, 'Build internal AI tooling.');
  assert.equal(item.applyUrl, 'https://example.com/apply');
  assert.equal(item.link, 'https://www.linkedin.com/jobs/view/4400000001/');
  assert.equal(item.inputUrl, 'https://www.linkedin.com/jobs/search/?keywords=ai');
});
```

- [ ] **Step 4: Implement stop detection**

Create `tmp/linkedin-assisted-collector/src/stop-conditions.mjs`:

```js
const STOP_TEXT_PATTERNS = [
  { reason: 'captcha', pattern: /captcha/i },
  { reason: 'security_checkpoint', pattern: /security verification|checkpoint|verify your identity/i },
  { reason: 'access_restricted', pattern: /access restricted|rate limit|temporarily restricted/i }
];

export async function detectStopCondition(page) {
  const url = page.url();
  if (/\/login|\/checkpoint|\/uas\/login/.test(url)) {
    return { reason: 'login_required', url };
  }

  const hasLoginForm = await page.locator('input[name="session_key"], form[action*="login"]').count();
  if (hasLoginForm > 0) {
    return { reason: 'login_required', url };
  }

  const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  for (const { reason, pattern } of STOP_TEXT_PATTERNS) {
    if (pattern.test(bodyText)) return { reason, url };
  }

  return null;
}
```

- [ ] **Step 5: Implement job extraction**

Create `tmp/linkedin-assisted-collector/src/extract-job.mjs`:

```js
async function firstText(page, selectors) {
  for (const selector of selectors) {
    const value = await page.locator(selector).first().innerText({ timeout: 1000 }).catch(() => '');
    if (value.trim()) return value.trim();
  }
  return '';
}

async function firstHtml(page, selectors) {
  for (const selector of selectors) {
    const value = await page.locator(selector).first().innerHTML({ timeout: 1000 }).catch(() => '');
    if (value.trim()) return value.trim();
  }
  return '';
}

async function firstHref(page, selectors) {
  for (const selector of selectors) {
    const value = await page.locator(selector).first().getAttribute('href', { timeout: 1000 }).catch(() => '');
    if (value?.trim()) return value.trim();
  }
  return '';
}

export async function extractJobDetail(page, { jobId, jobUrl, inputUrl }) {
  const title = await firstText(page, ['h1', '.top-card-layout__title', '.job-details-jobs-unified-top-card__job-title']);
  const companyName = await firstText(page, [
    'a[href*="/company/"]',
    '.topcard__org-name-link',
    '.job-details-jobs-unified-top-card__company-name'
  ]);
  const companyLinkedinUrl = await firstHref(page, ['a[href*="/company/"]']);
  const location = await firstText(page, ['.job-location', '.topcard__flavor--bullet', '.job-details-jobs-unified-top-card__bullet']);
  const descriptionText = await firstText(page, ['#job-details', '.description__text', '.jobs-description']);
  const descriptionHtml = await firstHtml(page, ['#job-details', '.description__text', '.jobs-description']);
  const applyUrl = await firstHref(page, ['a.apply', 'a[href*="/jobs/apply/"]', 'a[href*="apply"]']);

  return {
    id: jobId,
    title,
    companyName,
    companyLinkedinUrl: companyLinkedinUrl || undefined,
    location,
    descriptionText,
    descriptionHtml: descriptionHtml || undefined,
    link: jobUrl,
    applyUrl: applyUrl || undefined,
    applyMethod: applyUrl ? 'external' : undefined,
    inputUrl
  };
}

export function hasMinimumJobFields(item) {
  return Boolean(item.id && item.title && item.companyName && item.location && item.descriptionText && item.link && item.inputUrl);
}
```

- [ ] **Step 6: Verify stop and extraction tests pass**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
node --test test/stop-conditions.test.mjs test/extract-job.test.mjs
Pop-Location
```

Expected:

- Stop detection and fixture extraction tests pass without visiting LinkedIn.

## Task 6: Batch Runner With Random Delays, Cooldowns, And Stop-On-Anomaly

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/batch-runner.mjs`
- Create: `tmp/linkedin-assisted-collector/test/batch-runner.test.mjs`

- [ ] **Step 1: Write failing batch runner tests**

Create `tmp/linkedin-assisted-collector/test/batch-runner.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { runBatches } from '../src/batch-runner.mjs';

test('runBatches processes max 25 jobs in batches of 5', async () => {
  const urls = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), normalizedUrl: `https://www.linkedin.com/jobs/view/${index + 1}/` }));
  const delays = [];
  const result = await runBatches({
    urls,
    input: {
      maxJobs: 25,
      batchSize: 5,
      jobDelaySeconds: { min: 8, max: 25 },
      batchCooldownMinutes: { min: 2, max: 6 }
    },
    processJob: async (job) => ({ ok: true, item: { id: job.id } }),
    sleep: async (milliseconds) => delays.push(milliseconds),
    randomBetween: (min) => min
  });

  assert.equal(result.processedCount, 25);
  assert.equal(result.successCount, 25);
  assert.equal(result.stopReason, 'max_jobs_reached');
  assert.equal(result.items.length, 25);
  assert.ok(delays.length > 0);
});

test('runBatches stops on first anomaly', async () => {
  const urls = [
    { id: '1', normalizedUrl: 'https://www.linkedin.com/jobs/view/1/' },
    { id: '2', normalizedUrl: 'https://www.linkedin.com/jobs/view/2/' }
  ];

  const result = await runBatches({
    urls,
    input: {
      maxJobs: 25,
      batchSize: 5,
      jobDelaySeconds: { min: 8, max: 25 },
      batchCooldownMinutes: { min: 2, max: 6 }
    },
    processJob: async (job) => job.id === '1'
      ? { ok: true, item: { id: '1' } }
      : { ok: false, stopReason: 'login_required', error: 'login wall' },
    sleep: async () => {},
    randomBetween: (min) => min
  });

  assert.equal(result.processedCount, 2);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 1);
  assert.equal(result.stopReason, 'login_required');
});
```

- [ ] **Step 2: Implement batch runner**

Create `tmp/linkedin-assisted-collector/src/batch-runner.mjs`:

```js
function defaultRandomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runBatches({
  urls,
  input,
  processJob,
  sleep = defaultSleep,
  randomBetween = defaultRandomBetween
}) {
  const cappedUrls = urls.slice(0, input.maxJobs);
  const items = [];
  const failures = [];
  let processedCount = 0;
  let batchCount = 0;
  let stopReason = null;

  for (let offset = 0; offset < cappedUrls.length; offset += input.batchSize) {
    batchCount += 1;
    if (batchCount > 5) {
      stopReason = 'max_batches_reached';
      break;
    }

    const batch = cappedUrls.slice(offset, offset + input.batchSize);
    for (const job of batch) {
      const result = await processJob(job);
      processedCount += 1;

      if (result.ok) {
        items.push(result.item);
      } else {
        failures.push({ job, reason: result.stopReason, error: result.error });
        stopReason = result.stopReason || 'job_failed';
        return {
          processedCount,
          successCount: items.length,
          failureCount: failures.length,
          batchCount,
          stopReason,
          items,
          failures
        };
      }

      if (processedCount < cappedUrls.length) {
        const seconds = randomBetween(input.jobDelaySeconds.min, input.jobDelaySeconds.max);
        await sleep(seconds * 1000);
      }
    }

    if (processedCount < cappedUrls.length) {
      const minutes = randomBetween(input.batchCooldownMinutes.min, input.batchCooldownMinutes.max);
      await sleep(minutes * 60 * 1000);
    }
  }

  if (!stopReason && processedCount >= input.maxJobs) stopReason = 'max_jobs_reached';
  if (!stopReason) stopReason = 'completed';

  return {
    processedCount,
    successCount: items.length,
    failureCount: failures.length,
    batchCount,
    stopReason,
    items,
    failures
  };
}
```

- [ ] **Step 3: Verify batch tests pass**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
node --test test/batch-runner.test.mjs
Pop-Location
```

Expected:

- Batch cap, job cap, delay hooks, and anomaly stop behavior pass.

## Task 7: Browser Context And Auth State Setup

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/browser.mjs`

- [ ] **Step 1: Implement browser context factory**

Create `tmp/linkedin-assisted-collector/src/browser.mjs`:

```js
import { chromium } from 'playwright';
import { loadCookies, summarizeCookies } from './cookies.mjs';

export async function createBrowserSession(input, logger = console) {
  const cookies = loadCookies(input.cookiesPath);
  logger.info('Loaded cookies', summarizeCookies(cookies));

  const browser = await chromium.launch({ headless: !input.headed });
  const context = await browser.newContext({
    userAgent: input.userAgent,
    viewport: { width: 1365, height: 900 },
    locale: 'en-US',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    async close() {
      await browser.close();
    }
  };
}
```

- [ ] **Step 2: Run no-network context smoke check with fake cookies**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
@'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrowserSession } from './src/browser.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-browser-'));
const cookiesPath = path.join(dir, 'cookies.json');
fs.writeFileSync(cookiesPath, JSON.stringify([{ name: 'li_at', value: 'fake', domain: '.linkedin.com', secure: true, sameSite: 'no_restriction' }]));

const session = await createBrowserSession({
  cookiesPath,
  userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
  headed: false
}, { info() {} });
const state = await session.context.storageState();
await session.close();
console.log(JSON.stringify({ cookieCount: state.cookies.length, didNetworkRequest: false }));
'@ | node --input-type=module
Pop-Location
```

Expected:

- Prints `{"cookieCount":1,"didNetworkRequest":false}` or equivalent JSON.
- No LinkedIn page is opened.

## Task 8: Output Writer For Dry-Run And Explicit Local Files

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/output.mjs`
- Create: `tmp/linkedin-assisted-collector/test/output.test.mjs`

- [ ] **Step 1: Write failing output test**

Create `tmp/linkedin-assisted-collector/test/output.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRunSummary, writeLocalRawOutput } from '../src/output.mjs';

test('buildRunSummary redacts sensitive paths and records stop reason', () => {
  const summary = buildRunSummary({
    input: {
      searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
      maxJobs: 25,
      batchSize: 5,
      dryRun: true
    },
    result: {
      processedCount: 2,
      successCount: 1,
      failureCount: 1,
      stopReason: 'login_required',
      failures: [{ reason: 'login_required' }]
    },
    wroteData: false
  });

  assert.equal(summary.cookiesPath, '<redacted>');
  assert.equal(summary.stopReason, 'login_required');
  assert.equal(summary.wroteData, false);
});

test('writeLocalRawOutput writes local assisted raw file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-output-'));
  const file = writeLocalRawOutput({
    outputDir: dir,
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    items: [{ id: '4400000001', title: 'Role' }],
    now: new Date('2026-05-07T12:00:00.000Z')
  });

  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.source, 'linkedin');
  assert.equal(written.taskName, 'local-linkedin-assisted-collector');
  assert.equal(written.runStatus, 'LOCAL_ASSISTED');
  assert.equal(written.count, 1);
  assert.equal(written.items[0].id, '4400000001');
});
```

- [ ] **Step 2: Implement output support**

Create `tmp/linkedin-assisted-collector/src/output.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

function timestampForFile(now) {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

export function buildRunSummary({ input, result, wroteData }) {
  return {
    searchPageUrl: input.searchPageUrl,
    cookiesPath: '<redacted>',
    maxJobs: input.maxJobs,
    batchSize: input.batchSize,
    dryRun: input.dryRun,
    processedCount: result.processedCount,
    successCount: result.successCount,
    failureCount: result.failureCount,
    stopReason: result.stopReason,
    failures: result.failures ?? [],
    wroteData
  };
}

export function writeLocalRawOutput({ outputDir, searchPageUrl, items, now = new Date() }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const savedAt = now.toISOString();
  const file = path.join(outputDir, `linkedin-local-${timestampForFile(now)}.json`);
  fs.writeFileSync(file, `${JSON.stringify({
    source: 'linkedin',
    taskName: 'local-linkedin-assisted-collector',
    runStatus: 'LOCAL_ASSISTED',
    savedAt,
    searchPageUrl,
    count: items.length,
    items
  }, null, 2)}\n`, 'utf8');
  return file;
}
```

- [ ] **Step 3: Verify output tests pass**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
node --test test/output.test.mjs
Pop-Location
```

Expected:

- Summary redaction and raw output file shape tests pass.

## Task 9: Main CLI With Preview Confirmation

**Files:**

- Create: `tmp/linkedin-assisted-collector/src/main.mjs`

- [ ] **Step 1: Implement CLI orchestration**

Create `tmp/linkedin-assisted-collector/src/main.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as inputStream, stdout as outputStream } from 'node:process';
import { runBatches } from './batch-runner.mjs';
import { createBrowserSession } from './browser.mjs';
import { detectStopCondition } from './stop-conditions.mjs';
import { extractJobDetail, hasMinimumJobFields } from './extract-job.mjs';
import { extractVisibleJobUrls } from './extract-search.mjs';
import { validateInput } from './input.mjs';
import { buildRunSummary, writeLocalRawOutput } from './output.mjs';

function readInputFile() {
  const inputPath = path.join('storage', 'key_value_stores', 'default', 'INPUT.json');
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing input file: ${inputPath}. Copy INPUT.example.json to INPUT.json and edit it.`);
  }
  return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}

async function askForConfirmation(urls) {
  console.log(`Preview found ${urls.length} job URLs:`);
  for (const [index, job] of urls.entries()) {
    console.log(`${index + 1}. ${job.normalizedUrl}`);
  }

  const rl = readline.createInterface({ input: inputStream, output: outputStream });
  try {
    const answer = await rl.question('Process these URLs? Type YES to continue: ');
    return answer.trim() === 'YES';
  } finally {
    rl.close();
  }
}

async function processOneJob(page, input, job) {
  try {
    await page.goto(job.normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const stop = await detectStopCondition(page);
    if (stop) return { ok: false, stopReason: stop.reason, error: stop.url };

    const item = await extractJobDetail(page, {
      jobId: job.id,
      jobUrl: job.normalizedUrl,
      inputUrl: input.searchPageUrl
    });
    if (!hasMinimumJobFields(item)) {
      return { ok: false, stopReason: 'minimum_fields_missing', error: job.normalizedUrl };
    }
    return { ok: true, item };
  } catch (error) {
    return { ok: false, stopReason: 'navigation_or_extraction_failed', error: error.message };
  }
}

async function main() {
  const previewOnly = process.argv.includes('--preview-only');
  const rawInput = readInputFile();
  const input = validateInput({ ...rawInput, rootDir: path.resolve('../..') });
  const session = await createBrowserSession(input);
  let wroteData = false;
  let result = {
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    stopReason: 'preview_only',
    failures: [],
    items: []
  };

  try {
    await session.page.goto(input.searchPageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const searchStop = await detectStopCondition(session.page);
    if (searchStop) {
      result = { ...result, stopReason: searchStop.reason, failures: [{ reason: searchStop.reason, url: searchStop.url }] };
      return;
    }

    const urls = await extractVisibleJobUrls(session.page, {
      baseUrl: input.searchPageUrl,
      maxJobs: input.maxJobs
    });
    if (urls.length === 0) {
      result = { ...result, stopReason: 'no_visible_job_urls' };
      return;
    }

    if (previewOnly) {
      console.log(JSON.stringify({ previewOnly: true, urls }, null, 2));
      return;
    }

    const confirmed = await askForConfirmation(urls);
    if (!confirmed) {
      result = { ...result, stopReason: 'user_declined_preview' };
      return;
    }

    result = await runBatches({
      urls,
      input,
      processJob: (job) => processOneJob(session.page, input, job)
    });

    if (!input.dryRun && result.items.length > 0) {
      const file = writeLocalRawOutput({
        outputDir: path.join('output'),
        searchPageUrl: input.searchPageUrl,
        items: result.items
      });
      wroteData = true;
      console.log(`Wrote local raw output: ${file}`);
    }
  } finally {
    await session.close();
    console.log(JSON.stringify(buildRunSummary({ input, result, wroteData }), null, 2));
  }
}

await main();
```

- [ ] **Step 2: Run all no-LinkedIn tests**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm test
Pop-Location
```

Expected:

- All fixture and unit tests pass.

## Task 10: Manual Verification Gates

**Files:**

- Modify only local ignored file: `tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.json`
- No tracked project files changed.
- No project `data/` writes during dry-run verification.

- [ ] **Step 1: Prepare local input from example**

Run:

```powershell
Copy-Item `
  -LiteralPath 'tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.example.json' `
  -Destination 'tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.json'
```

Edit only `tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.json` with:

- The one LinkedIn search page URL provided by the user.
- The absolute cookie JSON path outside the repo.
- The exact browser User-Agent.
- `dryRun: true`.
- `maxJobs: 25`.
- `batchSize: 5`.

- [ ] **Step 2: Preview URLs only**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm run preview
Pop-Location
```

Expected:

- Headed browser opens the provided search page.
- Tool prints at most 25 normalized job URLs.
- Tool does not fetch job detail pages.
- Tool does not write output files.
- If login, checkpoint, CAPTCHA, or access restriction appears, the run stops and prints a stop reason.

- [ ] **Step 3: One-job dry-run**

Temporarily set `maxJobs` to `1` in `INPUT.json`.

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm start
Pop-Location
```

Expected:

- Tool previews URLs.
- User types `YES`.
- Tool processes one job detail page.
- Tool prints a run summary.
- `wroteData` is `false`.
- `output/` is absent or empty.

- [ ] **Step 4: One-batch dry-run**

Set `maxJobs` to `5` and keep `dryRun: true`.

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm start
Pop-Location
```

Expected:

- Tool processes up to one batch of 5 jobs.
- Random 8-25 second delays occur between job detail pages.
- Any anomaly stops the run.
- `wroteData` is `false`.

- [ ] **Step 5: Full-page dry-run**

Set `maxJobs` to `25`, keep `batchSize` as `5`, and keep `dryRun: true`.

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm start
Pop-Location
```

Expected:

- Tool processes at most 5 batches and 25 jobs.
- Random 2-6 minute cooldowns occur between successful batches.
- Any anomaly stops the run.
- `wroteData` is `false`.

## Task 11: Optional Local Output After Dry-Run Approval

**Files:**

- Modify only local ignored file: `tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.json`
- Create only ignored output: `tmp/linkedin-assisted-collector/output/linkedin-local-YYYY-MM-DD-HHMMSS.json`

- [ ] **Step 1: Enable local PoC output**

Set `dryRun` to `false` in `tmp/linkedin-assisted-collector/storage/key_value_stores/default/INPUT.json`.

- [ ] **Step 2: Run one-batch persisted output**

Set `maxJobs` to `5`.

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
npm start
Pop-Location
```

Expected:

- Tool processes at most 5 jobs.
- Output is written only under `tmp/linkedin-assisted-collector/output/`.
- No root `data/` files are created or modified.

- [ ] **Step 3: Inspect output shape locally**

Run:

```powershell
Push-Location tmp/linkedin-assisted-collector
Get-ChildItem -LiteralPath output -Filter '*.json' | Sort-Object LastWriteTime | Select-Object -Last 1 | ForEach-Object {
  $json = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
  [PSCustomObject]@{
    source = $json.source
    taskName = $json.taskName
    runStatus = $json.runStatus
    count = $json.count
    firstId = $json.items[0].id
    firstTitle = $json.items[0].title
  }
}
Pop-Location
```

Expected:

- `source` is `linkedin`.
- `taskName` is `local-linkedin-assisted-collector`.
- `runStatus` is `LOCAL_ASSISTED`.
- `count` is between 1 and 5.
- `firstId` and `firstTitle` are non-empty.

## Task 12: Integration Decision Gate

Do not implement this task until the user explicitly approves promotion from isolated PoC into the project workflow.

Allowed promotion options:

1. Keep the tool outside tracked project code and manually copy vetted output into existing import paths.
2. Add a tracked script under `scripts/local-linkedin-assisted-collector/`.
3. Add a command in root `package.json`.
4. Add a canonical merge source path for `data/raw/linkedin-local-YYYY-MM-DD-HHMMSS.json`.

Recommendation after successful PoC:

- Promote only the minimal reusable pieces:
  - cookie normalization
  - URL normalization
  - output shape validation
- Keep browser automation and cookies outside normal project automation.
- Use `data/raw/linkedin-local-YYYY-MM-DD-HHMMSS.json` rather than `data/manual/linkedin-YYYY-MM-DD.json` for auditable run metadata.

## Final Verification Checklist

Before calling the implementation complete:

- [ ] `Push-Location tmp/linkedin-assisted-collector; npm test; Pop-Location` passes.
- [ ] `git status --short` shows no unexpected changes outside `tmp/` and the approved docs file.
- [ ] Preview-only mode prints at most 25 URLs and writes no files.
- [ ] One-job dry-run processes at most one job and writes no output.
- [ ] One-batch dry-run processes at most five jobs and writes no output.
- [ ] Full dry-run stops at 25 jobs or earlier on anomaly.
- [ ] Persisted PoC output, if enabled, writes only under `tmp/linkedin-assisted-collector/output/`.
- [ ] Cookie values never appear in terminal output, logs, summaries, or output JSON.
- [ ] Login, checkpoint, CAPTCHA, access restriction, and verification pages stop the run immediately.
- [ ] No root project code or runtime data is modified during PoC implementation.

## Self-Review

Spec coverage:

- Local-only execution is implemented by the ignored `tmp/` scaffold.
- Cookie and User-Agent handling are covered by Tasks 2, 3, and 7.
- Search page URL preview is covered by Tasks 4 and 9.
- One upfront confirmation is covered by Task 9.
- Batch size, max jobs, random job delays, random batch cooldowns, and automatic continuation are covered by Task 6.
- Stop conditions are covered by Task 5 and exercised in Task 10.
- Raw output shape and dry-run behavior are covered by Task 8 and Task 11.
- No writes to existing assets are enforced by file placement and the final verification checklist.

Placeholder scan:

- This plan contains concrete file paths, commands, expected outcomes, and code snippets for each implementation task.
- There are no unresolved implementation markers.

Type and naming consistency:

- `validateInput`, `loadCookies`, `extractVisibleJobUrls`, `detectStopCondition`, `extractJobDetail`, `hasMinimumJobFields`, `runBatches`, `createBrowserSession`, `buildRunSummary`, and `writeLocalRawOutput` are defined before use.
- Raw item fields match the existing LinkedIn adapter's expected names: `id`, `title`, `companyName`, `location`, `descriptionText`, `descriptionHtml`, `link`, `applyUrl`, and `inputUrl`.
