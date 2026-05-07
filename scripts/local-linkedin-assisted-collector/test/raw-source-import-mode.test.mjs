import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseRawFilename } from '../../../scripts/lib/parse-raw-filename.mjs';
import { validateInput } from '../src/input.mjs';
import { writeRawSourceOutput } from '../src/output.mjs';

test('writeRawSourceOutput writes parseable linkedin raw file under data/raw', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-raw-source-'));
  const file = writeRawSourceOutput({
    rootDir,
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    maxJobs: 25,
    batchSize: 5,
    items: [{ id: '4393978962', title: 'Role' }],
    now: new Date('2026-05-07T12:34:56.000Z')
  });
  const relative = path.relative(rootDir, file).replaceAll(path.sep, '/');
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(relative, 'data/raw/linkedin-2026-05-07-123456.json');
  assert.deepEqual(parseRawFilename(path.basename(file)), {
    source: 'linkedin',
    date: '2026-05-07',
    time: '123456',
    sequence: 1
  });
  assert.equal(written.source, 'linkedin');
  assert.equal(written.taskName, 'local-linkedin-assisted-collector');
  assert.equal(written.runStatus, 'LOCAL_ASSISTED');
  assert.equal(written.count, 1);
  assert.equal(written.searchPageUrl, 'https://www.linkedin.com/jobs/search/?keywords=ai');
});

test('validateInput only allows raw-source writes outside dry-run', () => {
  const dryRunInput = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    dryRun: true,
    writeRawSource: true
  });
  const writeInput = validateInput({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36',
    dryRun: false,
    writeRawSource: true
  });

  assert.equal(dryRunInput.writeRawSource, false);
  assert.equal(writeInput.writeRawSource, true);
});
