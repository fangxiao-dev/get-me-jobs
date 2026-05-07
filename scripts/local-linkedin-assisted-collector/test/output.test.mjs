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
      lastProcessedUrl: 'https://www.linkedin.com/jobs/view/4400000001/',
      stopReason: 'login_required',
      failures: [{ reason: 'login_required' }]
    },
    wroteData: false
  });

  assert.equal(summary.cookiesPath, '<redacted>');
  assert.equal(summary.stopReason, 'login_required');
  assert.equal(summary.lastProcessedUrl, 'https://www.linkedin.com/jobs/view/4400000001/');
  assert.equal(summary.wroteData, false);
});

test('writeLocalRawOutput writes local assisted raw file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-output-'));
  const file = writeLocalRawOutput({
    outputDir: dir,
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    maxJobs: 25,
    batchSize: 5,
    items: [{ id: '4400000001', title: 'Role' }],
    now: new Date('2026-05-07T12:00:00.000Z')
  });

  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.source, 'linkedin');
  assert.equal(written.taskName, 'local-linkedin-assisted-collector');
  assert.equal(written.runStatus, 'LOCAL_ASSISTED');
  assert.equal(written.maxJobs, 25);
  assert.equal(written.batchSize, 5);
  assert.equal(written.count, 1);
  assert.equal(written.items[0].id, '4400000001');
});
