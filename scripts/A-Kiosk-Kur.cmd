@echo off
setlocal
set "STECH_SETUP_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -STA -Command "$ErrorActionPreference='Stop'; try { $text=Get-Content -LiteralPath $env:STECH_SETUP_SELF -Raw -Encoding UTF8; $mark=[regex]::Match($text,'(?m)^:STECH_POWERSHELL\r?\n'); if (!$mark.Success) { throw 'Kurulum dosyasi eksik.' }; & ([scriptblock]::Create($text.Substring($mark.Index+$mark.Length))) } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
set "STECH_SETUP_EXIT=%errorlevel%"
pause
exit /b %STECH_SETUP_EXIT%
:STECH_POWERSHELL
$pairedConfig = '__STECH_PAIRING_BUNDLE__'
try {
    $pairing = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pairedConfig)) | ConvertFrom-Json
} catch {
    throw 'Önce B bilgisayarında B-PanCafe-Kur.cmd dosyasını çalıştır. Orada üretilen A dosyasını bu bilgisayara kopyala.'
}

$settings = $pairing.config
$api = [Uri]$settings.apiBaseUrl
if ($settings.mode -ne 'connected' -or $api.Scheme -ne 'https' -or $api.Port -ne 8443 -or
    $api.AbsolutePath -ne '/api/v1' -or $settings.deviceKey -notmatch '^[a-zA-Z0-9_-]{40,}$' -or
    $settings.adminPinHash -notmatch '^[0-9a-f]{128}$' -or $pairing.rootCertificate -notmatch '-----BEGIN CERTIFICATE-----') {
    throw 'Kiosk bağlantı ayarları geçersiz. B bilgisayarında A dosyasını yeniden oluştur.'
}

if (Get-Process -Name kiosk -ErrorAction SilentlyContinue) {
    throw 'Önce açık kiosk uygulamasını kapat, sonra bu dosyayı tekrar çalıştır.'
}
$work = "$env:LOCALAPPDATA\STechKiosk"
[void][IO.Directory]::CreateDirectory($work)
$exe = "$work\kiosk.exe"
$sha256 = 'ABAE091BF1E217893D888AA19C3D2660CEE09013D4D458D1B15D7B60C03C5D5D'
if (!(Test-Path -LiteralPath $exe)) {
    Write-Host 'GitHub üzerinden güncel kiosk.exe indiriliyor...'
    $download = "$exe.download"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/sengoerk12/stech/releases/download/kiosk-v0.1.0/kiosk.exe' -OutFile $download
    if ((Get-FileHash -LiteralPath $download).Hash -ne $sha256) { throw 'İndirilen kiosk.exe doğrulanamadı.' }
    [IO.File]::Move($download, $exe)
}
if ((Get-FileHash -LiteralPath $exe).Hash -ne $sha256) { throw "Kurulu kiosk.exe bu sürümle eşleşmiyor. Dosya: $exe" }

$env:STECH_KIOSK_CONFIG = "$work\kiosk.config.json"
$env:NODE_EXTRA_CA_CERTS = "$work\root.crt"
[IO.File]::WriteAllText($env:STECH_KIOSK_CONFIG, ($settings | ConvertTo-Json))
[IO.File]::WriteAllText($env:NODE_EXTRA_CA_CERTS, $pairing.rootCertificate)

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($curl -and (& $curl.Source --help all | Select-String -SimpleMatch '--ssl-revoke-best-effort' -Quiet)) {
    Write-Host 'PanCafe bilgisayarına HTTPS bağlantısı deneniyor...'
    & $curl.Source --fail --silent --max-time 10 --ssl-revoke-best-effort --cacert $env:NODE_EXTRA_CA_CERTS "$($api.AbsoluteUri)/health" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "B bilgisayarına bağlanılamadı ($($api.Host):8443). B’de kurulum dosyasını çalıştır ve iki bilgisayarın aynı ağda olduğunu kontrol et."
    }
}
Start-Process -FilePath $exe -WorkingDirectory $work
Write-Host 'Kiosk açıldı. Yetkili çıkışı için Ctrl+Alt+Q ve kurulumda seçilen PIN kullanılır.'
