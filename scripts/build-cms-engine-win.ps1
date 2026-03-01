$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

function Invoke-CmsPython {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  if ($env:CMS_ENGINE_PYTHON -and $env:CMS_ENGINE_PYTHON.Trim()) {
    & $env:CMS_ENGINE_PYTHON @Args
    return $LASTEXITCODE
  }

  $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCmd) {
    & python @Args
    return $LASTEXITCODE
  }

  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd) {
    & py -3.10 @Args
    if ($LASTEXITCODE -eq 0) {
      return 0
    }
    & py -3 @Args
    return $LASTEXITCODE
  }

  throw "[build:win:engine] Python runtime not found. Install Python 3 first."
}

function Ensure-CmsEnginePythonDeps {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $requirementsPath = Join-Path $RepoRoot "scripts\cms-engine-requirements.txt"
  if (-not (Test-Path $requirementsPath)) {
    throw "[build:win:engine] Missing requirements file: $requirementsPath"
  }

  $pythonInfoExit = Invoke-CmsPython -Args @(
    "-c",
    "import sys; print('[build:win:engine] Python executable:', sys.executable); print('[build:win:engine] Python version:', sys.version)"
  )
  if ($pythonInfoExit -ne 0) {
    throw "[build:win:engine] Failed to inspect Python runtime."
  }

  $importCheckCode = "import cv2, numpy, iopaint, PyInstaller; print('cms-engine-pydeps-ok')"
  $precheckExit = Invoke-CmsPython -Args @("-c", $importCheckCode)
  if ($precheckExit -eq 0) {
    Write-Host "[build:win:engine] Python deps already ready (cv2/numpy/iopaint/pyinstaller)."
    return
  }

  Write-Host "[build:win:engine] Installing Python deps for cms_engine..."
  $pipUpgradeExit = Invoke-CmsPython -Args @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")
  if ($pipUpgradeExit -ne 0) {
    Write-Warning "[build:win:engine] Failed to upgrade pip/setuptools/wheel, continue with requirement install."
  }

  $installExit = Invoke-CmsPython -Args @("-m", "pip", "install", "--prefer-binary", "-r", $requirementsPath)
  if ($installExit -ne 0) {
    Write-Warning "[build:win:engine] First requirements install failed, retry with --upgrade."
    $installExit = Invoke-CmsPython -Args @("-m", "pip", "install", "--prefer-binary", "--upgrade", "-r", $requirementsPath)
  }
  if ($installExit -ne 0) {
    throw "[build:win:engine] Failed to install cms_engine Python dependencies."
  }

  $postcheckExit = Invoke-CmsPython -Args @("-c", $importCheckCode)
  if ($postcheckExit -ne 0) {
    throw "[build:win:engine] Python dependency check failed after install (cv2/numpy/iopaint/pyinstaller)."
  }
}

Push-Location $repoRoot
try {
  Write-Host "[build:win:engine] Using repo root: $repoRoot"
  Ensure-CmsEnginePythonDeps -RepoRoot $repoRoot

  if (Test-Path "build\pyinstaller") {
    Remove-Item "build\pyinstaller" -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path "dist\cms_engine.exe") {
    Remove-Item "dist\cms_engine.exe" -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path "dist\cms_engine") {
    Remove-Item "dist\cms_engine" -Force -ErrorAction SilentlyContinue
  }

  $pyInstallerExit = Invoke-CmsPython -Args @(
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--distpath",
    "dist",
    "--workpath",
    "build/pyinstaller",
    "cms_engine.spec"
  )
  if ($pyInstallerExit -ne 0) {
    throw "[build:win:engine] PyInstaller build failed."
  }

  if (-not (Test-Path "dist\cms_engine.exe")) {
    throw "[build:win:engine] Missing dist\cms_engine.exe after build."
  }

  Write-Host "[build:win:engine] Built dist\cms_engine.exe"
}
finally {
  Pop-Location
}
