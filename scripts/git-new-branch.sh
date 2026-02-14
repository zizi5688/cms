#!/usr/bin/env bash
set -euo pipefail

raw="${1:-}"
if [[ -z "$raw" ]]; then
  echo "Usage: scripts/git-new-branch.sh <scope-goal>"
  echo "Example: scripts/git-new-branch.sh preview-thumb-pipeline"
  exit 1
fi

slug="$(printf '%s' "$raw" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"

if [[ -z "$slug" ]]; then
  echo "Error: branch name became empty after normalization."
  exit 1
fi

branch="codex/$slug"
current="$(git branch --show-current)"
if [[ "$current" == "$branch" ]]; then
  echo "Already on $branch"
  exit 0
fi

git checkout -b "$branch"
echo "Switched to $branch"
