# Shared by launch.ps1, install.ps1 and uninstall.ps1: the game's name, where it keeps its data,
# and which browser runs it. The game is one HTML file that draws with WebGPU, so it runs in a
# Chrome or Edge "app" window (no tabs, no address bar). Both have WebGPU on Windows since version 113.

$GameName = 'Uno with a Ladder - DB5 Edition'
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set.' }
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\$GameName"
$DataDir    = Join-Path $env:LOCALAPPDATA $GameName      # browser profile: settings, chosen car, best laps
$UninstKey  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\UnoWithALadderDB5'

function Find-Browser {
    $c = @()
    foreach ($exe in 'chrome.exe', 'msedge.exe') {
        foreach ($hive in 'HKCU:', 'HKLM:') {
            try {
                $p = (Get-ItemProperty "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction Stop).'(default)'
                if ($p) { $c += $p.Trim('"') }
            } catch { }
        }
    }
    $c += "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    $c += "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    $c += "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    $c += "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    $c += "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    foreach ($p in $c) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
    return $null
}

# Command line for the browser: the game page as an app window, with its own profile so the game
# keeps its settings apart from your normal browsing and always gets the same flags.
function Get-GameArgs([string]$Root) {
    $url  = ([System.Uri](Join-Path $Root 'game\index.html')).AbsoluteUri
    $prof = Join-Path $DataDir 'browser-profile'
    return "--app=`"$url`" --user-data-dir=`"$prof`" --no-first-run --no-default-browser-check " +
           "--autoplay-policy=no-user-gesture-required --start-maximized"
}

function Show-Message([string]$Text, [string]$Icon = 'Information') {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show($Text, $GameName, 'OK', $Icon)
}

$NoBrowserText = "This game needs Google Chrome or Microsoft Edge (version 113 or newer) for WebGPU.`n" +
                 "Install or update one of them, then try again."
