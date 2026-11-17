# Installs the game for the current Windows user. No admin rights are needed.
#   files      -> %LOCALAPPDATA%\Programs\Uno with a Ladder - DB5 Edition
#   shortcuts  -> desktop and Start menu, with the DB5 icon
#   uninstall  -> Settings > Apps > Installed apps (or Uninstall.cmd in the install folder)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$src = Split-Path -Parent $PSScriptRoot
Write-Host "Installing $GameName ..."

$browser = Find-Browser
if (-not $browser) { Show-Message $NoBrowserText 'Error'; exit 1 }

# Copy the files (skipped when the installer is run from the install folder itself).
if ((Resolve-Path -LiteralPath $src).Path.TrimEnd('\') -ne $InstallDir.TrimEnd('\')) {
    if (Test-Path -LiteralPath $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path (Join-Path $src '*') -Destination $InstallDir -Recurse -Force
}
# Files extracted from a downloaded zip carry the "came from the internet" mark: clear it.
Get-ChildItem -LiteralPath $InstallDir -Recurse -File | Unblock-File

# Desktop and Start-menu shortcuts that open the game window directly.
$icon = Join-Path $InstallDir 'DB5.ico'
$gameArgs = Get-GameArgs $InstallDir
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
    $lnk = $shell.CreateShortcut((Join-Path $folder "$GameName.lnk"))
    $lnk.TargetPath = $browser
    $lnk.Arguments = $gameArgs
    $lnk.WorkingDirectory = $InstallDir
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = 'Aston Martin DB5 racing game'
    $lnk.Save()
}

# Entry in Settings > Apps so it can be removed like any other program.
New-Item -Path $UninstKey -Force | Out-Null
$strings = @{
    DisplayName     = $GameName
    DisplayIcon     = $icon
    DisplayVersion  = '1.0'
    Publisher       = 'Uno with a Ladder'
    InstallLocation = $InstallDir
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\scripts\uninstall.ps1`""
}
foreach ($k in $strings.Keys) { New-ItemProperty -Path $UninstKey -Name $k -Value $strings[$k] -PropertyType String -Force | Out-Null }
$kb = [int]((Get-ChildItem -LiteralPath $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
New-ItemProperty -Path $UninstKey -Name EstimatedSize -Value $kb -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $UninstKey -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $UninstKey -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

Write-Host ''
Write-Host "Installed. Next time, start it from the '$GameName' icon on your desktop or in the Start menu."
Write-Host 'Starting the game now...'
Start-Process -FilePath $browser -ArgumentList $gameArgs
