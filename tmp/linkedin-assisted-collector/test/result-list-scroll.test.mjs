import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { collectJobUrlsWithResultListScroll } from '../src/result-list-scroll.mjs';

async function withPage(html, callback) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await callback(page);
  } finally {
    await browser.close();
  }
}

function scrollFixture() {
  return `<!doctype html>
    <html>
      <head>
        <style>
          body { margin: 0; min-height: 2200px; }
          .hero { height: 500px; }
          .layout { display: flex; gap: 24px; }
          .jobs-search-results-list {
            width: 420px;
            height: 180px;
            overflow-y: auto;
            border: 1px solid #ccc;
          }
          .job-row { height: 90px; display: block; }
          .detail-panel {
            width: 620px;
            height: 500px;
            overflow-y: auto;
          }
        </style>
      </head>
      <body>
        <div class="hero"></div>
        <div class="layout">
          <div class="jobs-search-results-list" data-testid="results">
            <a class="job-row" href="/jobs/view/4400000001/?position=1">Job 1</a>
            <a class="job-row" href="/jobs/view/4400000002/?position=2">Job 2</a>
            <div style="height: 900px"></div>
          </div>
          <div class="detail-panel">
            <a href="/jobs/view/4499999999/">Right panel job should be ignored</a>
            <div style="height: 1500px"></div>
          </div>
        </div>
        <script>
          const list = document.querySelector('[data-testid="results"]');
          let added = false;
          list.addEventListener('scroll', () => {
            if (added || list.scrollTop < 300) return;
            added = true;
            for (const id of ['4400000003', '4400000004']) {
              const anchor = document.createElement('a');
              anchor.className = 'job-row';
              anchor.href = '/jobs/view/' + id + '/?trackingId=track';
              anchor.textContent = 'Job ' + id;
              list.append(anchor);
            }
          });
        </script>
      </body>
    </html>`;
}

test('collectJobUrlsWithResultListScroll scrolls only the left results list and keeps window scrollY unchanged', async () => {
  const result = await withPage(scrollFixture(), async (page) => {
    await page.evaluate(() => window.scrollTo(0, 240));

    return collectJobUrlsWithResultListScroll(page, {
      baseUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      maxJobs: 4,
      resultScroll: {
        enabled: true,
        maxScrolls: 3,
        pixels: { min: 320, max: 320 },
        waitSeconds: { min: 2, max: 2 },
        stopAfterNoNewRounds: 2
      },
      sleep: async () => {},
      randomBetween: (min) => min
    });
  });

  assert.equal(result.reason, 'max_jobs_reached');
  assert.equal(result.metrics.windowScrollYBefore, 240);
  assert.equal(result.metrics.windowScrollYAfter, 240);
  assert.equal(result.metrics.scrollCount, 1);
  assert.equal(result.metrics.resultListFound, true);
  assert.deepEqual(
    result.urls.map((job) => job.id),
    ['4400000001', '4400000002', '4400000003', '4400000004']
  );
  assert.ok(result.metrics.resultListScrollTopAfter > result.metrics.resultListScrollTopBefore);
});

test('collectJobUrlsWithResultListScroll stops after configured no-new rounds', async () => {
  const result = await withPage(scrollFixture(), (page) =>
    collectJobUrlsWithResultListScroll(page, {
      baseUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      maxJobs: 25,
      resultScroll: {
        enabled: true,
        maxScrolls: 12,
        pixels: { min: 50, max: 50 },
        waitSeconds: { min: 2, max: 2 },
        stopAfterNoNewRounds: 2
      },
      sleep: async () => {},
      randomBetween: (min) => min
    })
  );

  assert.equal(result.reason, 'no_new_urls');
  assert.equal(result.metrics.scrollCount, 2);
  assert.equal(result.metrics.noNewRounds, 2);
  assert.deepEqual(
    result.urls.map((job) => job.id),
    ['4400000001', '4400000002']
  );
});

test('collectJobUrlsWithResultListScroll waits briefly for hydrated result list container', async () => {
  const result = await withPage(`<!doctype html>
    <html>
      <head>
        <style>
          body { margin: 0; }
          .layout { display: flex; }
          .late-results {
            width: 420px;
            height: 180px;
            overflow-y: auto;
          }
          .job-row { height: 90px; display: block; }
        </style>
      </head>
      <body>
        <div class="layout">
          <div class="late-results" data-testid="late-results"></div>
          <div style="width: 600px"></div>
        </div>
        <script>
          setTimeout(() => {
            const list = document.querySelector('[data-testid="late-results"]');
            for (const id of ['4400000201', '4400000202']) {
              const anchor = document.createElement('a');
              anchor.className = 'job-row';
              anchor.href = '/jobs/view/' + id + '/?trk=x';
              anchor.textContent = 'Job ' + id;
              list.append(anchor);
            }
            const filler = document.createElement('div');
            filler.style.height = '700px';
            list.append(filler);
          }, 50);
        </script>
      </body>
    </html>`, (page) =>
    collectJobUrlsWithResultListScroll(page, {
      baseUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      maxJobs: 2,
      resultScroll: {
        enabled: true,
        maxScrolls: 1,
        pixels: { min: 300, max: 300 },
        waitSeconds: { min: 2, max: 2 },
        stopAfterNoNewRounds: 1
      },
      waitForResultListMs: 1000,
      sleep: async () => {},
      randomBetween: (min) => min
    })
  );

  assert.equal(result.reason, 'max_jobs_reached');
  assert.equal(result.metrics.resultListFound, true);
  assert.deepEqual(result.urls.map((job) => job.id), ['4400000201', '4400000202']);
});

test('collectJobUrlsWithResultListScroll falls back without scrolling when no safe result list is found', async () => {
  const result = await withPage(`<!doctype html>
    <html><body>
      <a href="/jobs/view/4400000101/?trk=x">Visible job</a>
    </body></html>`, (page) =>
    collectJobUrlsWithResultListScroll(page, {
      baseUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      maxJobs: 25,
      resultScroll: { enabled: true },
      waitForResultListMs: 0,
      sleep: async () => {}
    })
  );

  assert.equal(result.reason, 'result_list_not_found');
  assert.equal(result.metrics.resultListFound, false);
  assert.equal(result.metrics.scrollCount, 0);
  assert.deepEqual(result.urls.map((job) => job.id), ['4400000101']);
});
