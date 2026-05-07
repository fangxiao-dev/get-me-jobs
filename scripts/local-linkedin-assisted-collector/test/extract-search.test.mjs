import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { extractVisibleJobUrls } from '../src/extract-search.mjs';

async function withFixturePage(callback) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const html = fs.readFileSync(path.join('test', 'fixtures', 'search-page.html'), 'utf8');

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await callback(page);
  } finally {
    await browser.close();
  }
}

test('extractVisibleJobUrls returns deduped LinkedIn job URLs capped by maxJobs', async () => {
  const urls = await withFixturePage((page) =>
    extractVisibleJobUrls(page, {
      baseUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      maxJobs: 25
    })
  );

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
    },
    {
      id: '4400000003',
      originalUrl: 'https://www.linkedin.com/jobs/view/4400000003/?currentJobId=4400000003&start=25',
      normalizedUrl: 'https://www.linkedin.com/jobs/view/4400000003/'
    }
  ]);
});

test('extractVisibleJobUrls respects maxJobs', async () => {
  const urls = await withFixturePage((page) =>
    extractVisibleJobUrls(page, {
      baseUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
      maxJobs: 2
    })
  );

  assert.deepEqual(
    urls.map((job) => job.id),
    ['4400000001', '4400000002']
  );
});
