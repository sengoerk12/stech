$ErrorActionPreference = 'Stop'
$kiosk = Split-Path $PSScriptRoot -Parent
$repo = Split-Path $kiosk -Parent
$electron = @(
    (Join-Path $kiosk 'node_modules/electron/dist/electron.exe')
    (Join-Path $repo 'node_modules/electron/dist/electron.exe')
    'D:/stech-build-cache/kiosk-campaign-sync/node_modules/electron/dist/electron.exe'
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (!$electron) { throw 'Electron bulunamadi. kiosk klasorunde npm ci calistirin.' }

$env:STECH_KIOSK_DATA_DIR = Join-Path $repo '.data/kiosk-design-preview'
New-Item -ItemType Directory -Path $env:STECH_KIOSK_DATA_DIR -Force | Out-Null
Start-Process -FilePath $electron -WorkingDirectory $kiosk -ArgumentList '.', '--portrait-preview', '--design-preview' -WindowStyle Normal
