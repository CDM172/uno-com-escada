# Removes the game: its shortcuts, its Settings > Apps entry, its saved settings and its install folder.
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location -LiteralPath $env:TEMP

foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
    Remove-Item -LiteralPath (Join-Path $folder "$GameName.lnk") -Force -ErrorAction SilentlyContinue
}
Remove-Item -Path $UninstKey -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue

Show-Message "$GameName has been uninstalled."

# This script lives inside the install folder, so that folder is deleted a moment after it exits.
if (Test-Path -LiteralPath $InstallDir) {
    Start-Process -FilePath cmd.exe -WindowStyle Hidden -WorkingDirectory $env:TEMP `
        -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$InstallDir`""
}
