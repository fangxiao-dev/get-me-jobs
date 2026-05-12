import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadJobSourcesManifest } from "../job-sources-manifest.mjs";

test("loadJobSourcesManifest reads the tracked default manifest without secrets", () => {
  const manifest = loadJobSourcesManifest();

  assert.equal(manifest.version, 1);
  assert.equal(manifest.channels.apify.enabled, true);
  assert.equal(manifest.channels.apify.envFile, ".env");
  assert.equal(manifest.channels.apify.taskEnvPrefix, "TASKID_");
  assert.equal(manifest.channels.apify_linkedin.enabled, true);
  assert.equal(manifest.channels.apify_linkedin.envFile, ".env");
  assert.equal(manifest.channels.apify_linkedin.taskEnvPrefix, "TASKID_LINKEDIN");
  assert.equal(manifest.channels.localLinkedin.enabled, false);
  assert.equal(manifest.channels.localLinkedin.inputFile, "config/local/linkedin-assisted.input.json");
  assert.equal(manifest.review.preferencesFile, "config/preferences.linkedin.json");
  assert.equal(manifest.review.enrichSelected, true);
  assert.equal("cookiesPath" in manifest.channels.localLinkedin, false);
  assert.equal("userAgent" in manifest.channels.localLinkedin, false);
});

test("loadJobSourcesManifest rejects invalid manifests", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-invalid-"));
  const manifestPath = path.join(rootDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    channels: {
      apify: { enabled: "yes" },
      apify_linkedin: { enabled: true, envFile: ".env", taskEnvPrefix: "TASKID_LINKEDIN" },
      localLinkedin: { enabled: true, inputFile: "config/local/linkedin-assisted.input.json" },
    },
    review: { preferencesFile: "config/preferences.linkedin.json", enrichSelected: true },
  }));

  assert.throws(
    () => loadJobSourcesManifest({ rootDir, manifestPath }),
    /channels\.apify\.enabled must be a boolean/,
  );
});

test("loadJobSourcesManifest preserves disabled channel state", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-disabled-"));
  const manifestPath = path.join(rootDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    channels: {
      apify: { enabled: false, envFile: ".env", taskEnvPrefix: "TASKID_" },
      apify_linkedin: { enabled: false, envFile: ".env", taskEnvPrefix: "TASKID_" },
      localLinkedin: { enabled: false, inputFile: "config/local/linkedin-assisted.input.json" },
    },
    review: { preferencesFile: "config/preferences.linkedin.json", enrichSelected: false },
  }));

  const manifest = loadJobSourcesManifest({ rootDir, manifestPath });

  assert.equal(manifest.channels.apify.enabled, false);
  assert.equal(manifest.channels.apify_linkedin.enabled, false);
  assert.equal(manifest.channels.localLinkedin.enabled, false);
  assert.equal(manifest.review.enrichSelected, false);
});

test("loadJobSourcesManifest keeps legacy apify_linkedin-only manifests working", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-legacy-apify-"));
  const manifestPath = path.join(rootDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    channels: {
      apify_linkedin: { enabled: true, envFile: ".env", taskEnvPrefix: "TASKID_LINKEDIN" },
      localLinkedin: { enabled: false, inputFile: "config/local/linkedin-assisted.input.json" },
    },
    review: { preferencesFile: "config/preferences.linkedin.json", enrichSelected: true },
  }));

  const manifest = loadJobSourcesManifest({ rootDir, manifestPath });

  assert.equal(manifest.channels.apify, undefined);
  assert.equal(manifest.channels.apify_linkedin.enabled, true);
});
