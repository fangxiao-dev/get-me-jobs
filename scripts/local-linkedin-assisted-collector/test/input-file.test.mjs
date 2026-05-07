import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readCollectorInputFile, resolveCollectorInputPath } from '../src/input-file.mjs';

test('resolveCollectorInputPath uses the manifest localLinkedin input file by default', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-input-root-'));
  const manifest = {
    channels: {
      localLinkedin: {
        inputFile: 'config/local/linkedin-assisted.input.json'
      }
    }
  };

  assert.equal(
    resolveCollectorInputPath({ rootDir, manifest }),
    path.join(rootDir, 'config', 'local', 'linkedin-assisted.input.json')
  );
});

test('readCollectorInputFile reads local input without exposing secrets in errors', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-input-read-'));
  const inputPath = path.join(rootDir, 'config', 'local', 'linkedin-assisted.input.json');
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, JSON.stringify({
    searchPageUrl: 'https://www.linkedin.com/jobs/search/?keywords=ai',
    cookiesPath: 'C:/Users/Xiao/secure/linkedin-cookies.json',
    userAgent: 'Mozilla/5.0 Chrome/124 Safari/537.36'
  }));

  const input = readCollectorInputFile({ inputPath });

  assert.equal(input.searchPageUrl, 'https://www.linkedin.com/jobs/search/?keywords=ai');
  assert.equal(input.cookiesPath, 'C:/Users/Xiao/secure/linkedin-cookies.json');
  assert.equal(input.userAgent, 'Mozilla/5.0 Chrome/124 Safari/537.36');
});
