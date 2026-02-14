#!/usr/bin/env bash
set -euo pipefail

python3 -m pip install --upgrade pyinstaller >/dev/null

rm -rf build/pyinstaller dist/cms_engine dist/cms_engine.app build/pyinstaller-config 2>/dev/null || true

export PYINSTALLER_CONFIG_DIR="$PWD/build/pyinstaller-config"

python3 -m PyInstaller \
  --name cms_engine \
  --onefile \
  --noconfirm \
  --collect-all iopaint \
  --hidden-import cv2 \
  --hidden-import numpy \
  --add-data "python/models:models" \
  --distpath dist \
  --workpath build/pyinstaller \
  python/cms_engine.py

if [[ ! -f "dist/cms_engine" ]]; then
  echo "Missing dist/cms_engine"
  exit 1
fi

echo "Built dist/cms_engine"
