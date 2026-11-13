@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kopru-derle.ps1"
if errorlevel 1 pause
