import { extractVisibleJobUrls } from './extract-search.mjs';
import { extractLinkedInJobId, isLinkedInJobDetailUrl, normalizeLinkedInJobUrl } from './url.mjs';

const DEFAULT_RESULT_SCROLL = {
  enabled: true,
  maxScrolls: 12,
  pixels: { min: 300, max: 600 },
  waitSeconds: { min: 2, max: 5 },
  stopAfterNoNewRounds: 2
};

function defaultRandomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mergeResultScroll(resultScroll = {}) {
  return {
    ...DEFAULT_RESULT_SCROLL,
    ...resultScroll,
    pixels: { ...DEFAULT_RESULT_SCROLL.pixels, ...resultScroll.pixels },
    waitSeconds: { ...DEFAULT_RESULT_SCROLL.waitSeconds, ...resultScroll.waitSeconds }
  };
}

function addJobUrls(records, hrefs, { baseUrl, maxJobs }) {
  for (const href of hrefs) {
    const originalUrl = new URL(href, baseUrl).toString();
    if (!isLinkedInJobDetailUrl(originalUrl)) continue;

    const id = extractLinkedInJobId(originalUrl);
    if (!id || records.has(id)) continue;

    records.set(id, {
      id,
      originalUrl,
      normalizedUrl: normalizeLinkedInJobUrl(originalUrl)
    });

    if (records.size >= maxJobs) break;
  }
}

async function markResultListContainer(page) {
  const token = `li-result-list-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const found = await page.evaluate((targetToken) => {
    const jobHrefPattern = /\/jobs\/view\/\d+/;
    const candidates = [...document.querySelectorAll('div, ul, section, main')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const hrefCount = [...element.querySelectorAll('a[href]')]
          .filter((anchor) => jobHrefPattern.test(anchor.getAttribute('href') || ''))
          .length;
        const style = getComputedStyle(element);
        const canScroll = element.scrollHeight > element.clientHeight + 20
          && /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);
        const isLeftSide = rect.width > 120
          && rect.height > 80
          && rect.left < window.innerWidth * 0.55
          && rect.right < window.innerWidth * 0.75;

        let score = 0;
        if (element.matches('.jobs-search-results-list, [data-testid*="jobs-search-results-list"]')) score += 100;
        if (element.getAttribute('aria-label')?.toLowerCase().includes('jobs')) score += 20;
        score += Math.min(hrefCount, 10) * 5;

        return { element, hrefCount, canScroll, isLeftSide, score };
      })
      .filter((candidate) => candidate.hrefCount > 0 && candidate.canScroll && candidate.isLeftSide)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0]?.element;
    if (!best) return false;
    best.setAttribute('data-li-result-list-scroll-target', targetToken);
    return true;
  }, token);

  return found ? `[data-li-result-list-scroll-target="${token}"]` : null;
}

async function waitForResultListContainer(page, timeout) {
  if (!timeout) return;
  await page.waitForFunction(() => {
    const jobHrefPattern = /\/jobs\/view\/\d+/;
    return [...document.querySelectorAll('div, ul, section, main')]
      .some((element) => {
        const rect = element.getBoundingClientRect();
        const hrefCount = [...element.querySelectorAll('a[href]')]
          .filter((anchor) => jobHrefPattern.test(anchor.getAttribute('href') || ''))
          .length;
        const style = getComputedStyle(element);
        const canScroll = element.scrollHeight > element.clientHeight + 20
          && /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`);
        const isLeftSide = rect.width > 120
          && rect.height > 80
          && rect.left < window.innerWidth * 0.55
          && rect.right < window.innerWidth * 0.75;

        return hrefCount > 0 && canScroll && isLeftSide;
      });
  }, null, { timeout }).catch(() => {});
}

async function hrefsFromContainer(page, containerSelector) {
  return page.$$eval(`${containerSelector} a[href]`, (anchors) =>
    anchors.map((anchor) => anchor.getAttribute('href')).filter(Boolean)
  );
}

async function scrollContainer(page, containerSelector, pixels) {
  return page.$eval(containerSelector, (element, scrollPixels) => {
    const before = element.scrollTop;
    const next = Math.min(element.scrollTop + scrollPixels, element.scrollHeight - element.clientHeight);
    element.scrollTop = next;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
    return {
      before,
      after: element.scrollTop,
      didMove: element.scrollTop !== before
    };
  }, pixels);
}

async function scrollTopFor(page, containerSelector) {
  return page.$eval(containerSelector, (element) => element.scrollTop);
}

export async function collectJobUrlsWithResultListScroll(page, {
  baseUrl,
  maxJobs,
  resultScroll,
  waitForResultListMs = 10000,
  sleep = defaultSleep,
  randomBetween = defaultRandomBetween
}) {
  const config = mergeResultScroll(resultScroll);
  const windowScrollYBefore = await page.evaluate(() => window.scrollY);

  if (!config.enabled) {
    const urls = await extractVisibleJobUrls(page, { baseUrl, maxJobs });
    return {
      urls,
      reason: urls.length >= maxJobs ? 'max_jobs_reached' : 'result_scroll_disabled',
      metrics: {
        resultListFound: false,
        scrollCount: 0,
        noNewRounds: 0,
        windowScrollYBefore,
        windowScrollYAfter: await page.evaluate(() => window.scrollY)
      }
    };
  }

  await waitForResultListContainer(page, waitForResultListMs);
  const containerSelector = await markResultListContainer(page);
  if (!containerSelector) {
    const urls = await extractVisibleJobUrls(page, { baseUrl, maxJobs });
    return {
      urls,
      reason: 'result_list_not_found',
      metrics: {
        resultListFound: false,
        scrollCount: 0,
        noNewRounds: 0,
        windowScrollYBefore,
        windowScrollYAfter: await page.evaluate(() => window.scrollY)
      }
    };
  }

  const records = new Map();
  const resultListScrollTopBefore = await scrollTopFor(page, containerSelector);
  addJobUrls(records, await hrefsFromContainer(page, containerSelector), { baseUrl, maxJobs });

  let reason = records.size >= maxJobs ? 'max_jobs_reached' : 'max_scrolls_reached';
  let scrollCount = 0;
  let noNewRounds = 0;

  while (records.size < maxJobs && scrollCount < config.maxScrolls && noNewRounds < config.stopAfterNoNewRounds) {
    const beforeCount = records.size;
    const pixels = randomBetween(config.pixels.min, config.pixels.max);
    const movement = await scrollContainer(page, containerSelector, pixels);
    scrollCount += 1;

    const waitSeconds = randomBetween(config.waitSeconds.min, config.waitSeconds.max);
    await sleep(waitSeconds * 1000);

    addJobUrls(records, await hrefsFromContainer(page, containerSelector), { baseUrl, maxJobs });
    noNewRounds = records.size === beforeCount ? noNewRounds + 1 : 0;

    if (records.size >= maxJobs) reason = 'max_jobs_reached';
    else if (noNewRounds >= config.stopAfterNoNewRounds) reason = 'no_new_urls';
    else if (!movement.didMove) reason = 'result_list_end_reached';
  }

  const windowScrollYAfter = await page.evaluate(() => window.scrollY);
  return {
    urls: [...records.values()],
    reason,
    metrics: {
      resultListFound: true,
      scrollCount,
      noNewRounds,
      resultListScrollTopBefore,
      resultListScrollTopAfter: await scrollTopFor(page, containerSelector),
      windowScrollYBefore,
      windowScrollYAfter
    }
  };
}
