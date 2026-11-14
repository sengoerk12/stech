@echo off
setlocal
if not exist "%~dp0program\kiosk.exe" goto missing
if not exist "%~dp0program\resources\app.asar" goto missing
if not exist "%~dp0kiosk.config.json" goto missing
if not exist "%~dp0root.crt" goto missing
set "STECH_KIOSK_CONFIG=%~dp0kiosk.config.json"
set "NODE_EXTRA_CA_CERTS=%~dp0root.crt"
powershell.exe -NoLogo -NoProfile -Command "$s = Get-Content -LiteralPath $env:STECH_KIOSK_CONFIG -Raw | ConvertFrom-Json; if (!(Test-NetConnection -ComputerName ([uri]$s.apiBaseUrl).Host -Port 8443 -InformationLevel Quiet -WarningAction SilentlyContinue)) { exit 1 }"
if errorlevel 1 (
  echo A bilgisayarindaki S TECH sunucusuna baglanilamadi.
  echo A'da S-TECH-Baslat.cmd ile 2'yi sec ve iki bilgisayarin ayni agda oldugunu kontrol et.
  pause
  exit /b 1
)
start "" /D "%~dp0program" "%~dp0program\kiosk.exe" --fullscreen
exit /b 0
:missing
echo B-Kiosk.zip dosyasinin tamamini cikart ve Kiosk-Baslat.cmd dosyasini ac.
pause
exit /b 1
