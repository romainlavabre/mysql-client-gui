#!/usr/bin/env bash
# Starts the app in development mode (hot reload of the interface).
#
#   ./run.sh             normal data folder (~/.config/mysql-client-gui)
#   ./run.sh --sandbox   throwaway data folder in .sandbox/, to try things safely
set -euo pipefail

cd "$(dirname "$0")"

[[ -d node_modules ]] || npm install

if [[ "${1:-}" == "--sandbox" ]]; then
    export MYSQL_CLIENT_GUI_DATA_DIR="$PWD/.sandbox"
    mkdir -p "$MYSQL_CLIENT_GUI_DATA_DIR"
    echo "Using the sandbox data folder $MYSQL_CLIENT_GUI_DATA_DIR"
fi

exec npm run dev
