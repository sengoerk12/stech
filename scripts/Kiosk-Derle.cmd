@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0build-kiosk.ps1"
pause
