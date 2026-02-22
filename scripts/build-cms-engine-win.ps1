$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RealEsrganExecutable {
  param(
    [Parameter(Mandatory = $true)][string]$SearchRoot
  )

  return Get-ChildItem -Path $SearchRoot -Recurse -Filter "realesrgan-ncnn-vulkan.exe" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
$pythonExecutable = ""
$pythonPrefix = @()
if ($pythonCommand) {
  $pythonExecutable = $pythonCommand.Source
  $pythonPrefix = @("-3")
} else {
  $pythonExecutable = (Get-Command python -ErrorAction Stop).Source
}

Write-Host "[build:win] Using Python: $pythonExecutable $($pythonPrefix -join ' ')"

& $pythonExecutable @pythonPrefix -m pip install --upgrade pyinstaller | Out-Null

$cleanupTargets = @(
  (Join-Path $repoRoot "build/pyinstaller"),
  (Join-Path $repoRoot "build/pyinstaller-config"),
  (Join-Path $repoRoot "dist/cms_engine.exe")
)

foreach ($target in $cleanupTargets) {
  if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
  }
}

$env:PYINSTALLER_CONFIG_DIR = Join-Path $repoRoot "build/pyinstaller-config"

& $pythonExecutable @pythonPrefix -m PyInstaller `
  --name cms_engine `
  --onefile `
  --noconfirm `
  --collect-all iopaint `
  --hidden-import cv2 `
  --hidden-import numpy `
  --add-data "python/models;models" `
  --distpath dist `
  --workpath build/pyinstaller `
  python/cms_engine.py

$enginePath = Join-Path $repoRoot "dist/cms_engine.exe"
if (-not (Test-Path $enginePath)) {
  throw "Missing dist/cms_engine.exe"
}

$realEsrganDir = Join-Path $repoRoot "AI_Tools/realesrgan-ncnn-vulkan-20220424-windows"
$realEsrganExe = Join-Path $realEsrganDir "realesrgan-ncnn-vulkan.exe"

if (-not (Test-Path $realEsrganExe)) {
  $downloadUrl = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip"
  $archivePath = Join-Path $env:TEMP "realesrgan-ncnn-vulkan-20220424-windows.zip"
  $extractRoot = Join-Path $repoRoot "AI_Tools"

  Write-Host "[build:win] Downloading Real-ESRGAN Windows bundle..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath

  if (Test-Path $realEsrganDir) {
    Remove-Item -Recurse -Force $realEsrganDir
  }

  Expand-Archive -Path $archivePath -DestinationPath $extractRoot -Force
}

if (-not (Test-Path $realEsrganExe)) {
  $discoveredExe = Resolve-RealEsrganExecutable -SearchRoot (Join-Path $repoRoot "AI_Tools")
  if ($discoveredExe) {
    $sourceDir = Split-Path -Parent $discoveredExe.FullName
    if ($sourceDir -and $sourceDir -ne $realEsrganDir) {
      if (Test-Path $realEsrganDir) {
        Remove-Item -Recurse -Force $realEsrganDir
      }
      New-Item -ItemType Directory -Path $realEsrganDir -Force | Out-Null
      Copy-Item -Path (Join-Path $sourceDir "*") -Destination $realEsrganDir -Recurse -Force
    }
  }
}

if (-not (Test-Path $realEsrganExe)) {
  throw "Missing Real-ESRGAN executable: $realEsrganExe"
}

Write-Host "[build:win] Built dist/cms_engine.exe and prepared Real-ESRGAN resources."
