$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Push-Location $repoRoot
try {
  Write-Host "[build:win:engine] Using repo root: $repoRoot"

  py -3 -m pip install --upgrade pyinstaller

  if (Test-Path "build\pyinstaller") {
    Remove-Item "build\pyinstaller" -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path "dist\cms_engine.exe") {
    Remove-Item "dist\cms_engine.exe" -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path "dist\cms_engine") {
    Remove-Item "dist\cms_engine" -Force -ErrorAction SilentlyContinue
  }

  py -3 -m PyInstaller `
    --noconfirm `
    --distpath dist `
    --workpath build/pyinstaller `
    cms_engine.spec

  if (-not (Test-Path "dist\cms_engine.exe")) {
    throw "[build:win:engine] Missing dist\cms_engine.exe after build."
  }

  Write-Host "[build:win:engine] Built dist\cms_engine.exe"
}
finally {
  Pop-Location
}
