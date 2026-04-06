#!/usr/bin/env bash
set -euo pipefail

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAX_MINUTES="${CBT_CANARY_MAX_RUNTIME_MINUTES:-20}"

echo "[safe-canary] starting with timeout=${MAX_MINUTES}m (set CBT_CANARY_MAX_RUNTIME_MINUTES to override)"
echo "[safe-canary] recommendation: set loopsLength=1 in dist/_config/config.json for first-live cycle stop"

timeout "${MAX_MINUTES}m" node "$BASEDIR/dist/index.js"
