param(
  [string]$LogPath = "$env:APPDATA\PATCH\logs\patch.jsonl"
)
$ErrorActionPreference = "Stop"
Write-Host "PATCH browser-agent Windows verification" -ForegroundColor Cyan
Write-Host "1. Open Chrome, load the PATCH extension, register native host, and keep a normal tab foreground."
Write-Host "2. Invoke PATCH and run: Remove the sidebar."
Write-Host "3. Confirm the reversible action if prompted, then test Undo."
Write-Host "4. Repeat on a YouTube watch page."

if (Test-Path $LogPath) {
  Write-Host "\nRecent browser-agent pipeline events:" -ForegroundColor Green
  Get-Content $LogPath -Tail 300 | Select-String -Pattern 'patch\.invocation\.capabilities|patch\.planner\.request|patch\.plan\.validated|patch\.action\.executed|patch\.action\.failed|BROWSER_|TOOL_NOT_ELIGIBLE|PLANNER_DID_NOT_RETURN_ACTION|VERIFICATION_FAILED' | Select-Object -Last 80
} else {
  Write-Warning "PATCH log was not found at $LogPath. Launch PATCH once, or pass -LogPath explicitly."
}
