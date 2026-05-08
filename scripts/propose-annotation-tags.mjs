import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAnnotationTagProposal,
  generateAnnotationTagProposal,
} from "./lib/annotation-tag-proposal.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function annotationFiles(cwd) {
  const dir = path.join(cwd, "data", "annotations");
  if (!fs.existsSync(dir)) throw new Error(`annotations directory not found: ${dir}`);

  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      file,
      annotations: readJson(path.join(dir, file)),
    }));
}

export function runAnnotationTagProposal({
  cwd = process.cwd(),
  argv = process.argv.slice(2),
  now = new Date().toISOString(),
} = {}) {
  const apply = argv.includes("--apply");
  if (argv.some((arg) => arg !== "--apply")) {
    throw new Error("Usage: node scripts/propose-annotation-tags.mjs [--apply]");
  }

  const proposalPath = path.join(cwd, "data", "tag-proposals", "annotation-tags.json");
  if (apply) {
    if (!fs.existsSync(proposalPath)) {
      throw new Error(`proposal file not found: ${proposalPath}`);
    }
    const proposal = readJson(proposalPath);
    let updatedFiles = 0;
    for (const file of [...new Set((proposal.entries ?? []).map((entry) => entry.file))]) {
      const annotationsPath = path.join(cwd, "data", "annotations", file);
      const annotations = readJson(annotationsPath);
      writeJson(annotationsPath, applyAnnotationTagProposal(annotations, proposal, file));
      updatedFiles += 1;
    }
    return { mode: "apply", proposalPath, updatedFiles };
  }

  const proposal = generateAnnotationTagProposal({
    annotationFiles: annotationFiles(cwd),
    now,
  });
  writeJson(proposalPath, proposal);
  return { mode: "proposal", proposalPath, proposal };
}

function printResult(result) {
  if (result.mode === "apply") {
    console.log("Annotation tag proposal applied.");
    console.log(`Updated files: ${result.updatedFiles}`);
    return;
  }
  console.log(`Annotation tag proposal written: ${path.relative(process.cwd(), result.proposalPath).replaceAll(path.sep, "/")}`);
  console.log(`Annotations analyzed: ${result.proposal.summary.totalAnnotations}`);
  console.log(`Changed annotations: ${result.proposal.summary.changedAnnotations}`);
  console.log("Review the proposal before applying any tag edits.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    printResult(runAnnotationTagProposal());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
