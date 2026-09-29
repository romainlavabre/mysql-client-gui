#!/usr/bin/env bash
# Starts the app in development mode (hot reload of the interface).
#
#   ./run.sh             normal data folder (~/.config/simone)
#   ./run.sh --sandbox   throwaway data folder in .sandbox/, to try things safely
set -euo pipefail

cd "$(dirname "$0")"

[[ -d node_modules ]] || npm install

if [[ "${1:-}" == "--sandbox" ]]; then
    export SIMONE_DATA_DIR="$PWD/.sandbox"
    mkdir -p "$SIMONE_DATA_DIR"
    echo "Using the sandbox data folder $SIMONE_DATA_DIR"
fi

exec npm run dev
