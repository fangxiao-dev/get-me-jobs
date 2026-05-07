# Local LinkedIn Assisted Collector Design

## Goal

Build a local, explicit, low-frequency LinkedIn job collection helper for personal use.

The tool helps convert jobs visible from one user-provided LinkedIn search results page into the project's existing job data shape. It is not a background scraper, not a cloud Actor, and not an automated LinkedIn search crawler.

## Compliance And Account-Risk Boundary

LinkedIn's published rules prohibit unauthorized automation, scraping, crawlers, browser extensions, and other tools that copy or automate activity on LinkedIn services. This design does not remove that risk. It only limits blast radius by keeping the workflow local, explicit, low-frequency, and stop-on-anomaly.

Relevant LinkedIn references:

- https://www.linkedin.com/legal/user-agreement
- https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions
- https://www.linkedin.com/help/linkedin/answer/a1340567/automated-activity-on-linkedin
- https://www.linkedin.com/legal/crawling-terms

This tool must never claim to be safe, compliant, or undetectable. It should describe itself as a local assisted collection helper.

## Operating Model

The user provides exactly one LinkedIn search page URL per run.

The tool loads local browser authentication state, opens the provided search page, performs controlled scrolling only inside the left-side job results list, extracts job detail URLs from that list, asks for one upfront confirmation, and then processes the confirmed URLs in batches.

Target flow:

```text
User provides 1 LinkedIn search page URL
-> tool loads local cookies + matching User-Agent
-> tool opens the search page in a headed local browser
-> tool identifies the left-side job results scroll container
-> tool lightly scrolls only that results container until it has up to 25 job URLs or reaches a stop rule
-> tool shows URL preview and asks for one confirmation
-> tool processes batch 1, max 5 jobs
-> if any stop condition occurs, stop immediately
-> if no stop condition occurs, wait a random cooldown
-> tool processes batch 2, max 5 jobs
-> repeat until max 5 batches / max 25 jobs
-> write raw results only after successful extraction
```

If the user wants another page, they start a new run and provide the next search page URL manually.

## Non-Goals

- Do not run in Apify cloud with LinkedIn login cookies.
- Do not store account password or automate username/password login.
- Do not automatically search LinkedIn.
- Do not automatically paginate to the next search page.
- Do not scroll indefinitely to load more results.
- Do not scroll the whole page to discover more results.
- Do not scroll the right-side job detail panel as part of URL discovery.
- Do not discover or enqueue more pages from LinkedIn.
- Do not auto-retry failed jobs aggressively.
- Do not bypass CAPTCHA, checkpoint, or security verification.
- Do not use proxy rotation with a logged-in LinkedIn session.
- Do not perform account-mutating actions such as apply, save, follow, message, react, or connect.

## Inputs

Required input:

```json
{
  "searchPageUrl": "https://www.linkedin.com/jobs/search/...",
  "cookiesPath": "C:/Users/Xiao/secure/linkedin-cookies.json",
  "userAgent": "Mozilla/5.0 ... Chrome/... Safari/537.36"
}
```

Optional input:

```json
{
  "maxJobs": 25,
  "batchSize": 5,
  "jobDelaySeconds": { "min": 8, "max": 25 },
  "batchCooldownMinutes": { "min": 2, "max": 6 },
  "resultScroll": {
    "enabled": true,
    "maxScrolls": 12,
    "pixels": { "min": 300, "max": 600 },
    "waitSeconds": { "min": 2, "max": 5 },
    "stopAfterNoNewRounds": 2
  },
  "dryRun": true,
  "headed": true
}
```

Defaults:

- `maxJobs`: 25
- `batchSize`: 5
- `dryRun`: true for first validation runs
- `headed`: true
- `jobDelaySeconds`: random 8-25 seconds between job detail pages
- `batchCooldownMinutes`: random 2-6 minutes between successful batches
- `resultScroll.enabled`: true
- `resultScroll.maxScrolls`: 12
- `resultScroll.pixels`: random 300-600 px per local list scroll
- `resultScroll.waitSeconds`: random 2-5 seconds after each local list scroll
- `resultScroll.stopAfterNoNewRounds`: 2

Hard limits:

