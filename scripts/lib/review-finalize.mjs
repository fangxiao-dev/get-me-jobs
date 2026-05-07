import path from "node:path";
import { mergeCanonicalForDate } from "../merge-canonical.mjs";
import { selectJobsFile } from "../select-jobs.mjs";
import { enrichSelectedJobs } from "../enrich-jobs.mjs";
import { loadJobSourcesManifest } from "./job-sources-manifest.mjs";

function relativePath(...parts) {
  return path.join(...parts).replaceAll(path.sep, "/");
}

export function finalizeReviewBatch(dateArg, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const manifest = options.manifest ?? loadJobSourcesManifest({ rootDir, manifestPath: options.manifestPath });
  const merge = (options.mergeCanonicalForDate ?? mergeCanonicalForDate)(dateArg, { rootDir });
  const date = merge.date;
  const canonicalFile = relativePath("data", "canonical", `${date}.json`);
  const selectedFile = relativePath("data", "selected", `${date}.json`);
  const selection = (options.selectJobsFile ?? selectJobsFile)(
    canonicalFile,
    selectedFile,
    manifest.review.preferencesFile,
    { cwd: rootDir },
  );

  let enrichment = { skipped: true, reason: "disabled_by_manifest" };
  if (manifest.review.enrichSelected) {
    try {
      enrichment = (options.enrichSelectedJobs ?? enrichSelectedJobs)(selectedFile);
    } catch (error) {
      enrichment = { failed: true, error: error.message ?? String(error) };
      options.logger?.warn?.(`AI enrichment failed: ${enrichment.error}`);
    }
  }

  return {
    ok: true,
    date,
    canonicalFile,
    selectedFile,
    canonicalItems: merge.canonicalItems,
    selectedCount: selection.selectedCount,
    merge,
    selection,
    enrichment,
  };
}
