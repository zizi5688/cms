import argparse
import os
import shutil
import sys
import time
import uuid

import cv2
import numpy as np
from iopaint import entry_point

DEFAULT_X = 0.905
DEFAULT_Y = 0.927
DEFAULT_W = 0.055
DEFAULT_H = 0.05
DEVICE_CHOICES = ('cpu', 'cuda', 'mps')


def _resolve_default_device() -> str:
  env_device = str(os.environ.get('CMS_ENGINE_DEVICE') or '').strip().lower()
  if env_device in DEVICE_CHOICES:
    return env_device
  if env_device:
    print(f"[cms_engine] Ignore invalid CMS_ENGINE_DEVICE={env_device}, fallback to platform default.")
  return 'mps' if sys.platform == 'darwin' else 'cpu'


def _normalize_device(device: str) -> str:
  normalized = str(device or '').strip().lower()
  if normalized not in DEVICE_CHOICES:
    return _resolve_default_device()
  if normalized == 'mps' and sys.platform != 'darwin':
    print('[cms_engine] mps is only supported on macOS, fallback to cpu.')
    return 'cpu'
  return normalized


def _get_model_dir() -> str | None:
  env = os.environ.get('CMS_ENGINE_MODEL_DIR')
  if env and env.strip() and os.path.isdir(env.strip()):
    return env.strip()

  def has_files(folder: str) -> bool:
    try:
      with os.scandir(folder) as it:
        for entry in it:
          if entry.name.startswith('.'):
            continue
          return True
    except Exception:
      return False
    return False

  meipass = getattr(sys, '_MEIPASS', None)
  if isinstance(meipass, str) and meipass:
    candidate = os.path.join(meipass, 'models')
    if os.path.isdir(candidate) and has_files(candidate):
      return candidate

  here = os.path.dirname(os.path.abspath(__file__))
  candidate = os.path.join(here, 'models')
  if os.path.isdir(candidate) and has_files(candidate):
    return candidate

  return None


def _run_iopaint(image_path: str, mask_path: str, output_dir: str, device: str, model_dir: str | None) -> int:
  argv = [
    'iopaint',
    'run',
    '--model',
    'lama',
    '--device',
    device,
    '--image',
    image_path,
    '--mask',
    mask_path,
    '--output',
    output_dir
  ]
  if model_dir:
    argv.extend(['--model-dir', model_dir])

  previous = sys.argv
  sys.argv = argv
  try:
    entry_point()
    return 0
  except SystemExit as e:
    code = e.code
    return int(code) if isinstance(code, int) else 1
  finally:
    sys.argv = previous


def _parse_box_args(value: str | None) -> tuple[float, float, float, float]:
  if not value:
    return DEFAULT_X, DEFAULT_Y, DEFAULT_W, DEFAULT_H
  raw = value.strip()
  if not raw or raw == 'None':
    return DEFAULT_X, DEFAULT_Y, DEFAULT_W, DEFAULT_H

  try:
    parts = [float(p) for p in raw.split(',')]
  except ValueError:
    return DEFAULT_X, DEFAULT_Y, DEFAULT_W, DEFAULT_H

  if len(parts) != 4:
    return DEFAULT_X, DEFAULT_Y, DEFAULT_W, DEFAULT_H

  return parts[0], parts[1], parts[2], parts[3]


def process_image(input_path: str, output_path: str, box_args: str | None, device: str) -> bool:
  input_path = os.path.abspath(input_path)
  output_path = os.path.abspath(output_path)
  if not os.path.exists(input_path):
    print(f'Error: Input file not found: {input_path}')
    return False

  base_dir = os.path.dirname(input_path)
  unique_id = str(uuid.uuid4())
  temp_work_dir = os.path.join(base_dir, f'temp_iopaint_{unique_id}')
  mask_path = os.path.join(base_dir, f'cms_mask_{unique_id}.png')

  try:
    os.makedirs(temp_work_dir, exist_ok=True)

    img = cv2.imread(input_path)
    if img is None:
      print('Error: Cannot read image.')
      return False

    h, w = img.shape[:2]
    x_ratio, y_ratio, w_ratio, h_ratio = _parse_box_args(box_args)

    x_start = int(w * x_ratio)
    y_start = int(h * y_ratio)
    mask_w = int(w * w_ratio)
    mask_h = int(h * h_ratio)

    x_end = min(max(0, x_start) + max(0, mask_w), w)
    y_end = min(max(0, y_start) + max(0, mask_h), h)
    x_start = max(0, min(x_start, w - 1))
    y_start = max(0, min(y_start, h - 1))

    mask = np.zeros((h, w), dtype=np.uint8)
    mask[y_start:y_end, x_start:x_end] = 255
    cv2.imwrite(mask_path, mask)
    time.sleep(0.05)

    model_dir = _get_model_dir()
    exit_code = _run_iopaint(input_path, mask_path, temp_work_dir, device, model_dir)
    if exit_code != 0:
      print(f'IOPaint Error: exit={exit_code}')
      return False

    generated_files = [f for f in os.listdir(temp_work_dir) if not f.startswith('.')]
    if not generated_files:
      print('Error: Output file missing.')
      return False

    result_file = os.path.join(temp_work_dir, generated_files[0])
    if os.path.exists(output_path):
      os.remove(output_path)
    shutil.move(result_file, output_path)

    thumb_path = os.path.splitext(output_path)[0] + '_thumb.jpg'
    final_img = cv2.imread(output_path)
    if final_img is not None and final_img.shape[1] > 0:
      scale = 400 / final_img.shape[1]
      dim = (400, max(1, int(final_img.shape[0] * scale)))
      thumb_img = cv2.resize(final_img, dim, interpolation=cv2.INTER_AREA)
      cv2.imwrite(thumb_path, thumb_img, [int(cv2.IMWRITE_JPEG_QUALITY), 70])

    print(f'Success: {output_path}')
    return True
  except Exception as e:
    print(f'Error: {str(e)}')
    return False
  finally:
    if os.path.exists(mask_path):
      try:
        os.remove(mask_path)
      except Exception:
        pass
    shutil.rmtree(temp_work_dir, ignore_errors=True)


def main() -> int:
  default_device = _resolve_default_device()
  parser = argparse.ArgumentParser()
  parser.add_argument('-i', '--input', required=True)
  parser.add_argument('-o', '--output', required=True)
  parser.add_argument('--box', default='')
  parser.add_argument('--device', default=default_device, choices=list(DEVICE_CHOICES))

  args = parser.parse_args()
  selected_device = _normalize_device(args.device)
  ok = process_image(args.input, args.output, args.box, selected_device)
  return 0 if ok else 1


if __name__ == '__main__':
  raise SystemExit(main())