- `maxJobs` cannot exceed 25 for one search page run.
- `batchSize` cannot exceed 5.
- `resultScroll.maxScrolls` cannot exceed 12.
- `resultScroll.pixels.max` cannot exceed 600.
- `resultScroll.waitSeconds.min` cannot be less than 2.
- `resultScroll.waitSeconds.max` cannot exceed 8.
- No auto-continuation to another search page.

## Authentication Handling

The tool uses browser cookies exported by the user, not account credentials.

Rules:

- Cookie file path must be outside the repository by default.
- Cookie values must never be printed to logs.
- Logs may print cookie count, domains, and cookie names only if values are redacted.
- User-Agent must be copied from the same browser session used to export cookies.
- The tool must run on the same local machine and same normal network/IP used for the browser login.
- If cookies fail, expire, or redirect to login, the tool stops.

Cookie normalization must support common Cookie-Editor style JSON fields:

- `name`
- `value`
- `domain`
- `path`
- `expirationDate`
- `secure`
- `httpOnly`
- `sameSite`

For Playwright, normalize `sameSite` to `Lax`, `Strict`, or `None`, and map `expirationDate` to `expires`.

## Search Page URL Extraction

The search page step extracts job detail URLs from the current search page's left-side job results list. It may perform controlled local scrolling inside that list to reveal more current-page results, but it must not paginate, search, change filters, refresh, or scroll unrelated page regions.

Allowed:

- Open the user-provided search page.
- Wait for normal page load.
- Identify the left-side job results scroll container.
- Extract anchors inside that results container that resolve to LinkedIn job detail URLs.
- Scroll only that results container in small random increments.
- Wait a short random interval after each list scroll.
- Normalize and dedupe URLs.
- Cap the preview list at 25.
- Stop URL collection after 2 consecutive scroll rounds add no new job URLs.
- Stop URL collection after at most 12 list scrolls.
- Ask the user for one confirmation before detail extraction.

Not allowed:

- Automatically click next page.
- Automatically change filters.
- Automatically search.
- Infinite scroll.
- Whole-page scrolling for discovery.
- Right-side detail panel scrolling for discovery.
- Repeated refresh to obtain different results.
- Background polling.

Result-list scroll behavior:

```text
collect initial job URLs from left results list
while url count < maxJobs:
  if scroll count >= 12:
    stop URL collection
  scroll only the left results list by random 300-600 px
  wait random 2-5 seconds
  collect job URLs from the left results list again
  if no new URLs were added:
    increment no-new counter
  else:
    reset no-new counter
  if no-new counter reaches 2:
    stop URL collection
```

If the tool cannot confidently identify the left-side results list, it must fall back to initial visible URL extraction and report `result_list_not_found` in the preview summary. It must not guess by scrolling the whole page.

URL normalization:

- Keep source job ID when present.
- Remove tracking-only parameters such as `refId`, `trackingId`, `trk`, `position`, and `pageNum` when producing dedupe keys.
- Preserve the original URL in raw output for debugging.

## Batch Execution

After URL preview confirmation, process jobs in batches.

Batch rules:

- Up to 5 jobs per batch.
- Up to 5 batches per run.
- Up to 25 jobs total.
- Random delay between each job detail page.
- Random cooldown after each fully successful batch.
- If a stop condition occurs, do not process the remaining jobs.

The simplified continuation rule is:

```text
after each batch:
  if there are anomalies:
    stop
  else if there are remaining jobs:
    wait random cooldown
    continue automatically
  else:
    finish
```

## Stop Conditions

The tool must stop immediately when any of these conditions occurs:

- Redirected to login.
- CAPTCHA or checkpoint appears.
- Security verification appears.
- Access restricted or rate-limit style message appears.
- LinkedIn blocks the page or shows unexpected auth wall.
- Browser context loses authenticated state.
- URL collection cannot identify a safe left-side result container and no initial visible job URLs are found.
- A job detail URL redirects outside expected LinkedIn job pages.
- Two consecutive job pages fail to extract a title and company.
- Two consecutive navigation failures occur.
- Any page asks for account verification.
- Total processed jobs reaches 25.
- Total batches reaches 5.
- User aborts.

On stop, the tool writes a run summary with:

