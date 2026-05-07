import fs from 'node:fs';
import path from 'node:path';
import { loadJobSourcesManifest } from '../../lib/job-sources-manifest.mjs';

function absoluteFromRoot(rootDir, value) {
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

export function resolveCollectorInputPath({ rootDir, manifest, inputPath }) {
  if (inputPath) return absoluteFromRoot(rootDir, inputPath);
  const configured = manifest?.channels?.localLinkedin?.inputFile;
  if (!configured) throw new Error('channels.localLinkedin.inputFile is required in job sources manifest');
  return absoluteFromRoot(rootDir, configured);
}

export function readCollectorInputFile({ rootDir = process.cwd(), inputPath, manifest } = {}) {
  const resolvedManifest = inputPath ? manifest : manifest ?? loadJobSourcesManifest({ rootDir });
  const resolvedInputPath = resolveCollectorInputPath({ rootDir, manifest: resolvedManifest, inputPath });
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Missing local LinkedIn input file. Copy config/local/linkedin-assisted.input.example.json to ${path.relative(rootDir, resolvedInputPath).replaceAll(path.sep, '/')}`);
  }
  return JSON.parse(fs.readFileSync(resolvedInputPath, 'utf8'));
}
