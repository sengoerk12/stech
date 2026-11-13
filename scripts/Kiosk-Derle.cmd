@echo off
setlocal
rem S TECH kiosk: kaynaklari derleme klasorune kopyalar ve kiosk.exe uretir.
set "SRC=%~dp0.."
set "WORK=%SRC%\kiosk"
if exist "%WORK%\node_modules\electron-builder" goto build
set "WORK=D:\stech-build-cache\project\kiosk"
if not exist "D:\stech-build-cache\project" (
  echo Derleme klasoru bulunamadi: D:\stech-build-cache\project
  echo kiosk klasorunde "npm ci" calistirip bu dosyayi yeniden ac.
  pause
  exit /b 1
)
robocopy "%SRC%\kiosk" "%WORK%" /E /XD node_modules dist /NFL /NDL /NJH /NJS >nul
if errorlevel 8 (
  echo Kaynaklar kopyalanamadi.
  pause
  exit /b 1
)
if not exist "%WORK%\node_modules\electron-builder" (
  echo Bagimliliklar kuruluyor...
  pushd "%WORK%"
  call npm ci
  popd
  if errorlevel 1 (
    echo npm ci basarisiz oldu.
    pause
    exit /b 1
  )
)
:build
pushd "%WORK%"
echo Testler calisiyor...
call npm test
if errorlevel 1 (
  echo Testler basarisiz; derleme yapilmadi.
  popd
  pause
  exit /b 1
)
echo kiosk.exe derleniyor: %WORK%
call npm run build:win
if errorlevel 1 (
  echo Derleme basarisiz oldu.
  popd
  pause
  exit /b 1
)
popd
if /i not "%WORK%"=="%SRC%\kiosk" (
  if not exist "%SRC%\kiosk\dist" mkdir "%SRC%\kiosk\dist"
  copy /y "%WORK%\dist\kiosk.exe" "%SRC%\kiosk\dist\kiosk.exe" >nul
  if errorlevel 1 (
    echo UYARI: %SRC%\kiosk\dist\kiosk.exe guncellenemedi. Acik kiosku kapatip bu dosyayi yeniden calistir.
  ) else (
    echo Guncellendi: %SRC%\kiosk\dist\kiosk.exe
  )
)
echo.
echo Hazir: %WORK%\dist\kiosk.exe
echo Onizleme icin: "%WORK%\dist\kiosk.exe" --portrait-preview
explorer "%WORK%\dist"
pause
