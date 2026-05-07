import fs from 'node:fs';
import path from 'node:path';

function timestampForFile(now) {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

export function buildRunSummary({ input, result, wroteData }) {
  return {
    searchPageUrl: input.searchPageUrl,
    cookiesPath: '<redacted>',
    maxJobs: input.maxJobs,
    batchSize: input.batchSize,
    dryRun: input.dryRun,
    processedCount: result.processedCount,
    successCount: result.successCount,
    failureCount: result.failureCount,
    lastProcessedUrl: result.lastProcessedUrl ?? null,
    stopReason: result.stopReason,
    failures: result.failures ?? [],
    wroteData
  };
}

export function writeLocalRawOutput({ outputDir, searchPageUrl, maxJobs, batchSize, items, now = new Date() }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const savedAt = now.toISOString();
  const file = path.join(outputDir, `linkedin-local-${timestampForFile(now)}.json`);
  fs.writeFileSync(file, `${JSON.stringify({
    source: 'linkedin',
    taskName: 'local-linkedin-assisted-collector',
    runStatus: 'LOCAL_ASSISTED',
    savedAt,
    searchPageUrl,
    maxJobs,
    batchSize,
    count: items.length,
    items
  }, null, 2)}\n`, 'utf8');
  return file;
}
