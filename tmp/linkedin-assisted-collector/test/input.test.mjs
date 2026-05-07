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
  assert.deepEqual(input.resultScroll, {
    enabled: true,
    maxScrolls: 12,
    pixels: { min: 300, max: 600 },
    waitSeconds: { min: 2, max: 5 },
    stopAfterNoNewRounds: 2
  });
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

test('validateInput rejects LinkedIn lookalike hosts', () => {
  assert.throws(
    () => validateInput({
      searchPageUrl: 'https://evil-linkedin.com/jobs/search/?keywords=ai',
      cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
      userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36'
    }),
    /searchPageUrl must be a LinkedIn jobs URL/
  );
});

test('validateInput rejects LinkedIn job detail URLs', () => {
  assert.throws(
    () => validateInput({
      searchPageUrl: 'https://www.linkedin.com/jobs/view/4400000001/',
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

test('validateInput normalizes invalid delay ranges to defaults', () => {
  const input = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    jobDelaySeconds: { min: -1, max: 999 },
    batchCooldownMinutes: { min: 10, max: 2 }
  });

  assert.deepEqual(input.jobDelaySeconds, { min: 8, max: 25 });
  assert.deepEqual(input.batchCooldownMinutes, { min: 2, max: 6 });
});

test('validateInput preserves valid delay ranges', () => {
  const input = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    jobDelaySeconds: { min: 10, max: 20 },
    batchCooldownMinutes: { min: 3, max: 5 }
  });

  assert.deepEqual(input.jobDelaySeconds, { min: 10, max: 20 });
  assert.deepEqual(input.batchCooldownMinutes, { min: 3, max: 5 });
});

test('validateInput enforces result-list scroll hard limits', () => {
  const input = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    resultScroll: {
      enabled: true,
      maxScrolls: 99,
      pixels: { min: 100, max: 999 },
      waitSeconds: { min: 1, max: 99 },
      stopAfterNoNewRounds: 9
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

test('validateInput allows disabling result-list scrolling', () => {
  const input = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    resultScroll: { enabled: false }
  });

  assert.equal(input.resultScroll.enabled, false);
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
