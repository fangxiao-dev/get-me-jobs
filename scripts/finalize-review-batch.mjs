import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeReviewBatch } from "./lib/review-finalize.mjs";

function usage() {
  console.log("Usage: node scripts/finalize-review-batch.mjs [YYYY-MM-DD]");
  console.log("Merges all raw source files for the date, selects review jobs, and enriches selected jobs if enabled.");
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(finalizeReviewBatch(process.argv[2], { logger: console }), null, 2));
  } catch (error) {
    console.error(error.message ?? String(error));
    process.exit(1);
  }
}
