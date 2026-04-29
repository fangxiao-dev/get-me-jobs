export function emptyCanonicalFile(date) {
  return {
    schemaVersion: 1,
    date,
    updatedAt: new Date().toISOString(),
    mergeState: {
      lastRawFileTime: undefined,
      processedRawFiles: [],
    },
    sources: [],
    items: [],
  };
}

export function mergeIntoCanonical(canonicalFile, newJobs, sourceMeta) {
  const { rawFile, rawFileTime, source, importedAt, rawCount } = sourceMeta;
  const processKey = sourceMeta.processKey ?? rawFile;

  // idempotency guard
  if (canonicalFile.mergeState.processedRawFiles.includes(processKey)) {
    return canonicalFile;
  }

  const existingByDedupeKey = new Map();
  for (const job of canonicalFile.items) {
    for (const key of job.identity.dedupeKeys ?? [job.identity.dedupeKey]) {
      existingByDedupeKey.set(key, job);
    }
  }

  let addedCount = 0;
  let duplicateCount = 0;
  const nextItems = [...canonicalFile.items];

  for (const job of newJobs) {
    const keys = job.identity.dedupeKeys ?? [job.identity.dedupeKey];
    const existing = keys.map((key) => existingByDedupeKey.get(key)).find(Boolean);
    if (existing) {
      const index = nextItems.indexOf(existing);
      const mergedKeys = [...new Set([
        ...(existing.identity.dedupeKeys ?? [existing.identity.dedupeKey]),
        ...keys,
      ])];
      nextItems[index] = {
        ...existing,
        identity: { ...existing.identity, dedupeKeys: mergedKeys },
        sightings: [...existing.sightings, ...job.sightings],
      };
      for (const key of mergedKeys) existingByDedupeKey.set(key, nextItems[index]);
      duplicateCount++;
    } else {
      nextItems.push(job);
      for (const key of keys) existingByDedupeKey.set(key, job);
      addedCount++;
    }
  }

  const processedRawFiles = [...canonicalFile.mergeState.processedRawFiles, processKey];
  const lastRawFileTime =
    !canonicalFile.mergeState.lastRawFileTime ||
    rawFileTime > canonicalFile.mergeState.lastRawFileTime
      ? rawFileTime
      : canonicalFile.mergeState.lastRawFileTime;

  return {
    ...canonicalFile,
    updatedAt: new Date().toISOString(),
    mergeState: { lastRawFileTime, processedRawFiles },
    sources: [
      ...canonicalFile.sources,
      { source, rawFile, rawFileTime, importedAt, rawCount, addedCount, duplicateCount },
    ],
    items: nextItems,
  };
}
