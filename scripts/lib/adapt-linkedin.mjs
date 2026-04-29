function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (["refId", "trackingId", "trk", "position", "pageNum"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return String(value ?? "").trim().toLowerCase();
  }
}

function expiresAtIso(value) {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return new Date(value).toISOString();
  return String(value);
}

function parseLocation(raw, country) {
  const parts = String(raw ?? "").split(",").map((p) => p.trim());
  return {
    raw: raw ?? "",
    city: parts[0] || undefined,
    state: parts[1] || undefined,
    country: country || parts[2] || undefined,
  };
}

function mapWorkplaceType(item) {
  const types = (item.workplaceTypes ?? []).map((t) =>
    String(t).trim().toUpperCase().replace(/[-\s]+/g, "_"),
  );
  if (types.includes("REMOTE")) return "remote";
  if (types.includes("HYBRID")) return "hybrid";
  if (types.includes("ON_SITE")) return "on_site";
  return "unknown";
}

function industryText(industries) {
  if (!industries) return undefined;
  if (Array.isArray(industries)) return industries.join(", ") || undefined;
  return String(industries) || undefined;
}

export function adaptLinkedinItem(item, { rawFile, collectedAt, runId, datasetId }) {
  const sourceJobId = String(item.id ?? "");
  const jobId = `linkedin:${sourceJobId}`;
  const sourceIdDedupeKey = `source-id:${jobId}`;
  const urlDedupeKey = item.link ? `url:${canonicalUrl(item.link)}` : null;
  const loc = parseLocation(item.location, item.country);

  return {
    schemaVersion: 1,
    identity: {
      jobId,
      dedupeKey: sourceIdDedupeKey,
      dedupeKeys: [sourceIdDedupeKey, urlDedupeKey].filter(Boolean),
      source: "linkedin",
      sourceJobId,
      sourceJobUrl: item.link ?? undefined,
      sourceRunId: runId ?? undefined,
      sourceDatasetId: datasetId ?? undefined,
      sourceInputUrl: item.inputUrl ?? undefined,
      rawFile,
    },
    title: {
      raw: item.title ?? "",
      normalized: item.standardizedTitle ?? undefined,
    },
    company: {
      name: item.companyName ?? "",
      profileUrl: item.companyLinkedinUrl ?? undefined,
      logoUrl: item.companyLogo ?? undefined,
      industry: industryText(item.industries),
    },
    location: {
      ...loc,
      workplaceType: mapWorkplaceType(item),
    },
    description: {
      text: item.descriptionText ?? "",
      html: item.descriptionHtml ?? item.formattedDescription ?? undefined,
    },
    application: {
      jobUrl: item.link ?? undefined,
      applyUrl: item.applyUrl || undefined,
      applyMethod: item.applyMethod ?? undefined,
    },
    employment: {
      seniorityLevel: item.seniorityLevel ?? undefined,
      employmentType: item.employmentType ?? undefined,
      jobFunction: item.jobFunction ?? undefined,
      salaryText: item.salary ?? undefined,
      benefits: Array.isArray(item.benefits) && item.benefits.length ? item.benefits : undefined,
    },
    timing: {
      postedAt: item.postedAt ?? undefined,
      expiresAt: expiresAtIso(item.expireAt),
      collectedAt,
    },
    sightings: [
      {
        source: "linkedin",
        rawFile,
        sourceJobId,
        jobUrl: item.link ?? undefined,
        seenAt: collectedAt,
      },
    ],
  };
}
