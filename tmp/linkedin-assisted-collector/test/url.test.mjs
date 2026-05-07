import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLinkedInJobId,
  isLinkedInJobDetailUrl,
  normalizeLinkedInJobUrl
} from '../src/url.mjs';

test('extractLinkedInJobId reads id from jobs view URL', () => {
  assert.equal(extractLinkedInJobId('https://www.linkedin.com/jobs/view/4400000001/?trk=x'), '4400000001');
});

test('extractLinkedInJobId returns null for non-job URLs', () => {
  assert.equal(extractLinkedInJobId('https://www.linkedin.com/company/example'), null);
});

test('normalizeLinkedInJobUrl removes tracking parameters', () => {
  assert.equal(
    normalizeLinkedInJobUrl('https://www.linkedin.com/jobs/view/4400000001/?position=1&refId=abc&trackingId=track&keep=yes'),
    'https://www.linkedin.com/jobs/view/4400000001/?keep=yes'
  );
});

test('normalizeLinkedInJobUrl preserves bare detail URL trailing slash', () => {
  assert.equal(
    normalizeLinkedInJobUrl('/jobs/view/4400000001/?trk=public_jobs'),
    'https://www.linkedin.com/jobs/view/4400000001/'
  );
});

test('isLinkedInJobDetailUrl accepts LinkedIn job detail URLs only', () => {
  assert.equal(isLinkedInJobDetailUrl('https://www.linkedin.com/jobs/view/4400000001/'), true);
  assert.equal(isLinkedInJobDetailUrl('https://www.linkedin.com/company/example'), false);
  assert.equal(isLinkedInJobDetailUrl('https://example.com/jobs/view/4400000001/'), false);
  assert.equal(isLinkedInJobDetailUrl('https://evil-linkedin.com/jobs/view/4400000001/'), false);
});
