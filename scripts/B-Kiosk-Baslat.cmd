@echo off
setlocal
set "KIOSK_LOG_DIR=%LOCALAPPDATA%\STech-Kiosk"
if not exist "%KIOSK_LOG_DIR%\" mkdir "%KIOSK_LOG_DIR%"
set "KIOSK_START_LOG=%KIOSK_LOG_DIR%\baslatma.log"
>"%KIOSK_START_LOG%" echo [%DATE% %TIME%] S TECH kiosk baslatiliyor.

set "MISSING_FILE="
for %%F in (program\kiosk.exe program\ffmpeg.dll program\icudtl.dat program\resources.pak program\locales\en-US.pak program\resources\app.asar kiosk.config.json root.crt) do (
  if not exist "%~dp0%%F" set "MISSING_FILE=%%F"
)
if defined MISSING_FILE goto missing

set "STECH_KIOSK_CONFIG=%~dp0kiosk.config.json"
set "NODE_EXTRA_CA_CERTS=%~dp0root.crt"
powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference = 'Stop'; $s = Get-Content -LiteralPath $env:STECH_KIOSK_CONFIG -Raw | ConvertFrom-Json; $uri = [uri]$s.apiBaseUrl; if (!$uri.IsAbsoluteUri -or $uri.Scheme -ne 'https') { throw 'Kiosk sunucu adresi gecersiz.' }; if (!(Test-NetConnection -ComputerName $uri.Host -Port $uri.Port -InformationLevel Quiet -WarningAction SilentlyContinue)) { Write-Output ('Sunucuya ulasilamadi: ' + $uri.Host + ':' + $uri.Port); exit 1 }" >>"%KIOSK_START_LOG%" 2>&1
if errorlevel 1 (
  echo A bilgisayarindaki S TECH sunucusuna baglanilamadi veya kiosk ayari okunamadi.
  echo A'daki sunucuyu ve iki bilgisayarin ag baglantisini kontrol et.
  goto showLog
)

>>"%KIOSK_START_LOG%" echo [%DATE% %TIME%] Ag kontrolu tamam, kiosk.exe aciliyor.
start "" /wait /d "%~dp0program" "%~dp0program\kiosk.exe" --fullscreen --enable-logging=file --log-file="%KIOSK_LOG_DIR%\electron.log"
set "KIOSK_EXIT=%ERRORLEVEL%"
>>"%KIOSK_START_LOG%" echo [%DATE% %TIME%] Kiosk cikis kodu: %KIOSK_EXIT%
if "%KIOSK_EXIT%"=="0" exit /b 0
echo Kiosk acilirken hata verdi. Cikis kodu %KIOSK_EXIT%.
goto showLog

:missing
echo Eksik dosya %MISSING_FILE%
>>"%KIOSK_START_LOG%" echo Eksik dosya %MISSING_FILE%
echo Kiosk-2-Kurulum.zip dosyasinin tamamini yeni bir klasore cikart.

:showLog
type "%KIOSK_START_LOG%"
echo Gunluk dosyalari "%KIOSK_LOG_DIR%"
pause
exit /b 1
