import { extractLinkedInJobId, isLinkedInJobDetailUrl, normalizeLinkedInJobUrl } from './url.mjs';

export async function extractVisibleJobUrls(page, { baseUrl, maxJobs }) {
  const hrefs = await page.$$eval('a[href]', (anchors) =>
    anchors
      .filter((anchor) => {
        const style = globalThis.getComputedStyle(anchor);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (anchor.hidden || anchor.closest('[hidden], [aria-hidden="true"]')) return false;
        return anchor.getClientRects().length > 0;
      })
      .map((anchor) => anchor.getAttribute('href'))
      .filter(Boolean)
  );

  const byJobId = new Map();
  for (const href of hrefs) {
    const originalUrl = new URL(href, baseUrl).toString();
    if (!isLinkedInJobDetailUrl(originalUrl)) continue;

    const id = extractLinkedInJobId(originalUrl);
    if (!id || byJobId.has(id)) continue;

    byJobId.set(id, {
      id,
      originalUrl,
      normalizedUrl: normalizeLinkedInJobUrl(originalUrl)
    });

    if (byJobId.size >= maxJobs) break;
  }

  return [...byJobId.values()];
}
