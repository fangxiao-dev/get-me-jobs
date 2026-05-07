const TRACKING_PARAMS = new Set([
  'currentJobId',
  'eBP',
  'f_C',
  'f_E',
  'f_JT',
  'f_TPR',
  'geoId',
  'keywords',
  'origin',
  'pageNum',
  'position',
  'refId',
  'refresh',
  'sortBy',
  'spellCorrectionEnabled',
  'start',
  'trackingId',
  'trk'
]);

function isLinkedInHost(hostname) {
  return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
}

export function extractLinkedInJobId(value) {
  try {
    const url = new URL(value, 'https://www.linkedin.com');
    const match = /^\/jobs\/view\/(\d+)\/?/.exec(url.pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isLinkedInJobDetailUrl(value) {
  try {
    const url = new URL(value, 'https://www.linkedin.com');
    return isLinkedInHost(url.hostname) && extractLinkedInJobId(url.href) !== null;
  } catch {
    return false;
  }
}

export function normalizeLinkedInJobUrl(value) {
  const url = new URL(value, 'https://www.linkedin.com');
  if (!isLinkedInHost(url.hostname)) {
    throw new Error('Expected a LinkedIn job URL');
  }
  url.hash = '';

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}
