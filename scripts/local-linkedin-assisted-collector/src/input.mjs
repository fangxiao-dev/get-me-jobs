import path from 'node:path';

const DEFAULTS = {
  maxJobs: 25,
  batchSize: 5,
  dryRun: true,
  headed: true,
  writeRawSource: false,
  jobDelaySeconds: { min: 8, max: 25 },
  batchCooldownMinutes: { min: 2, max: 6 },
  resultScroll: {
    enabled: true,
    maxScrolls: 12,
    pixels: { min: 300, max: 600 },
    waitSeconds: { min: 2, max: 5 },
    stopAfterNoNewRounds: 2
  }
};

function isLinkedInHost(hostname) {
  return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
}

function clampInteger(value, fallback, min, max) {
  const number = Number.isInteger(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeRange(value, fallback, { minAllowed, maxAllowed }) {
  if (!value || typeof value !== 'object') return fallback;
  const min = Number(value.min);
  const max = Number(value.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  if (min < minAllowed || max > maxAllowed || min > max) return fallback;
  return { min, max };
}

function normalizeResultScroll(value) {
  if (value?.enabled === false) {
    return { ...DEFAULTS.resultScroll, enabled: false };
  }
  if (!value || typeof value !== 'object') return DEFAULTS.resultScroll;

  const maxScrolls = clampInteger(value.maxScrolls, DEFAULTS.resultScroll.maxScrolls, 1, 12);
  const pixels = normalizeRange(value.pixels, DEFAULTS.resultScroll.pixels, {
    minAllowed: 300,
    maxAllowed: 600
  });
  const waitSeconds = normalizeRange(value.waitSeconds, DEFAULTS.resultScroll.waitSeconds, {
    minAllowed: 2,
    maxAllowed: 8
  });
  const stopAfterNoNewRounds = clampInteger(
    value.stopAfterNoNewRounds,
    DEFAULTS.resultScroll.stopAfterNoNewRounds,
    1,
    2
  );

  return {
    enabled: true,
    maxScrolls,
    pixels,
    waitSeconds,
    stopAfterNoNewRounds
  };
}

function isLinkedInJobsUrl(value) {
  try {
    const url = new URL(value);
    return isLinkedInHost(url.hostname) && /^\/jobs\/search\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizeFilePath(value) {
  return String(value).replaceAll('/', path.sep);
}

function isPathInside(parent, child) {
  const parentPath = path.resolve(normalizeFilePath(parent));
  const childPath = path.resolve(normalizeFilePath(child));
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateInput(rawInput) {
  const input = { ...DEFAULTS, ...rawInput };

  if (!isLinkedInJobsUrl(input.searchPageUrl)) {
    throw new Error('searchPageUrl must be a LinkedIn jobs URL');
  }
  if (!input.cookiesPath || typeof input.cookiesPath !== 'string') {
    throw new Error('cookiesPath is required');
  }
  if (!input.userAgent || typeof input.userAgent !== 'string') {
    throw new Error('userAgent is required');
  }
  if (input.rootDir && isPathInside(input.rootDir, input.cookiesPath)) {
    throw new Error('cookiesPath must be outside the repository');
  }

  const dryRun = input.dryRun !== false;

  return {
    ...input,
    maxJobs: clampInteger(input.maxJobs, DEFAULTS.maxJobs, 1, 25),
    batchSize: clampInteger(input.batchSize, DEFAULTS.batchSize, 1, 5),
    dryRun,
    headed: input.headed !== false,
    writeRawSource: dryRun ? false : input.writeRawSource === true,
    jobDelaySeconds: normalizeRange(input.jobDelaySeconds, DEFAULTS.jobDelaySeconds, {
      minAllowed: 1,
      maxAllowed: 120
    }),
    batchCooldownMinutes: normalizeRange(input.batchCooldownMinutes, DEFAULTS.batchCooldownMinutes, {
      minAllowed: 1,
      maxAllowed: 30
    }),
    resultScroll: normalizeResultScroll(input.resultScroll)
  };
}