- processed count
- preview URL count
- result-list scroll count
- result-list no-new rounds
- success count
- failure count
- last processed URL
- stop reason
- whether any data was written

## Output Shape

The extracted raw item should match the fields expected by the existing LinkedIn adapter in `scripts/lib/adapt-linkedin.mjs`.

Target raw item:

```json
{
  "id": "linkedin-job-id",
  "title": "Job title",
  "companyName": "Company",
  "companyLinkedinUrl": "https://www.linkedin.com/company/...",
  "companyLogo": "https://...",
  "location": "City, State, Country",
  "country": "Germany",
  "workplaceTypes": ["HYBRID"],
  "descriptionText": "Plain text description",
  "descriptionHtml": "<div>...</div>",
  "link": "https://www.linkedin.com/jobs/view/...",
  "applyUrl": "https://...",
  "applyMethod": "external",
  "postedAt": "2026-05-07T00:00:00.000Z",
  "inputUrl": "original search page URL"
}
```

Minimum viable raw fields:

- `id`
- `title`
- `companyName`
- `location`
- `descriptionText`
- `link`
- `inputUrl`

If `id` cannot be extracted from the URL or page, the item should be marked failed rather than inventing an unstable ID.

## Storage Strategy

Initial PoC:

- Use `dryRun: true`.
- Print a redacted summary.
- Write output to a temporary, ignored directory only if explicitly enabled.

After validation:

- Write raw successful items to `data/manual/linkedin-YYYY-MM-DD.json` or a new local raw source file under `data/raw/`.
- Preserve run metadata:
  - source: `linkedin`
  - taskName: `local-linkedin-assisted-collector`
  - runStatus: `LOCAL_ASSISTED`
  - savedAt
  - count
  - searchPageUrl
  - batchSize
  - maxJobs

Preferred integration:

```text
local assisted raw items
-> existing LinkedIn adapter
-> canonical merge
-> selected jobs
-> Review UI / Dashboard
```

## Implementation Architecture

Recommended modules for a future implementation:

```text
local-linkedin-assisted-collector/
  input.mjs              validates input and hard limits
  cookies.mjs            loads and normalizes exported cookies
  browser.mjs            creates headed Playwright context with UA/cookies
  extract-search.mjs     extracts visible job detail URLs
  result-list-scroll.mjs scrolls only the left-side results list under hard limits
  extract-job.mjs        extracts one job detail page
  batch-runner.mjs       enforces batch size, delays, cooldowns, stop rules
  output.mjs             writes raw local results and run summaries
```

Keep this isolated from the existing production scripts until the PoC is accepted.

## Verification Plan

No-LinkedIn local checks:

- Cookie normalization unit test with fake Cookie-Editor JSON.
- User-Agent context creation test.
- Batch runner test proving max 25 jobs and max 5 per batch.
- Result-list scroll test proving only the chosen container scrolls, never the page.
- Result-list scroll test proving max 12 scrolls, 300-600 px increments, and 2 no-new rounds stop collection.
- Stop condition test for simulated login redirect.
- Output shape test against the minimum raw LinkedIn fields.

Manual headed PoC:

1. Run with `dryRun: true`.
2. Use one search page URL.
3. Extract URL preview only with `resultScroll.enabled: false`.
4. Extract URL preview only with controlled left-list scrolling enabled.
5. Confirm that only the left result list scrolls in the headed browser.
6. Confirm that no details are fetched before user confirmation.
7. Process 1 job.
8. Process 1 batch of 5 jobs.
9. Only then allow a full 25-job run.

## Open Decisions

- Whether final persisted output should use `data/manual/linkedin-YYYY-MM-DD.json` or a new `data/raw/linkedin-local-YYYY-MM-DD-HHMMSS.json` source.
- Whether the first implementation should live in a temporary external directory or in a repo-local ignored sandbox.
- Whether the UI should be CLI-only or expose a small local browser control page for confirmation.

Recommendation:

- Start outside the repo or under an ignored `tmp-` directory.
- Keep the first version CLI-only.
- Persist to `data/raw/linkedin-local-YYYY-MM-DD-HHMMSS.json` only after dry-run validation, so the canonical merge path remains clean and auditable.
