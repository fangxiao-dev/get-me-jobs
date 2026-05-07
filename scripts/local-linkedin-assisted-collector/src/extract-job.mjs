async function firstText(page, selectors) {
  for (const selector of selectors) {
    const value = await page.locator(selector).first().innerText({ timeout: 1000 }).catch(() => '');
    if (value.trim()) return value.trim();
  }
  return '';
}

async function firstHtml(page, selectors) {
  for (const selector of selectors) {
    const value = await page.locator(selector).first().innerHTML({ timeout: 1000 }).catch(() => '');
    if (value.trim()) return value.trim();
  }
  return '';
}

async function firstHref(page, selectors) {
  for (const selector of selectors) {
    const value = await page.locator(selector).first().getAttribute('href', { timeout: 1000 }).catch(() => '');
    if (value?.trim()) return value.trim();
  }
  return '';
}

function cleanLines(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function titleFromPageTitle(value) {
  const [title] = String(value ?? '').split('|').map((part) => part.trim());
  return title || '';
}

function companyFromPageTitle(value) {
  const parts = String(value ?? '').split('|').map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : '';
}

function locationFromBodyLines(lines, title) {
  const titleIndex = lines.findIndex((line) => line === title);
  if (titleIndex >= 0) {
    const candidate = lines.slice(titleIndex + 1).find((line) => line.includes(' · '));
    if (candidate) return candidate.split(' · ')[0].trim();
  }
  return '';
}

function descriptionFromBodyLines(lines) {
  const start = lines.findIndex((line) => /^About the job$/i.test(line));
  if (start < 0) return '';
  const end = lines.findIndex((line, index) =>
    index > start && /^(Set alert for similar jobs|About the company|More jobs)$/i.test(line)
  );
  return lines
    .slice(start + 1, end > start ? end : undefined)
    .filter((line) => line !== '… more')
    .join('\n');
}

export async function extractJobDetail(page, { jobId, jobUrl, originalUrl, inputUrl }) {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const bodyLines = cleanLines(bodyText);
  const pageTitle = await page.title().catch(() => '');
  const title = await firstText(page, ['h1', '.top-card-layout__title', '.job-details-jobs-unified-top-card__job-title'])
    || titleFromPageTitle(pageTitle);
  const companyName = await firstText(page, [
    'a[href*="/company/"]',
    '.topcard__org-name-link',
    '.job-details-jobs-unified-top-card__company-name'
  ]) || companyFromPageTitle(pageTitle);
  const companyLinkedinUrl = await firstHref(page, ['a[href*="/company/"]']);
  const location = await firstText(page, ['.job-location', '.topcard__flavor--bullet', '.job-details-jobs-unified-top-card__bullet'])
    || locationFromBodyLines(bodyLines, title);
  const descriptionText = await firstText(page, ['#job-details', '.description__text', '.jobs-description'])
    || descriptionFromBodyLines(bodyLines);
  const descriptionHtml = await firstHtml(page, ['#job-details', '.description__text', '.jobs-description']);
  const applyUrl = await firstHref(page, ['a.apply', 'a[href*="/jobs/apply/"]', 'a[href*="apply"]']);

  return {
    id: jobId,
    title,
    companyName,
    companyLinkedinUrl: companyLinkedinUrl || undefined,
    location,
    descriptionText,
    descriptionHtml: descriptionHtml || undefined,
    link: jobUrl,
    originalUrl: originalUrl || undefined,
    applyUrl: applyUrl || undefined,
    applyMethod: applyUrl ? 'external' : undefined,
    inputUrl
  };
}

export function hasMinimumJobFields(item) {
  return Boolean(item.id && item.title && item.companyName && item.location && item.descriptionText && item.link && item.inputUrl);
}
