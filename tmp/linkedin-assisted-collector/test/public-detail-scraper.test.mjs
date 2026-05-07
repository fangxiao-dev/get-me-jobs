import assert from 'node:assert/strict';
import test from 'node:test';
import { extractedLinkedinJobToRawItem } from '../../../scripts/lib/scrape-linkedin-job.mjs';
import { hasMinimumRawFields, processPublicLinkedinJob } from '../src/public-detail.mjs';

test('Dashboard public LinkedIn extraction maps to collector minimum raw fields', () => {
  const raw = extractedLinkedinJobToRawItem({
    inputUrl: 'https://www.linkedin.com/jobs/view/4393978962/',
    canonicalUrl: 'https://de.linkedin.com/jobs/view/praktikum-machine-learning-at-trumpf-4393978962',
    title: 'Praktikum Machine Learning',
    companyName: 'TRUMPF',
    companyLinkedinUrl: 'https://de.linkedin.com/company/trumpf',
    location: 'Ditzingen, Baden-Württemberg, Germany',
    descriptionText: 'Build computer vision prototypes.',
    descriptionHtml: '<p>Build computer vision prototypes.</p>',
    criteria: [
      { label: 'Employment type', value: 'Internship' },
      { label: 'Industries', value: 'Machinery Manufacturing' }
    ],
    applicantsText: 'Be among the first 25 applicants'
  }, '2026-05-07T12:00:00.000Z');

  assert.equal(raw.id, '4393978962');
  assert.equal(raw.title, 'Praktikum Machine Learning');
  assert.equal(raw.companyName, 'TRUMPF');
  assert.equal(raw.location, 'Ditzingen, Baden-Württemberg, Germany');
  assert.equal(raw.descriptionText, 'Build computer vision prototypes.');
  assert.equal(raw.link, 'https://de.linkedin.com/jobs/view/praktikum-machine-learning-at-trumpf-4393978962');
  assert.equal(raw.applyUrl, '');
  assert.equal(raw.applyMethod, 'ManualImport');
  assert.equal(raw.inputUrl, 'https://www.linkedin.com/jobs/view/4393978962/');
  assert.equal(hasMinimumRawFields(raw), true);
});

test('processPublicLinkedinJob uses the public scraper and preserves original search context', async () => {
  const result = await processPublicLinkedinJob({
    input: { searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai' },
    job: {
      id: '4393978962',
      normalizedUrl: 'https://www.linkedin.com/jobs/view/4393978962/',
      originalUrl: 'https://www.linkedin.com/jobs/view/4393978962/?trk=flagship3_search_srp_jobs'
    },
    now: () => '2026-05-07T12:00:00.000Z',
    scrape: async (url) => ({
      inputUrl: url,
      canonicalUrl: url,
      title: 'Praktikum Machine Learning',
      companyName: 'TRUMPF',
      location: 'Ditzingen, Baden-Württemberg, Germany',
      descriptionText: 'Build computer vision prototypes.',
      criteria: []
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.item.id, '4393978962');
  assert.equal(result.item.originalUrl, 'https://www.linkedin.com/jobs/view/4393978962/?trk=flagship3_search_srp_jobs');
  assert.equal(result.item.searchPageUrl, 'https://www.linkedin.com/jobs/search/?keywords=ai');
  assert.equal(result.item.applyMethod, 'ManualImport');
});

test('processPublicLinkedinJob fails when the public page lacks minimum fields', async () => {
  const result = await processPublicLinkedinJob({
    input: { searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai' },
    job: {
      id: '4393978962',
      normalizedUrl: 'https://www.linkedin.com/jobs/view/4393978962/',
      originalUrl: 'https://www.linkedin.com/jobs/view/4393978962/?trk=flagship3_search_srp_jobs'
    },
    scrape: async (url) => ({
      inputUrl: url,
      canonicalUrl: url,
      title: '',
      companyName: '',
      location: '',
      descriptionText: '',
      criteria: []
    })
  });

  assert.deepEqual(result, {
    ok: false,
    stopReason: 'minimum_fields_missing',
    error: 'https://www.linkedin.com/jobs/view/4393978962/'
  });
});
