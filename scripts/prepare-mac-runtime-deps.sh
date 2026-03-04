#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist/realesrgan"

if [[ -n "${REALESRGAN_MAC_DIR:-}" ]]; then
  SOURCE_DIR="${REALESRGAN_MAC_DIR}"
else
  CANDIDATES=(
    "${REPO_ROOT}/AI_Tools/realesrgan-ncnn-vulkan-20220424-macos"
    "${REPO_ROOT}/AI_Tools/realesrgan-ncnn-vulkan-macos"
  )
  SOURCE_DIR=""
  for candidate in "${CANDIDATES[@]}"; do
    if [[ -f "${candidate}/realesrgan-ncnn-vulkan" ]]; then
      SOURCE_DIR="${candidate}"
      break
    fi
  done
fi

if [[ -z "${SOURCE_DIR:-}" ]]; then
  echo "[prepare:mac:deps] Cannot find Real-ESRGAN source dir." >&2
  echo "[prepare:mac:deps] Expected one of:" >&2
  echo "  - ${REPO_ROOT}/AI_Tools/realesrgan-ncnn-vulkan-20220424-macos" >&2
  echo "  - ${REPO_ROOT}/AI_Tools/realesrgan-ncnn-vulkan-macos" >&2
  echo "[prepare:mac:deps] Or set REALESRGAN_MAC_DIR=/absolute/path" >&2
  exit 1
fi

SOURCE_DIR="$(cd "${SOURCE_DIR}" && pwd)"
SOURCE_EXE="${SOURCE_DIR}/realesrgan-ncnn-vulkan"
SOURCE_MODELS_DIR="${SOURCE_DIR}/models"

if [[ ! -f "${SOURCE_EXE}" ]]; then
  echo "[prepare:mac:deps] Missing executable: ${SOURCE_EXE}" >&2
  exit 1
fi
if [[ ! -d "${SOURCE_MODELS_DIR}" ]]; then
  echo "[prepare:mac:deps] Missing models dir: ${SOURCE_MODELS_DIR}" >&2
  exit 1
fi

REQUIRED_MODELS=(
  "realesrgan-x4plus.param"
  "realesrgan-x4plus.bin"
)
for model in "${REQUIRED_MODELS[@]}"; do
  if [[ ! -s "${SOURCE_MODELS_DIR}/${model}" ]]; then
    echo "[prepare:mac:deps] Missing or empty model: ${SOURCE_MODELS_DIR}/${model}" >&2
    exit 1
  fi
done

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}/models"

cp "${SOURCE_EXE}" "${DIST_DIR}/realesrgan-ncnn-vulkan"
chmod +x "${DIST_DIR}/realesrgan-ncnn-vulkan"
cp "${SOURCE_MODELS_DIR}/realesrgan-x4plus.param" "${DIST_DIR}/models/realesrgan-x4plus.param"
cp "${SOURCE_MODELS_DIR}/realesrgan-x4plus.bin" "${DIST_DIR}/models/realesrgan-x4plus.bin"

if [[ ! -x "${DIST_DIR}/realesrgan-ncnn-vulkan" ]]; then
  echo "[prepare:mac:deps] Target executable is not executable: ${DIST_DIR}/realesrgan-ncnn-vulkan" >&2
  exit 1
fi

for model in "${REQUIRED_MODELS[@]}"; do
  if [[ ! -s "${DIST_DIR}/models/${model}" ]]; then
    echo "[prepare:mac:deps] Target model missing: ${DIST_DIR}/models/${model}" >&2
    exit 1
  fi
done

echo "[prepare:mac:deps] Real-ESRGAN bundle ready: ${DIST_DIR}"
