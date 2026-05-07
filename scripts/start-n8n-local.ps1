$ErrorActionPreference = "Stop"

$env:GENERIC_TIMEZONE = "Europe/Berlin"
$env:NODES_EXCLUDE = "[]"

n8n start
