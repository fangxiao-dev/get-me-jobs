export function extractLinkedinJobId(value) {
  const raw = String(value ?? "");
  const match = raw.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/i);
  if (match) return match[1];
  const fallback = raw.match(/(?:^|[^\d])(\d{7,})(?:[^\d]|$)/);
  if (fallback) return fallback[1];
  throw new Error("LinkedIn job URL must contain a numeric job id");
}

export function normalizeLinkedinJobUrl(value) {
  const id = extractLinkedinJobId(value);
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

function criteriaValue(criteria, label) {
  const wanted = label.toLowerCase();
  return (criteria ?? []).find((item) => String(item.label ?? "").trim().toLowerCase() === wanted)?.value ?? "";
}

function stripLinkedinTracking(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (["trk", "refId", "trackingId", "alternateChannel", "eBP", "position", "pageNum"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function extractedLinkedinJobToRawItem(extracted, collectedAt = new Date().toISOString()) {
  const id = extractLinkedinJobId(extracted.canonicalUrl || extracted.inputUrl);
  const link = stripLinkedinTracking(extracted.canonicalUrl) ?? normalizeLinkedinJobUrl(extracted.inputUrl);
  return {
    id,
    trackingId: "",
    refId: "",
    link,
    title: extracted.title ?? "",
    companyName: extracted.companyName ?? "",
    companyLinkedinUrl: extracted.companyLinkedinUrl ?? undefined,
    companyLogo: extracted.companyLogo ?? undefined,
    location: extracted.location ?? "",
    postedAt: extracted.postedAt ?? undefined,
    benefits: [],
    descriptionHtml: extracted.descriptionHtml ?? undefined,
    applicantsCount: extracted.applicantsText ?? "",
    applyUrl: "",
    salary: "",
    descriptionText: extracted.descriptionText ?? "",
    seniorityLevel: criteriaValue(extracted.criteria, "Seniority level"),
    employmentType: criteriaValue(extracted.criteria, "Employment type"),
    jobFunction: criteriaValue(extracted.criteria, "Job function"),
    industries: criteriaValue(extracted.criteria, "Industries"),
    inputUrl: extracted.inputUrl,
    salaryInsights: {},
    applyMethod: "ManualImport",
    expireAt: undefined,
    postedAtTimestamp: undefined,
    workplaceTypes: [],
    workRemoteAllowed: false,
    standardizedTitle: undefined,
    country: extracted.country ?? undefined,
    collectedAt,
  };
}

export async function scrapeLinkedinJob(url, options = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30000 });
    return await page.evaluate((inputUrl) => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim().replace(/\s+/g, " ") || "";
      const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || "";
      const html = (selector) => document.querySelector(selector)?.innerHTML?.trim() || "";
      return {
        inputUrl,
        canonicalUrl: attr('link[rel="canonical"]', "href") || window.location.href,
        title: text("h1"),
        companyName: text(".topcard__org-name-link, .topcard__flavor--black-link, .job-details-jobs-unified-top-card__company-name"),
        companyLinkedinUrl: attr(".topcard__org-name-link", "href"),
        companyLogo: attr(".artdeco-entity-image, .topcard__logo img", "src"),
        location: text(".topcard__flavor--bullet, .job-details-jobs-unified-top-card__primary-description-container"),
        descriptionText: text(".description__text, .jobs-description, #job-details"),
        descriptionHtml: html(".description__text, .jobs-description, #job-details"),
        criteria: [...document.querySelectorAll(".description__job-criteria-item")].map((element) => ({
          label: element.querySelector(".description__job-criteria-subheader")?.textContent?.trim().replace(/\s+/g, " ") || "",
          value: element.querySelector(".description__job-criteria-text")?.textContent?.trim().replace(/\s+/g, " ") || "",
        })),
        applicantsText: text(".num-applicants__caption"),
        postedAt: "",
      };
    }, url);
  } finally {
    await browser.close();
  }
}
