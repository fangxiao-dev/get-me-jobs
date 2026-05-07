import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stdin as inputStream, stdout as outputStream } from 'node:process';
import { runBatches } from './batch-runner.mjs';
import { createBrowserSession } from './browser.mjs';
import { detectStopCondition } from './stop-conditions.mjs';
import { validateInput } from './input.mjs';
import { buildRunSummary, writeLocalRawOutput, writeRawSourceOutput } from './output.mjs';
import { collectJobUrlsWithResultListScroll } from './result-list-scroll.mjs';
import { processPublicLinkedinJob } from './public-detail.mjs';
import { readCollectorInputFile } from './input-file.mjs';

const collectorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function askForConfirmation(urls) {
  console.log(`Preview found ${urls.length} job URLs:`);
  for (const [index, job] of urls.entries()) {
    console.log(`${index + 1}. ${job.normalizedUrl}`);
  }

  const rl = readline.createInterface({ input: inputStream, output: outputStream });
  try {
    const answer = await rl.question('Process these URLs? Type YES to continue: ');
    return answer.trim() === 'YES';
  } finally {
    rl.close();
  }
}

async function processOneJob(_page, input, job) {
  return processPublicLinkedinJob({ input, job });
}

async function main() {
  const previewOnly = process.argv.includes('--preview-only');
  const rootDir = path.resolve(collectorDir, '..', '..');
  const rawInput = readCollectorInputFile({ rootDir, inputPath: optionValue('--input') });
  const input = validateInput({ ...rawInput, rootDir });
  const session = await createBrowserSession(input);
  let wroteData = false;
  let result = {
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    stopReason: 'preview_only',
    failures: [],
    items: []
  };

  try {
    await session.page.goto(input.searchPageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const searchStop = await detectStopCondition(session.page);
    if (searchStop) {
      result = { ...result, stopReason: searchStop.reason, failures: [{ reason: searchStop.reason, url: searchStop.url }] };
      return;
    }

    const preview = await collectJobUrlsWithResultListScroll(session.page, {
      baseUrl: input.searchPageUrl,
      maxJobs: input.maxJobs,
      resultScroll: input.resultScroll
    });
    const urls = preview.urls;
    if (urls.length === 0) {
      result = { ...result, stopReason: preview.reason === 'result_list_not_found' ? 'result_list_not_found' : 'no_visible_job_urls' };
      return;
    }

    if (previewOnly) {
      console.log(JSON.stringify({ previewOnly: true, urls, preview: { reason: preview.reason, metrics: preview.metrics } }, null, 2));
      return;
    }

    const confirmed = await askForConfirmation(urls);
    if (!confirmed) {
      result = { ...result, stopReason: 'user_declined_preview' };
      return;
    }

    result = await runBatches({
      urls,
      input,
      processJob: (job) => processOneJob(session.page, input, job)
    });

    if (input.writeRawSource && result.items.length > 0) {
      const file = writeRawSourceOutput({
        rootDir,
        searchPageUrl: input.searchPageUrl,
        maxJobs: input.maxJobs,
        batchSize: input.batchSize,
        items: result.items
      });
      wroteData = true;
      console.log(`Wrote raw LinkedIn source output: ${file}`);
    } else if (!input.dryRun && result.items.length > 0) {
      const file = writeLocalRawOutput({
        outputDir: path.join(collectorDir, 'output'),
        searchPageUrl: input.searchPageUrl,
        maxJobs: input.maxJobs,
        batchSize: input.batchSize,
        items: result.items
      });
      wroteData = true;
      console.log(`Wrote local raw output: ${file}`);
    }
  } finally {
    await session.close();
    console.log(JSON.stringify(buildRunSummary({ input, result, wroteData }), null, 2));
  }
}

await main();
