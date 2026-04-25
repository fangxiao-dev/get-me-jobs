$ErrorActionPreference = "Stop"

$rawFile = $args[0]
if ($rawFile) {
  node scripts/start-review.mjs $rawFile
} else {
  node scripts/start-review.mjs
}
