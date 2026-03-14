#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$(mktemp -d "/tmp/cms-storage-maintenance-build.XXXXXX")"

cleanup() {
  if [[ "${CMS_STORAGE_SMOKE_KEEP_BUILD:-0}" != "1" ]]; then
    rm -rf "${BUILD_DIR}"
  fi
}
trap cleanup EXIT

echo "[smoke] build dir: ${BUILD_DIR}"
cd "${ROOT_DIR}"
export NODE_PATH="${ROOT_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"

npx tsc \
  --pretty false \
  --target ES2022 \
  --module commonjs \
  --moduleResolution node \
  --esModuleInterop \
  --skipLibCheck \
  --outDir "${BUILD_DIR}" \
  scripts/storage-maintenance-smoke.ts \
  src/main/services/storageMaintenanceService.ts

node "${BUILD_DIR}/scripts/storage-maintenance-smoke.js"
