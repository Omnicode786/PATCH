param(
  [Parameter(Mandatory=$true)][string]$ExtensionId,
  [Parameter(Mandatory=$true)][string]$BridgeExe,
  [ValidateSet("Chrome","Edge")][string]$Browser = "Chrome"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $BridgeExe -PathType Leaf)) { throw "PATCH Windows bridge executable not found: $BridgeExe" }
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "ExtensionId must be the 32-character Chromium extension ID." }
$installDir = Join-Path $env:LOCALAPPDATA "PATCH\NativeMessaging"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$manifestFile = if ($Browser -eq "Edge") { "com.patch.browser.edge.json" } else { "com.patch.browser.chrome.json" }
$manifestPath = Join-Path $installDir $manifestFile
$manifest = [ordered]@{
  name = "com.patch.browser"
  description = "PATCH Chrome native messaging bridge"
  path = (Resolve-Path -LiteralPath $BridgeExe).Path
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
$registryRoot = if ($Browser -eq "Edge") { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts" } else { "HKCU:\Software\Google\Chrome\NativeMessagingHosts" }
$key = Join-Path $registryRoot "com.patch.browser"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifestPath
Write-Host "Registered PATCH native messaging host for $Browser at $manifestPath"
