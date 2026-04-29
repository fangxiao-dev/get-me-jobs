import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateLegacyManualLinkedinFiles } from "./lib/manual-linkedin-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const result = migrateLegacyManualLinkedinFiles(rootDir);
console.log(JSON.stringify(result, null, 2));
