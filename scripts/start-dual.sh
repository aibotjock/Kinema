#!/usr/bin/env bash
# Start Kinema against both engines (least-loaded dispatch, ~2x throughput).
set -euo pipefail
cd "$(dirname "$0")/.."
COMFY_URLS="http://127.0.0.1:8188,http://127.0.0.1:8189" exec node server.mjs
