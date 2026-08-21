#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$SkipVerification,
  [switch]$BuildOnly,
  [switch]$DoNotLaunchInstaller
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Fail([string]$Message) { throw "PATCH setup failed: $Message" }
function Has-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Invoke-Checked([string]$Stage, [string]$Tool, [string[]]$Arguments, [string]$NextStep) {
  Write-Step $Stage
  & $Tool @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    Fail "$Stage failed. Tool: $Tool. Exit code: $exitCode. $NextStep"
  }
}

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Ensure-Winget {
  if (-not (Has-Command "winget")) {
    Fail "Windows Package Manager (winget) is required for automatic prerequisite installation. Install/repair 'App Installer' from Microsoft Store, then run this script again."
  }
}

function Install-OrUpgrade-WingetPackage([string]$Id, [string]$FriendlyName, [switch]$Upgrade) {
  Ensure-Winget
  if ($Upgrade) {
    Write-Step "Upgrading $FriendlyName"
    & winget upgrade --id $Id --exact --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[WARN] winget upgrade did not complete; trying install/repair for $FriendlyName." -ForegroundColor Yellow
      & winget install --id $Id --exact --accept-package-agreements --accept-source-agreements --silent
    }
  } else {
    Write-Step "Installing $FriendlyName"
    & winget install --id $Id --exact --accept-package-agreements --accept-source-agreements --silent
  }
  if ($LASTEXITCODE -ne 0) { Fail "winget could not install or upgrade $FriendlyName ($Id)." }
  Refresh-ProcessPath
}

function Parse-Version([string]$Raw) {
  $match = [regex]::Match($Raw, '(\d+)\.(\d+)\.(\d+)')
  if (-not $match.Success) { return [version]"0.0.0" }
  return [version]$match.Value
}

if ($env:OS -ne "Windows_NT") { Fail "This installer is Windows-only. PATCH v1 uses Windows UI Automation." }
if (-not [Environment]::Is64BitOperatingSystem) { Fail "PATCH v1 requires 64-bit Windows." }

$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Repo
Write-Host "PATCH - Fresh Windows Setup" -ForegroundColor White
Write-Host "Source: $Repo"

Write-Step "Checking Node.js"
if (-not (Has-Command "node")) { Install-OrUpgrade-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS" }
$nodeVersion = Parse-Version (& node --version)
if ($nodeVersion -lt [version]"22.16.0") {
  Install-OrUpgrade-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS" -Upgrade
  $nodeVersion = Parse-Version (& node --version)
}
if ($nodeVersion -lt [version]"22.16.0") { Fail "Node.js 22.16.0 or newer is required; found $nodeVersion." }
Write-Ok "Node.js $nodeVersion"

Write-Step "Checking .NET 8 SDK"
$hasDotNet8 = $false
if (Has-Command "dotnet") {
  $sdks = & dotnet --list-sdks 2>$null
  $hasDotNet8 = [bool]($sdks | Where-Object { $_ -match '^8\.' } | Select-Object -First 1)
}
if (-not $hasDotNet8) { Install-OrUpgrade-WingetPackage "Microsoft.DotNet.SDK.8" ".NET 8 SDK" }
if (-not (Has-Command "dotnet")) { Fail ".NET was installed but is not available in PATH. Restart the terminal and rerun INSTALL_PATCH.ps1." }
$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match '^8\.' } | Select-Object -First 1)) { Fail ".NET 8 SDK is required." }
Write-Ok ".NET 8 SDK available"

Write-Step "Installing pnpm 11.21.0"
$needPnpm = $true
if (Has-Command "pnpm") {
  try { $needPnpm = ((& pnpm --version).Trim() -ne "11.21.0") } catch { $needPnpm = $true }
}
if ($needPnpm) {
  & npm install --global pnpm@11.21.0
  if ($LASTEXITCODE -ne 0) { Fail "npm could not install pnpm 11.21.0." }
  Refresh-ProcessPath
}
if (-not (Has-Command "pnpm")) { Fail "pnpm is not available after installation. Restart the terminal and rerun this script." }
Write-Ok "pnpm $(& pnpm --version)"

if (Test-Path (Join-Path $Repo "pnpm-lock.yaml")) {
  Invoke-Checked "Installing PATCH dependencies" "pnpm" @("install", "--frozen-lockfile") "Review the dependency error above; PATCH should not require Visual Studio C++ for its shipped SQLite prebuild."
} else {
  Write-Host "[WARN] pnpm-lock.yaml is not present in this source archive; resolving the pinned package versions from package.json." -ForegroundColor Yellow
  Invoke-Checked "Installing PATCH dependencies" "pnpm" @("install", "--no-frozen-lockfile") "Review the dependency error above."
}
Invoke-Checked "Checking native SQLite under Node" "pnpm" @("--filter", "@patch/persistence", "smoke:native") "The bundled better-sqlite3 native binary did not load. Delete node_modules, reinstall, and report this exact smoke-test output."

if (-not $SkipVerification) {
  Invoke-Checked "Running source lint" "pnpm" @("lint") "Fix the reported source/security lint error before packaging."
  Invoke-Checked "Running TypeScript typecheck" "pnpm" @("typecheck") "Fix the reported strict TypeScript error before packaging."
  Invoke-Checked "Running unit tests" "pnpm" @("test") "Fix the failing regression test before packaging."
  Invoke-Checked "Building PATCH" "pnpm" @("build") "Fix the reported application build error before packaging."
  Invoke-Checked "Building Windows UI Automation bridge" "dotnet" @("build", ".\apps\windows-bridge\Patch.WindowsBridge.csproj", "-c", "Release") "Install/repair the .NET 8 SDK if the bridge cannot build."
  Write-Ok "Verification gate passed"
}

Invoke-Checked "Building self-contained PATCH Windows installer" "pnpm" @("package:win") "Packaging now resolves pnpm and Electron Builder through their JavaScript entry points; use the failing stage printed above to diagnose any remaining Windows-specific problem."

$installer = Get-ChildItem -LiteralPath (Join-Path $Repo "release") -Filter "PATCH-*-x64.exe" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) { Fail "Packaging completed but no PATCH x64 NSIS installer was found in release/." }
Write-Ok "Installer created: $($installer.FullName)"

if ($BuildOnly -or $DoNotLaunchInstaller) {
  Write-Host "`nPATCH is ready to install. Run:`n  $($installer.FullName)" -ForegroundColor Yellow
  exit 0
}

Write-Step "Launching PATCH installer"
Start-Process -FilePath $installer.FullName -Wait
Write-Host "`nPATCH installation flow finished. Launch PATCH from the Start menu or desktop shortcut." -ForegroundColor Green
Write-Host "The floating companion is enabled by default. Add an OpenAI or Gemini key later in PATCH Settings - AI & Adapters." -ForegroundColor DarkGray