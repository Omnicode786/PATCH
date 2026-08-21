$parts = Get-ChildItem -Path "$PSScriptRoot" -Filter "PATCH-0.1.1-x64.exe.part*" | Sort-Object Name
$dest = "$PSScriptRoot\PATCH-0.1.1-x64.exe"
if (Test-Path $dest) { Remove-Item $dest }
$outStream = [System.IO.File]::Create($dest)
foreach ($part in $parts) {
    $inStream = [System.IO.File]::OpenRead($part.FullName)
    $inStream.CopyTo($outStream)
    $inStream.Close()
}
$outStream.Close()
Write-Host "Successfully rebuilt PATCH-0.1.1-x64.exe!"
