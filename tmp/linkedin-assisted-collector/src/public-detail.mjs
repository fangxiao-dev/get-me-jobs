import {
  extractedLinkedinJobToRawItem,
  scrapeLinkedinJob
} from '../../../scripts/lib/scrape-linkedin-job.mjs';

export function hasMinimumRawFields(item) {
  return Boolean(item.id && item.title && item.companyName && item.location && item.descriptionText && item.link && item.inputUrl);
}

export async function processPublicLinkedinJob({
  input,
  job,
  scrape = scrapeLinkedinJob,
  now = () => new Date().toISOString()
}) {
  try {
    const extracted = await scrape(job.normalizedUrl, {
      headless: true,
      timeoutMs: 45000
    });
    const item = extractedLinkedinJobToRawItem(extracted, now());
    if (!hasMinimumRawFields(item)) {
      return { ok: false, stopReason: 'minimum_fields_missing', error: job.normalizedUrl };
    }
    return {
      ok: true,
      item: {
        ...item,
        originalUrl: job.originalUrl,
        searchPageUrl: input.searchPageUrl
      }
    };
  } catch (error) {
    return { ok: false, stopReason: 'navigation_or_extraction_failed', error: error.message };
  }
}
