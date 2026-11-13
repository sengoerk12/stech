@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kiosk-baslat.ps1"
if errorlevel 1 pause
