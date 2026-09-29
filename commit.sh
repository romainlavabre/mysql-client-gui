#!/usr/bin/env bash
# Stages everything, commits with the given message and pushes.
#
#   ./commit.sh "Fix the table view pagination"
set -euo pipefail

cd "$(dirname "$0")"

[[ -n "${1:-}" ]] || { echo "usage: ./commit.sh \"commit message\"" >&2; exit 1; }

git add .
git commit -m "$1"
git push
