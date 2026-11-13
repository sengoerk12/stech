# S TECH PanCafe koprusunu derler ve API'nin kullandigi klasore yerlestirir. (ASCII only)
$ErrorActionPreference = 'Stop'
function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) { Say $text 'Red'; Read-Host 'Kapatmak icin Enter'; exit 1 }

$src = Split-Path $PSScriptRoot -Parent
$envFile = @('D:\stech-build-cache\project\apps\api\.env', "$src\apps\api\.env") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $envFile) { Fail 'API .env dosyasi bulunamadi.' }
$line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^PANCAFE_BRIDGE_CONFIG=' } | Select-Object -First 1
if (-not $line) { Fail "PANCAFE_BRIDGE_CONFIG, $envFile icinde tanimli degil." }
$target = Split-Path ($line.Substring('PANCAFE_BRIDGE_CONFIG='.Length).Trim().Trim('"').Replace('/', '\')) -Parent
if (-not (Test-Path -LiteralPath $target)) { Fail "Kopru klasoru bulunamadi: $target" }
Say "Kopru klasoru: $target"

# 1) Once gecici klasore derle; hata olursa calisan kopru degismez.
$stage = Join-Path $env:TEMP 'stech-bridge-build'
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
try { & "$PSScriptRoot\build-pancafe-bridge.ps1" -OutputDirectory $stage }
catch { Fail "Derleme basarisiz: $($_.Exception.Message). Ustteki hata satirlarini Claude'a ilet." }
$built = Join-Path $stage 'PanCafeBridge.exe'
if (-not (Test-Path -LiteralPath $built)) { Fail 'Derleme cikti uretmedi.' }
Say 'Derleme basarili.' 'Green'

# 2) Calisan kopru kapatilmali (yonetici yetkisiyle calistigi icin bu pencere kapatamaz).
$exe = Join-Path $target 'PanCafeBridge.exe'
while (Get-Process -Name PanCafeBridge -ErrorAction SilentlyContinue) {
  Say 'Acik olan "S TECH - PanCafe Baglantisi" penceresini kapat.' 'Yellow'
  Read-Host 'Kapattiktan sonra Enter'
}
if (Test-Path -LiteralPath $exe) { Copy-Item -LiteralPath $exe -Destination (Join-Path $target 'PanCafeBridge.onceki.exe') -Force }
Copy-Item -LiteralPath $built -Destination $exe -Force
Say "Guncellendi: $exe (onceki surum: PanCafeBridge.onceki.exe)" 'Green'

# 3) Yeni kopruyu ac; Windows yonetici onayi istenir.
Start-Process -FilePath $exe -WorkingDirectory $target
Say 'Kopru acildi. Yonetici onayini ver; PanCafe''de Genel sekmesi acik olsun.' 'Green'
Read-Host 'Kapatmak icin Enter'
