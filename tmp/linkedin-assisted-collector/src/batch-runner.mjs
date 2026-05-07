function defaultRandomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clampLimit(value, fallback, max) {
  return Math.max(1, Math.min(max, Number.isInteger(value) ? value : fallback));
}

const SOFT_CONSECUTIVE_STOP_REASONS = new Set([
  'minimum_fields_missing',
  'navigation_or_extraction_failed'
]);

function shouldStopImmediately(reason) {
  return !SOFT_CONSECUTIVE_STOP_REASONS.has(reason);
}

export async function runBatches({
  urls,
  input,
  processJob,
  sleep = defaultSleep,
  randomBetween = defaultRandomBetween
}) {
  const maxJobs = clampLimit(input.maxJobs, 25, 25);
  const batchSize = clampLimit(input.batchSize, 5, 5);
  const maxBatches = 5;
  const cappedUrls = urls.slice(0, maxJobs);
  const items = [];
  const failures = [];
  let processedCount = 0;
  let batchCount = 0;
  let stopReason = null;
  let lastProcessedUrl = null;
  let consecutiveFailureReason = null;
  let consecutiveFailureCount = 0;

  for (let offset = 0; offset < cappedUrls.length && batchCount < maxBatches; offset += batchSize) {
    batchCount += 1;
    const batch = cappedUrls.slice(offset, offset + batchSize);

    for (const job of batch) {
      const result = await processJob(job);
      processedCount += 1;
      lastProcessedUrl = job.normalizedUrl;

      if (result.ok) {
        items.push(result.item);
        consecutiveFailureReason = null;
        consecutiveFailureCount = 0;
      } else {
        failures.push({ job, reason: result.stopReason, error: result.error });
        const reason = result.stopReason || 'job_failed';
        if (shouldStopImmediately(reason)) {
          stopReason = reason;
          return {
            processedCount,
            successCount: items.length,
            failureCount: failures.length,
            batchCount,
            stopReason,
            lastProcessedUrl,
            items,
            failures
          };
        }

        if (consecutiveFailureReason === reason) {
          consecutiveFailureCount += 1;
        } else {
          consecutiveFailureReason = reason;
          consecutiveFailureCount = 1;
        }

        if (consecutiveFailureCount >= 2) {
          stopReason = reason;
          return {
            processedCount,
            successCount: items.length,
            failureCount: failures.length,
            batchCount,
            stopReason,
            lastProcessedUrl,
            items,
            failures
          };
        }
      }

      if (processedCount < cappedUrls.length) {
        const seconds = randomBetween(input.jobDelaySeconds.min, input.jobDelaySeconds.max);
        await sleep(seconds * 1000);
      }
    }

    if (processedCount < cappedUrls.length && batchCount < maxBatches) {
      const minutes = randomBetween(input.batchCooldownMinutes.min, input.batchCooldownMinutes.max);
      await sleep(minutes * 60 * 1000);
    }
  }

  if (processedCount >= maxJobs && cappedUrls.length >= maxJobs) {
    stopReason = 'max_jobs_reached';
  } else if (batchCount >= maxBatches && processedCount < cappedUrls.length) {
    stopReason = 'max_batches_reached';
  } else {
    stopReason = 'completed';
  }

  return {
    processedCount,
    successCount: items.length,
    failureCount: failures.length,
    batchCount,
    stopReason,
    lastProcessedUrl,
    items,
    failures
  };
}
