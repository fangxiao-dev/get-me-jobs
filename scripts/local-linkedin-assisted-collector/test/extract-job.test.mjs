import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { extractJobDetail, hasMinimumJobFields } from '../src/extract-job.mjs';

test('extractJobDetail returns minimum raw LinkedIn item shape', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(path.join('test', 'fixtures', 'job-detail.html'), 'utf8'));

  const item = await extractJobDetail(page, {
    jobId: '4400000001',
    jobUrl: 'https://www.linkedin.com/jobs/view/4400000001/',
    originalUrl: 'https://www.linkedin.com/jobs/view/4400000001/?position=1&trackingId=abc',
    inputUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai'
  });

  await browser.close();

  assert.equal(item.id, '4400000001');
  assert.equal(item.title, 'Machine Learning Working Student');
  assert.equal(item.companyName, 'Example GmbH');
  assert.equal(item.companyLinkedinUrl, 'https://www.linkedin.com/company/example-company/');
  assert.equal(item.location, 'Berlin, Germany');
  assert.equal(item.descriptionText, 'Build internal AI tooling.');
  assert.equal(item.descriptionHtml, '<p>Build internal AI tooling.</p>');
  assert.equal(item.applyUrl, 'https://example.com/apply');
  assert.equal(item.applyMethod, 'external');
  assert.equal(item.link, 'https://www.linkedin.com/jobs/view/4400000001/');
  assert.equal(item.originalUrl, 'https://www.linkedin.com/jobs/view/4400000001/?position=1&trackingId=abc');
  assert.equal(item.inputUrl, 'https://www.linkedin.com/jobs/search/?keywords=ai');
  assert.equal(hasMinimumJobFields(item), true);
});

test('hasMinimumJobFields rejects missing company', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(path.join('test', 'fixtures', 'job-detail-missing-company.html'), 'utf8'));

  const item = await extractJobDetail(page, {
    jobId: '4400000001',
    jobUrl: 'https://www.linkedin.com/jobs/view/4400000001/',
    inputUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai'
  });

  await browser.close();

  assert.equal(item.companyName, '');
  assert.equal(hasMinimumJobFields(item), false);
});

test('extractJobDetail falls back to page title and body text for obfuscated logged-in pages', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html>
    <html>
      <head><title>Working Student AI | Example GmbH | LinkedIn</title></head>
      <body>
        <a href="https://www.linkedin.com/company/example-gmbh/life/">Example GmbH</a>
        <div>Example GmbH</div>
        <div>Working Student AI</div>
        <div>Berlin, Germany · 2 months ago · 12 applicants</div>
        <a href="https://www.linkedin.com/jobs/view/4400000001/apply/">Easy Apply</a>
        <h2>About the job</h2>
        <div>Build useful AI tooling.</div>
        <h2>About the company</h2>
      </body>
    </html>`);

  const item = await extractJobDetail(page, {
    jobId: '4400000001',
    jobUrl: 'https://www.linkedin.com/jobs/view/4400000001/',
    inputUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai'
  });

  await browser.close();

  assert.equal(item.title, 'Working Student AI');
  assert.equal(item.companyName, 'Example GmbH');
  assert.equal(item.location, 'Berlin, Germany');
  assert.equal(item.descriptionText, 'Build useful AI tooling.');
  assert.equal(hasMinimumJobFields(item), true);
});
