$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

function Invoke-CmsPython {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  $attempts = @()
  if ($env:CMS_ENGINE_PYTHON -and $env:CMS_ENGINE_PYTHON.Trim()) {
    $attempts += @{ Name = "CMS_ENGINE_PYTHON"; Kind = "exe"; Value = $env:CMS_ENGINE_PYTHON.Trim() }
  }
  if ($env:pythonLocation -and $env:pythonLocation.Trim()) {
    $attempts += @{
      Name = "pythonLocation";
      Kind = "exe";
      Value = (Join-Path $env:pythonLocation.Trim() "python.exe")
    }
  }

  $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCmd) {
    $attempts += @{ Name = "python"; Kind = "exe"; Value = $pythonCmd.Source }
  }

  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd) {
    $attempts += @{ Name = "py-3.10"; Kind = "py310"; Value = "py" }
    $attempts += @{ Name = "py-3"; Kind = "py3"; Value = "py" }
  }

  if ($attempts.Count -eq 0) {
    throw "[build:win:engine] Python runtime not found. Install Python 3 first."
  }

  $lastExit = 1
  foreach ($attempt in $attempts) {
    try {
      Write-Host "[build:win:engine] Try Python via $($attempt.Name): $($attempt.Value)"
      $commandOutput = @()
      if ($attempt.Kind -eq "py310") {
        $commandOutput = @( & py -3.10 @Args 2>&1 )
      } elseif ($attempt.Kind -eq "py3") {
        $commandOutput = @( & py -3 @Args 2>&1 )
      } else {
        $commandOutput = @( & $attempt.Value @Args 2>&1 )
      }
      $exitCode = $LASTEXITCODE
      foreach ($line in $commandOutput) {
        Write-Host $line
      }
      if ($exitCode -eq 0) {
        return [int]0
      }
      $lastExit = $exitCode
      Write-Warning "[build:win:engine] Python attempt $($attempt.Name) exit=$exitCode"
    } catch {
      Write-Warning "[build:win:engine] Python attempt $($attempt.Name) failed: $($_.Exception.Message)"
      $lastExit = 1
    }
  }

  return [int]$lastExit
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

  [int]$pythonInfoExit = Invoke-CmsPython -Args @("-c", "import sys; print(sys.executable); print(sys.version)")
  if ($pythonInfoExit -ne 0) {
    Write-Warning "[build:win:engine] Failed to inspect Python runtime; continue with dependency install."
  }

  $importCheckCode = "import cv2, numpy, iopaint, PyInstaller; print('cms-engine-pydeps-ok')"
  [int]$precheckExit = Invoke-CmsPython -Args @("-c", $importCheckCode)
  if ($precheckExit -eq 0) {
    Write-Host "[build:win:engine] Python deps already ready (cv2/numpy/iopaint/pyinstaller)."
    return
  }

  Write-Host "[build:win:engine] Installing Python deps for cms_engine..."
  $pipLogPath = Join-Path $RepoRoot "build\pip-cms-engine.log"
  $pipLogDir = Split-Path -Parent $pipLogPath
  if ($pipLogDir -and -not (Test-Path $pipLogDir)) {
    New-Item -ItemType Directory -Path $pipLogDir -Force | Out-Null
  }
  if (Test-Path $pipLogPath) {
    Remove-Item $pipLogPath -Force -ErrorAction SilentlyContinue
  }

  [int]$installExit = Invoke-CmsPython -Args @(
    "-m",
    "pip",
    "install",
    "--prefer-binary",
    "--progress-bar",
    "off",
    "--disable-pip-version-check",
    "--log",
    $pipLogPath,
    "-r",
    $requirementsPath
  )
  if ($installExit -ne 0) {
    Write-Warning "[build:win:engine] First requirements install failed, retry with --upgrade."
    $installExit = [int](Invoke-CmsPython -Args @(
      "-m",
      "pip",
      "install",
      "--prefer-binary",
      "--progress-bar",
      "off",
      "--disable-pip-version-check",
      "--upgrade",
      "--log",
      $pipLogPath,
      "-r",
      $requirementsPath
    ))
  }
  if ($installExit -ne 0) {
    if (Test-Path $pipLogPath) {
      Write-Warning "[build:win:engine] pip log tail:"
      Get-Content $pipLogPath -Tail 120 | ForEach-Object { Write-Warning $_ }
    }
    throw "[build:win:engine] Failed to install cms_engine Python dependencies."
  }

  [int]$postcheckExit = Invoke-CmsPython -Args @("-c", $importCheckCode)
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

  [int]$pyInstallerExit = Invoke-CmsPython -Args @(
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
