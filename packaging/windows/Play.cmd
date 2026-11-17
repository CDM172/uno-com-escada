@echo off
rem Plays the game straight from this folder, without installing it.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\launch.ps1"
