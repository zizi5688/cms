#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: not a git repository: $repo_root"
  exit 1
fi

git config core.hooksPath .githooks
git config commit.template .gitmessage.txt
git config fetch.prune true

echo "Git governance bootstrap complete."
echo "core.hooksPath=$(git config --get core.hooksPath)"
echo "commit.template=$(git config --get commit.template)"
echo "fetch.prune=$(git config --get fetch.prune)"
