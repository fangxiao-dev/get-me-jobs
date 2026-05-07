import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { detectStopCondition } from '../src/stop-conditions.mjs';

async function withFixture(name, fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(path.join('test', 'fixtures', name), 'utf8'));
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

test('detectStopCondition detects login wall', async () => {
  await withFixture('login-wall.html', async (page) => {
    const stop = await detectStopCondition(page);
    assert.equal(stop.reason, 'login_required');
  });
});

test('detectStopCondition detects security checkpoint', async () => {
  await withFixture('security-checkpoint.html', async (page) => {
    const stop = await detectStopCondition(page);
    assert.equal(stop.reason, 'security_checkpoint');
  });
});

test('detectStopCondition detects captcha text', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body><h1>Complete this CAPTCHA</h1></body>');
  try {
    const stop = await detectStopCondition(page);
    assert.equal(stop.reason, 'captcha');
  } finally {
    await browser.close();
  }
});

test('detectStopCondition detects access restriction text', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body><p>Your access is temporarily restricted.</p></body>');
  try {
    const stop = await detectStopCondition(page);
    assert.equal(stop.reason, 'access_restricted');
  } finally {
    await browser.close();
  }
});

test('detectStopCondition returns null on normal job page', async () => {
  await withFixture('job-detail.html', async (page) => {
    const stop = await detectStopCondition(page);
    assert.equal(stop, null);
  });
});
