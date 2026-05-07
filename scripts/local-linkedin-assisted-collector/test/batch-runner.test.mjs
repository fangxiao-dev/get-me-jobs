import assert from 'node:assert/strict';
import test from 'node:test';
import { runBatches } from '../src/batch-runner.mjs';

function makeUrls(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(4400000000 + index),
    normalizedUrl: `https://www.linkedin.com/jobs/view/${4400000000 + index}/`
  }));
}

function makeInput(overrides = {}) {
  return {
    maxJobs: 25,
    batchSize: 5,
    jobDelaySeconds: { min: 8, max: 25 },
    batchCooldownMinutes: { min: 2, max: 6 },
    ...overrides
  };
}

test('runBatches caps jobs at 25 and batches at 5', async () => {
  const processed = [];
  const sleeps = [];

  const result = await runBatches({
    urls: makeUrls(30),
    input: makeInput({ maxJobs: 100, batchSize: 20 }),
    processJob: async (job) => {
      processed.push(job.id);
      return { ok: true, item: { id: job.id } };
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    randomBetween: (min) => min
  });

  assert.equal(processed.length, 25);
  assert.equal(result.processedCount, 25);
  assert.equal(result.successCount, 25);
  assert.equal(result.failureCount, 0);
  assert.equal(result.batchCount, 5);
  assert.equal(result.stopReason, 'max_jobs_reached');
  assert.equal(sleeps.filter((value) => value === 8000).length, 24);
  assert.equal(sleeps.filter((value) => value === 120000).length, 4);
});

test('runBatches uses configured delay and cooldown ranges', async () => {
  const ranges = [];
  const sleeps = [];

  const result = await runBatches({
    urls: makeUrls(6),
    input: makeInput({
      maxJobs: 6,
      batchSize: 3,
      jobDelaySeconds: { min: 11, max: 13 },
      batchCooldownMinutes: { min: 4, max: 9 }
    }),
    processJob: async (job) => ({ ok: true, item: { id: job.id } }),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    randomBetween: (min, max) => {
      ranges.push([min, max]);
      return max;
    }
  });

  assert.equal(result.processedCount, 6);
  assert.equal(result.batchCount, 2);
  assert.deepEqual(ranges, [
    [11, 13],
    [11, 13],
    [11, 13],
    [4, 9],
    [11, 13],
    [11, 13]
  ]);
  assert.deepEqual(sleeps, [13000, 13000, 13000, 540000, 13000, 13000]);
});

test('runBatches stops immediately on anomaly', async () => {
  const sleeps = [];

  const result = await runBatches({
    urls: makeUrls(3),
    input: makeInput({ maxJobs: 3, batchSize: 3 }),
    processJob: async (job) => {
      if (job.id.endsWith('1')) {
        return { ok: false, stopReason: 'login_required', error: job.normalizedUrl };
      }
      return { ok: true, item: { id: job.id } };
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    randomBetween: (min) => min
  });

  assert.equal(result.processedCount, 2);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 1);
  assert.equal(result.batchCount, 1);
  assert.equal(result.stopReason, 'login_required');
  assert.equal(result.lastProcessedUrl, 'https://www.linkedin.com/jobs/view/4400000001/');
  assert.equal(result.failures[0].reason, 'login_required');
  assert.deepEqual(sleeps, [8000]);
});

test('runBatches continues after one soft extraction failure and stops after two consecutive soft failures', async () => {
  const result = await runBatches({
    urls: makeUrls(4),
    input: makeInput({ maxJobs: 4, batchSize: 4 }),
    processJob: async (job) => {
      if (job.id.endsWith('0')) return { ok: true, item: { id: job.id } };
      return { ok: false, stopReason: 'minimum_fields_missing', error: job.normalizedUrl };
    },
    sleep: async () => {},
    randomBetween: (min) => min
  });

  assert.equal(result.processedCount, 3);
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 2);
  assert.equal(result.stopReason, 'minimum_fields_missing');
  assert.equal(result.lastProcessedUrl, 'https://www.linkedin.com/jobs/view/4400000002/');
});
