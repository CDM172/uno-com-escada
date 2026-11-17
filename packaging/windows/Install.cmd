@echo off
rem Installs the game for this Windows user (no admin rights needed):
rem copies it to %LOCALAPPDATA%\Programs, adds desktop and Start-menu shortcuts and an entry in Settings > Apps.
title Uno with a Ladder - DB5 Edition - setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
echo.
pause
