@echo off
setlocal
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy RemoteSigned -File "%~dp0scripts\stech-baslat.ps1" %*
set "STECH_EXIT=%errorlevel%"
if not "%STECH_EXIT%"=="0" pause
exit /b %STECH_EXIT%
