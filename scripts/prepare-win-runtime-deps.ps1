$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-MzHeader {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) { return $false }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 2) { return $false }
  return ($bytes[0] -eq 0x4D -and $bytes[1] -eq 0x5A)
}

function Test-NonEmptyFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) { return $false }
  $item = Get-Item $Path
  if ($item.PSIsContainer) { return $false }
  return $item.Length -gt 0
}

function Ensure-CmsEngine {
  param([string]$RepoRoot)

  $engineExe = Join-Path $RepoRoot "dist\cms_engine.exe"
  if ((Test-Path $engineExe) -and (Test-MzHeader -Path $engineExe)) {
    Write-Host "[prepare:win:deps] cms_engine.exe ready: $engineExe"
    return
  }

  Write-Host "[prepare:win:deps] cms_engine.exe missing/invalid, building..."
  & powershell -ExecutionPolicy Bypass -File (Join-Path $RepoRoot "scripts\build-cms-engine-win.ps1")

  if (-not (Test-Path $engineExe)) {
    throw "[prepare:win:deps] Missing dist\cms_engine.exe after build."
  }
  if (-not (Test-MzHeader -Path $engineExe)) {
    throw "[prepare:win:deps] dist\cms_engine.exe is not a Windows executable (MZ)."
  }
}

function Ensure-RealEsrgan {
  param([string]$RepoRoot)

  $targetDir = Join-Path $RepoRoot "dist\realesrgan"
  $targetExe = Join-Path $targetDir "realesrgan-ncnn-vulkan.exe"
  $requiredModelFiles = @(
    "models\realesrgan-x4plus.param",
    "models\realesrgan-x4plus.bin"
  )

  $hasModels = $true
  foreach ($rel in $requiredModelFiles) {
    if (-not (Test-NonEmptyFile -Path (Join-Path $targetDir $rel))) {
      $hasModels = $false
      break
    }
  }

  if ((Test-Path $targetExe) -and (Test-MzHeader -Path $targetExe) -and $hasModels) {
    Write-Host "[prepare:win:deps] Real-ESRGAN bundle ready: $targetDir"
    return
  }

  $localCandidates = @(
    (Join-Path $RepoRoot "AI_Tools\realesrgan-ncnn-vulkan-20220424-windows"),
    (Join-Path $RepoRoot "AI_Tools\realesrgan-ncnn-vulkan-windows")
  )

  $sourceDir = $null
  foreach ($candidate in $localCandidates) {
    $candidateExe = Join-Path $candidate "realesrgan-ncnn-vulkan.exe"
    if ((Test-Path $candidateExe) -and (Test-MzHeader -Path $candidateExe)) {
      $sourceDir = $candidate
      break
    }
  }

  if (-not $sourceDir) {
    $url = if ($env:REALESRGAN_WIN_URL) {
      $env:REALESRGAN_WIN_URL
    } else {
      "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip"
    }

    $tmpRoot = Join-Path $env:TEMP ("realesrgan-" + [guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $tmpRoot "realesrgan-win.zip"
    $extractDir = Join-Path $tmpRoot "extract"
    New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    Write-Host "[prepare:win:deps] Downloading Real-ESRGAN from: $url"
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    $foundExe = Get-ChildItem -Path $extractDir -Recurse -File -Filter "realesrgan-ncnn-vulkan.exe" |
      Select-Object -First 1
    if (-not $foundExe) {
      throw "[prepare:win:deps] Downloaded archive does not contain realesrgan-ncnn-vulkan.exe"
    }

    $sourceDir = $foundExe.DirectoryName
  }

  if (Test-Path $targetDir) {
    Remove-Item $targetDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Copy-Item (Join-Path $sourceDir "*") $targetDir -Recurse -Force

  if (-not (Test-Path $targetExe)) {
    throw "[prepare:win:deps] Missing bundled Real-ESRGAN exe: $targetExe"
  }
  if (-not (Test-MzHeader -Path $targetExe)) {
    throw "[prepare:win:deps] Real-ESRGAN exe is not a Windows executable (MZ): $targetExe"
  }

  foreach ($rel in $requiredModelFiles) {
    $fullPath = Join-Path $targetDir $rel
    if (-not (Test-NonEmptyFile -Path $fullPath)) {
      throw "[prepare:win:deps] Missing or empty Real-ESRGAN model file: $fullPath"
    }
  }

  Write-Host "[prepare:win:deps] Real-ESRGAN bundle prepared: $targetDir"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Push-Location $repoRoot
try {
  if (-not (Test-Path "dist")) {
    New-Item -ItemType Directory -Path "dist" -Force | Out-Null
  }

  Ensure-CmsEngine -RepoRoot $repoRoot
  Ensure-RealEsrgan -RepoRoot $repoRoot
  Write-Host "[prepare:win:deps] Done."
}
finally {
  Pop-Location
}
