#Requires -Version 5.1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw "pnpm is missing. Run .\INSTALL_PATCH.ps1 -BuildOnly first." }
if (-not (Test-Path ".\node_modules")) { throw "Dependencies are not installed. Run .\INSTALL_PATCH.ps1 -BuildOnly first." }
& dotnet build ".\apps\windows-bridge\Patch.WindowsBridge.csproj"
if ($LASTEXITCODE -ne 0) { throw "Windows bridge build failed." }
& pnpm --filter @patch/desktop dev
