#!/usr/bin/env bash
set -euo pipefail

ENGINE_PATH="dist/cms_engine"

if [[ ! -f "${ENGINE_PATH}" ]]; then
  echo "[build:mac] Missing required bundled engine: ${ENGINE_PATH}" >&2
  echo "[build:mac] Run scripts/build-cms-engine-mac.sh before packaging." >&2
  exit 1
fi

if [[ ! -x "${ENGINE_PATH}" ]]; then
  echo "[build:mac] Engine exists but is not executable: ${ENGINE_PATH}" >&2
  exit 1
fi

echo "[build:mac] Verified bundled engine: ${ENGINE_PATH}"
