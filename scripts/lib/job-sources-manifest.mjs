import fs from "node:fs";
import path from "node:path";

const DEFAULT_MANIFEST_PATH = path.join("config", "job-sources.manifest.json");

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
}

function assertString(value, label) {
  if (!value || typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
}

function validateNoLocalLinkedinSecrets(channel) {
  if ("cookiesPath" in channel) throw new Error("channels.localLinkedin.cookiesPath must stay in ignored local input");
  if ("userAgent" in channel) throw new Error("channels.localLinkedin.userAgent must stay in ignored local input");
}

export function loadJobSourcesManifest(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const manifestPath = options.manifestPath ?? path.join(rootDir, DEFAULT_MANIFEST_PATH);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assertObject(manifest, "manifest");
  if (manifest.version !== 1) throw new Error("manifest.version must be 1");
  assertObject(manifest.channels, "channels");
  assertObject(manifest.channels.apify_linkedin, "channels.apify_linkedin");
  assertObject(manifest.channels.localLinkedin, "channels.localLinkedin");
  assertObject(manifest.review, "review");

  assertBoolean(manifest.channels.apify_linkedin.enabled, "channels.apify_linkedin.enabled");
  assertString(manifest.channels.apify_linkedin.envFile, "channels.apify_linkedin.envFile");
  assertString(manifest.channels.apify_linkedin.taskEnvPrefix, "channels.apify_linkedin.taskEnvPrefix");
  assertBoolean(manifest.channels.localLinkedin.enabled, "channels.localLinkedin.enabled");
  assertString(manifest.channels.localLinkedin.inputFile, "channels.localLinkedin.inputFile");
  validateNoLocalLinkedinSecrets(manifest.channels.localLinkedin);
  assertString(manifest.review.preferencesFile, "review.preferencesFile");
  assertBoolean(manifest.review.enrichSelected, "review.enrichSelected");

  return manifest;
}
