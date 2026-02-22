$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")

$enginePath = Join-Path $repoRoot "dist/cms_engine.exe"
if (-not (Test-Path $enginePath)) {
  throw "Missing dist/cms_engine.exe"
}

$realEsrganRoot = Join-Path $repoRoot "AI_Tools/realesrgan-ncnn-vulkan-20220424-windows"
$realEsrganExe = Join-Path $realEsrganRoot "realesrgan-ncnn-vulkan.exe"
$realEsrganModelBin = Join-Path $realEsrganRoot "models/realesrgan-x4plus.bin"
$realEsrganModelParam = Join-Path $realEsrganRoot "models/realesrgan-x4plus.param"

$required = @($realEsrganExe, $realEsrganModelBin, $realEsrganModelParam)
foreach ($path in $required) {
  if (-not (Test-Path $path)) {
    throw "Missing Real-ESRGAN resource: $path"
  }
}

Write-Host "[verify:win] OK: cms_engine.exe and Real-ESRGAN resources are ready."
