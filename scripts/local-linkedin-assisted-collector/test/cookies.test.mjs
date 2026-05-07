import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCookies, normalizeCookie, summarizeCookies } from '../src/cookies.mjs';

test('normalizeCookie maps Cookie-Editor fields to Playwright fields', () => {
  const cookie = normalizeCookie({
    name: 'li_at',
    value: 'secret',
    domain: '.linkedin.com',
    path: '/',
    expirationDate: 1800000000,
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction'
  });

  assert.deepEqual(cookie, {
    name: 'li_at',
    value: 'secret',
    domain: '.linkedin.com',
    path: '/',
    expires: 1800000000,
    secure: true,
    httpOnly: true,
    sameSite: 'None'
  });
});

test('loadCookies reads JSON array and normalizes cookies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-cookies-'));
  const file = path.join(dir, 'cookies.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'bcookie', value: 'secret', domain: '.linkedin.com' }]));

  const cookies = loadCookies(file);

  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, 'bcookie');
  assert.equal(cookies[0].value, 'secret');
  assert.equal(cookies[0].path, '/');
  assert.equal(cookies[0].expires, -1);
});

test('summarizeCookies redacts values', () => {
  const summary = summarizeCookies([
    { name: 'li_at', value: 'secret', domain: '.linkedin.com' },
    { name: 'JSESSIONID', value: 'secret2', domain: '.linkedin.com' }
  ]);

  assert.deepEqual(summary, {
    count: 2,
    cookies: [
      { name: 'li_at', domain: '.linkedin.com', value: '<redacted>' },
      { name: 'JSESSIONID', domain: '.linkedin.com', value: '<redacted>' }
    ]
  });
});
