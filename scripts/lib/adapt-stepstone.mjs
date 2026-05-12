function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return String(value ?? "").trim().toLowerCase();
  }
}

function parseLocation(raw, country) {
  const parts = String(raw ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return {
    raw: raw ?? "",
    city: parts[0] || undefined,
    state: parts[1] || undefined,
    country: country || parts[2] || undefined,
  };
}

function textOrUndefined(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

export function adaptStepstoneItem(item, { rawFile, collectedAt, runId, datasetId }) {
  const sourceJobId = String(item.id ?? "");
  const jobId = `stepstone:${sourceJobId}`;
  const sourceIdDedupeKey = `source-id:${jobId}`;
  const urlDedupeKey = item.link ? `url:${canonicalUrl(item.link)}` : null;
  const loc = parseLocation(item.location, item.country);

  return {
    schemaVersion: 1,
    identity: {
      jobId,
      dedupeKey: sourceIdDedupeKey,
      dedupeKeys: [sourceIdDedupeKey, urlDedupeKey].filter(Boolean),
      source: "stepstone",
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
      profileUrl: item.companyUrl ?? undefined,
      logoUrl: item.companyLogo ?? undefined,
      industry: textOrUndefined(item.industry),
    },
    location: {
      ...loc,
      workplaceType: "unknown",
    },
    description: {
      text: item.descriptionText ?? "",
      html: item.descriptionHtml ?? undefined,
    },
    application: {
      jobUrl: item.link ?? undefined,
      applyUrl: item.applyUrl || undefined,
      applyMethod: item.applyMethod ?? undefined,
    },
    employment: {
      employmentType: item.employmentType ?? undefined,
    },
    timing: {
      postedAt: item.postedAt ?? undefined,
      expiresAt: item.expireAt ?? undefined,
      collectedAt,
    },
    sightings: [
      {
        source: "stepstone",
        rawFile,
        sourceJobId,
        jobUrl: item.link ?? undefined,
        seenAt: collectedAt,
      },
    ],
  };
}
