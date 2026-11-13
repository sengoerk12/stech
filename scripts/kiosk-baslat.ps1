# S TECH kiosk: yerel PanCafe'ye bagli, 1080x1920 pencerede acar. (ASCII only)
$ErrorActionPreference = 'Stop'
$src = Split-Path $PSScriptRoot -Parent
$proj = 'D:\stech-build-cache\project'
$api = 'http://127.0.0.1:3001/api/v1'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) { Say $text 'Red'; Read-Host 'Kapatmak icin Enter'; exit 1 }

# 1) Kiosk programi: en yeni derleme
$exe = @("$proj\kiosk\dist\kiosk.exe", "$src\kiosk\dist\kiosk.exe") | Where-Object { Test-Path -LiteralPath $_ } |
  Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending | Select-Object -First 1
if (-not $exe) { Fail 'kiosk.exe bulunamadi. Once scripts\Kiosk-Derle.cmd calistir.' }
Say "Kiosk: $exe"

# 2) API'nin kullandigi cihaz anahtari
$envFile = @("$proj\apps\api\.env", "$src\apps\api\.env") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $envFile) { Fail 'API .env dosyasi bulunamadi.' }
$apiRoot = Split-Path (Split-Path (Split-Path $envFile -Parent) -Parent) -Parent
$keyLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^KIOSK_DEVICE_KEY=' } | Select-Object -First 1
if (-not $keyLine) { Fail "KIOSK_DEVICE_KEY, $envFile icinde tanimli degil." }
$deviceKey = $keyLine.Substring('KIOSK_DEVICE_KEY='.Length).Trim().Trim('"')
if ($deviceKey.Length -lt 40) { Fail 'KIOSK_DEVICE_KEY en az 40 karakter olmali.' }

# 3) Bagli mod ayari: uygun mevcut ayar varsa onu kullan, yoksa olustur
$own = Join-Path $env:LOCALAPPDATA 'STech-Kiosk-Yerel\kiosk.config.json'
$candidates = @($own,
  (Join-Path $env:LOCALAPPDATA 'Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\@stech\kiosk\kiosk.config.json'),
  (Join-Path $env:APPDATA '@stech\kiosk\kiosk.config.json'))
$configFile = $null
foreach ($file in $candidates) {
  if (-not (Test-Path -LiteralPath $file)) { continue }
  try { $c = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
  if ($c.mode -eq 'connected' -and $c.deviceKey -eq $deviceKey -and $c.adminPinHash -match '^[0-9a-f]{128}$' -and
      $c.apiBaseUrl -match '^http://(127\.0\.0\.1|localhost):3001/') { $configFile = $file; break }
}
if (-not $configFile) {
  Say 'Bagli mod ayari bulunamadi; yenisi olusturulacak.' 'Yellow'
  $hash = $null
  while (-not $hash) {
    $pin = Read-Host 'Kiosk yetkili PIN (6-16 rakam)'
    if ($pin -notmatch '^\d{6,16}$') { Say 'PIN 6-16 rakam olmali.' 'Yellow'; continue }
    $hash = ($pin | & node "$src\kiosk\scripts\provision.cjs" pin-hash | Select-Object -Last 1)
    if ($hash -notmatch '^[0-9a-f]{128}$') { $hash = $null; Say 'PIN ozeti uretilemedi (node kurulu mu?).' 'Yellow' }
  }
  $json = [ordered]@{ mode = 'connected'; station = 'S TECH - Merkez'; idleSeconds = 90; completionSeconds = 20
    apiBaseUrl = $api; deviceKey = $deviceKey; adminPinHash = $hash } | ConvertTo-Json
  New-Item -ItemType Directory -Force (Split-Path $own -Parent) | Out-Null
  [IO.File]::WriteAllText($own, $json, (New-Object Text.UTF8Encoding($false)))
  $configFile = $own
}
Say "Ayar: $configFile"

# 4) API calisiyor mu?
function ApiUp { try { (Invoke-WebRequest "$api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }
if (-not (ApiUp)) {
  Say 'API kapali; baslatiliyor...' 'Yellow'
  Start-Process cmd -ArgumentList '/k', 'title S TECH API && npm run dev:api' -WorkingDirectory $apiRoot -WindowStyle Minimized
  $deadline = (Get-Date).AddSeconds(120)
  while (-not (ApiUp) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (ApiUp)) { Fail 'API 120 saniyede acilmadi. "S TECH API" penceresindeki hatayi kontrol et.' }
}
Say 'API calisiyor.' 'Green'

# 5) PanCafe baglantisi
function PanCafe {
  try { Invoke-RestMethod "$api/kiosk/pc-availability" -Headers @{ 'X-Kiosk-Key' = $deviceKey } -TimeoutSec 15 } catch { $null }
}
$pcs = PanCafe
while (-not $pcs) {
  Say 'PanCafe''ye ulasilamiyor. PanCafe acik olmali ve masaustundeki "S TECH - PanCafe Baglantisi" araci yonetici onayiyla calismali.' 'Yellow'
  $answer = Read-Host 'Tekrar denemek icin Enter, yine de kiosku acmak icin H'
  if ($answer -match '^[hH]') { break }
  $pcs = PanCafe
}
if ($pcs) { Say ("PanCafe bagli: {0} bilgisayardan {1} tanesi bos." -f $pcs.total, $pcs.available) 'Green' }

# 6) Eski kiosk penceresini kapat ve yenisini 1080x1920 pencerede ac
$old = Get-Process -Name kiosk -ErrorAction SilentlyContinue
if ($old) { Say 'Acik kiosk kapatiliyor...'; $old | Stop-Process -Force; Start-Sleep -Seconds 2 }
$env:STECH_KIOSK_CONFIG = $configFile
Start-Process -FilePath $exe -ArgumentList '--portrait-preview'
Say 'Kiosk acildi.' 'Green'
Start-Sleep -Seconds 4
