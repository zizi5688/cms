param(
  [string]$WorkspaceRoot = "C:\build",
  [string]$RepoUrl = "https://github.com/zizi5688/cms.git",
  [string]$RepoBranch = "main",
  [string]$RepoDirName = "CMS-2.0",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script in an elevated PowerShell window (Run as Administrator)."
  }
}

function Require-Winget {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is missing. Install 'App Installer' from Microsoft Store first."
  }
}

function Install-WingetPackage {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [string]$OverrideArgs = ""
  )

  Write-Host "[setup] Installing $Id ..."
  $args = @(
    "install",
    "--id", $Id,
    "-e",
    "--source", "winget",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )
  if ($OverrideArgs) {
    $args += @("--override", $OverrideArgs)
  }
  & winget @args
}

function Ensure-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command not found after installation: $Name"
  }
}

function Resolve-CommandPath {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string[]]$Candidates = @()
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command -and $command.Source) {
    return $command.Source
  }

  foreach ($candidate in $Candidates) {
    if (-not $candidate) { continue }
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Command not found after installation: $Name"
}

Require-Admin
Require-Winget

Install-WingetPackage -Id "Git.Git"
Install-WingetPackage -Id "OpenJS.NodeJS.LTS"
Install-WingetPackage -Id "Python.Python.3.10"
Install-WingetPackage -Id "Microsoft.VisualStudio.2022.BuildTools" -OverrideArgs "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

$gitCmd = Resolve-CommandPath -Name "git" -Candidates @(
  "C:\Program Files\Git\cmd\git.exe"
)
$nodeCmd = Resolve-CommandPath -Name "node" -Candidates @(
  "C:\Program Files\nodejs\node.exe",
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
  "C:\Program Files (x86)\nodejs\node.exe"
)
$npmCmd = Resolve-CommandPath -Name "npm" -Candidates @(
  "C:\Program Files\nodejs\npm.cmd",
  "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd",
  "C:\Program Files (x86)\nodejs\npm.cmd"
)
$pyCmd = Resolve-CommandPath -Name "py" -Candidates @(
  "C:\Windows\py.exe",
  "$env:LOCALAPPDATA\Programs\Python\Launcher\py.exe"
)

Write-Host "[setup] Tool versions:"
& $gitCmd --version
& $nodeCmd -v
& $npmCmd -v
& $pyCmd -3.10 --version

$repoPath = Join-Path $WorkspaceRoot $RepoDirName
if (-not (Test-Path $WorkspaceRoot)) {
  New-Item -ItemType Directory -Path $WorkspaceRoot -Force | Out-Null
}

if (-not (Test-Path $repoPath)) {
  Write-Host "[setup] Cloning repo to $repoPath ..."
  & $gitCmd clone $RepoUrl $repoPath
}

Set-Location $repoPath
Write-Host "[setup] Syncing branch $RepoBranch ..."
& $gitCmd fetch --all
& $gitCmd switch $RepoBranch
& $gitCmd pull --ff-only origin $RepoBranch

Write-Host "[setup] Installing Python build dependencies ..."
& $pyCmd -3.10 -m pip install --upgrade pip setuptools wheel
& $pyCmd -3.10 -m pip install pyinstaller iopaint opencv-python numpy

Write-Host "[setup] Installing Node dependencies ..."
& $npmCmd ci
if ($LASTEXITCODE -ne 0) {
  throw "npm ci failed with exit code $LASTEXITCODE"
}

if (-not $SkipBuild) {
  Write-Host "[setup] Building Windows installer ..."
  & $npmCmd run build:win
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build:win failed with exit code $LASTEXITCODE"
  }
  Write-Host "[setup] Build done. Installer is under: $repoPath\release"
} else {
  Write-Host "[setup] Build skipped. Run 'npm run build:win' manually later."
}
