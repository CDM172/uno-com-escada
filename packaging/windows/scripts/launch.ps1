# Plays the game from the folder this script sits in (used by Play.cmd; nothing is installed).
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$root = Split-Path -Parent $PSScriptRoot
$browser = Find-Browser
if (-not $browser) { Show-Message $NoBrowserText 'Error'; exit 1 }
Start-Process -FilePath $browser -ArgumentList (Get-GameArgs $root)
