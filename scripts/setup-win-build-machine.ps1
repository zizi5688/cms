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

Require-Admin
Require-Winget

Install-WingetPackage -Id "Git.Git"
Install-WingetPackage -Id "OpenJS.NodeJS.LTS"
Install-WingetPackage -Id "Python.Python.3.10"
Install-WingetPackage -Id "Microsoft.VisualStudio.2022.BuildTools" -OverrideArgs "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

Ensure-Command -Name "git"
Ensure-Command -Name "node"
Ensure-Command -Name "npm"
Ensure-Command -Name "py"

Write-Host "[setup] Tool versions:"
& git --version
& node -v
& npm -v
& py -3.10 --version

$repoPath = Join-Path $WorkspaceRoot $RepoDirName
if (-not (Test-Path $WorkspaceRoot)) {
  New-Item -ItemType Directory -Path $WorkspaceRoot -Force | Out-Null
}

if (-not (Test-Path $repoPath)) {
  Write-Host "[setup] Cloning repo to $repoPath ..."
  & git clone $RepoUrl $repoPath
}

Set-Location $repoPath
Write-Host "[setup] Syncing branch $RepoBranch ..."
& git fetch --all
& git switch $RepoBranch
& git pull --ff-only origin $RepoBranch

Write-Host "[setup] Installing Python build dependencies ..."
& py -3.10 -m pip install --upgrade pip setuptools wheel
& py -3.10 -m pip install pyinstaller iopaint opencv-python numpy

Write-Host "[setup] Installing Node dependencies ..."
& npm ci

if (-not $SkipBuild) {
  Write-Host "[setup] Building Windows installer ..."
  & npm run build:win
  Write-Host "[setup] Build done. Installer is under: $repoPath\release"
} else {
  Write-Host "[setup] Build skipped. Run 'npm run build:win' manually later."
}
