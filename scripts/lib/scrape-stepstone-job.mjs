export function extractStepstoneJobId(value) {
  const raw = String(value ?? "");
  const match = raw.match(/--(\d+)(?:-[^/?#]+)?\.html(?:[?#]|$)/i);
  if (match) return match[1];
  const fallback = raw.match(/(?:^|[^\d])(\d{7,})(?:[^\d]|$)/);
  if (fallback) return fallback[1];
  throw new Error("Stepstone job URL must contain a numeric job id");
}

export function normalizeStepstoneJobUrl(value) {
  const url = new URL(String(value ?? ""));
  url.hash = "";
  url.search = "";
  return url.toString();
}

function htmlToText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function findJobPosting(value) {
  for (const item of asArray(value)) {
    if (!item || typeof item !== "object") continue;
    const type = item["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return item;
    const nested = findJobPosting(item["@graph"]);
    if (nested) return nested;
  }
  return null;
}

function locationText(address = {}) {
  return [
    address.addressLocality,
    address.addressRegion,
    address.addressCountry,
  ].filter(Boolean).join(", ");
}

export async function extractStepstoneJobFromPage(page, inputUrl) {
  return page.evaluate((url) => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim().replace(/\s+/g, " ") || "";
    const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || "";
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((script) => script.textContent || "")
      .filter(Boolean);
    const parsedJsonLd = scripts
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return {
      inputUrl: url,
      canonicalUrl: attr('link[rel="canonical"]', "href") || window.location.href,
      title: text("h1"),
      jsonLd: parsedJsonLd,
    };
  }, inputUrl).then((base) => {
    const jsonLd = findJobPosting(base.jsonLd);
    const address = jsonLd?.jobLocation?.address ?? {};
    const organization = jsonLd?.hiringOrganization ?? {};
    const descriptionHtml = jsonLd?.description ?? "";
    return {
      inputUrl: base.inputUrl,
      canonicalUrl: jsonLd?.url ?? base.canonicalUrl,
      title: jsonLd?.title ?? base.title,
      companyName: organization.name ?? "",
      companyUrl: organization.url ?? "",
      companyLogo: organization.logo ?? "",
      location: locationText(address),
      country: address.addressCountry ?? "",
      postedAt: jsonLd?.datePosted ?? "",
      validThrough: jsonLd?.validThrough ?? "",
      employmentType: jsonLd?.employmentType ?? "",
      industry: jsonLd?.industry ?? "",
      directApply: Boolean(jsonLd?.directApply),
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
    };
  });
}

export function extractedStepstoneJobToRawItem(extracted, collectedAt = new Date().toISOString()) {
  const link = normalizeStepstoneJobUrl(extracted.canonicalUrl || extracted.inputUrl);
  return {
    id: extractStepstoneJobId(link),
    link,
    title: extracted.title ?? "",
    companyName: extracted.companyName ?? "",
    companyUrl: extracted.companyUrl ?? undefined,
    companyLogo: extracted.companyLogo ?? undefined,
    location: extracted.location ?? "",
    country: extracted.country ?? undefined,
    postedAt: extracted.postedAt ?? undefined,
    expireAt: extracted.validThrough ?? undefined,
    employmentType: extracted.employmentType ?? undefined,
    industry: extracted.industry ?? undefined,
    descriptionHtml: extracted.descriptionHtml ?? undefined,
    descriptionText: extracted.descriptionText ?? "",
    applyUrl: "",
    inputUrl: extracted.inputUrl,
    applyMethod: "ManualImport",
    directApply: Boolean(extracted.directApply),
    collectedAt,
  };
}

export async function scrapeStepstoneJob(url, options = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30000 });
    return await extractStepstoneJobFromPage(page, url);
  } finally {
    await browser.close();
  }
}
