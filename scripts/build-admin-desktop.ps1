param(
    [string]$ToolsRoot = 'D:\stech-build-cache\desktop-tools',
    [string]$OutputRoot = 'D:\stech-build-cache\admin-desktop'
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $OutputRoot 'stage'
New-Item -ItemType Directory -Force $stage | Out-Null
New-Item -ItemType Directory -Force (Join-Path $stage 'web') | Out-Null
Copy-Item (Join-Path $sourceRoot 'desktop/main.cjs') $stage -Force
Copy-Item (Join-Path $sourceRoot 'apps/mobile/assets/brand-logo.png') $stage -Force
Copy-Item (Join-Path $sourceRoot 'apps/admin/*') (Join-Path $stage 'web') -Force
@{name='stech-admin';version='0.1.0';private=$true;main='main.cjs';desktopMode='admin';description='S TECH işletme yönetimi'} | ConvertTo-Json | Set-Content (Join-Path $stage 'package.json')
$packager=Join-Path $ToolsRoot 'node_modules/.bin/electron-packager.cmd'
if(-not(Test-Path $packager)){throw 'Install electron@45.1.0 and @electron/packager@20.3.0 in ToolsRoot first.'}
& $packager $stage 'S TECH Admin' --platform=win32 --arch=x64 --electron-version=45.1.0 "--out=$OutputRoot/release" --overwrite --prune=false
if($LASTEXITCODE -ne 0){throw 'Admin packaging failed.'}
Write-Output "Admin EXE: $OutputRoot/release/S TECH Admin-win32-x64/S TECH Admin.exe"
