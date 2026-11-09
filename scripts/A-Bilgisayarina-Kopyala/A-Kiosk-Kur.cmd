@echo off
setlocal
set "STECH_SETUP_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -STA -Command "$ErrorActionPreference='Stop'; try { $text=Get-Content -LiteralPath $env:STECH_SETUP_SELF -Raw -Encoding UTF8; $mark=[regex]::Match($text,'(?m)^:STECH_POWERSHELL\r?\n'); if (!$mark.Success) { throw 'Kurulum dosyasi eksik.' }; & ([scriptblock]::Create($text.Substring($mark.Index+$mark.Length))) } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
set "STECH_SETUP_EXIT=%errorlevel%"
pause
exit /b %STECH_SETUP_EXIT%
:STECH_POWERSHELL
$pairedConfig = 'eyJjb25maWciOnsic3RhdGlvbiI6IlMgVEVDSCIsImRldmljZUtleSI6ImJPdmNyXzhGejlNWjZqdU15SWFWbnAzT1lwbFo5SHp2ZWh0RkhLLVRHMFNTa0l3Ni0wWVNUeHBNS243ZjVHb20iLCJhZG1pblBpbkhhc2giOiJjNDVkZjRlNjlhZGZmMTRlNTY1NzU0MmI1MzdjNjY0OGM2NTU3YWIwOGIyODgyMDExYmI0NjFjYjJkOGJhZDllZTJkZTM3NGMwMzFmYTdkYjg0ODJjNmRhNmM0YzQxYzZmZDViYWJhZmExNDRmODkzODMyYzQxYmRlMTVjMzQ4MyIsIm1vZGUiOiJjb25uZWN0ZWQiLCJhcGlCYXNlVXJsIjoiaHR0cHM6Ly8xMC4yMzEuNzYuMTQwOjg0NDMvYXBpL3YxIn0sInJvb3RDZXJ0aWZpY2F0ZSI6Ii0tLS0tQkVHSU4gQ0VSVElGSUNBVEUtLS0tLVxuTUlJQnBEQ0NBVXFnQXdJQkFnSVJBTFV1SGxsK3UyOXZxblhrS1RyOFlGc3dDZ1lJS29aSXpqMEVBd0l3TURFdVxuTUN3R0ExVUVBeE1sUTJGa1pIa2dURzlqWVd3Z1FYVjBhRzl5YVhSNUlDMGdNakF5TmlCRlEwTWdVbTl2ZERBZVxuRncweU5qRXhNRGt5TWpJNU1qUmFGdzB6TmpBNU1UY3lNakk1TWpSYU1EQXhMakFzQmdOVkJBTVRKVU5oWkdSNVxuSUV4dlkyRnNJRUYxZEdodmNtbDBlU0F0SURJd01qWWdSVU5ESUZKdmIzUXdXVEFUQmdjcWhrak9QUUlCQmdncVxuaGtqT1BRTUJCd05DQUFUUGsrS0Q2MlRmVFk0bGVlV3llVzdaN3UvNUZsa0lpTzN0eUdsQ1grbzNkTnFDMWtVTVxuQURwKzVQV2xvUWdETGI3NFlDZ29wckNRMEhUak9QdVRsdTBFbzBVd1F6QU9CZ05WSFE4QkFmOEVCQU1DQVFZd1xuRWdZRFZSMFRBUUgvQkFnd0JnRUIvd0lCQVRBZEJnTlZIUTRFRmdRVUlRZi9ieFJ2WmREVDJXQTB2TnB1ZlhFbFxudDRFd0NnWUlLb1pJemowRUF3SURTQUF3UlFJZ2IvZ2FxSzcrZzVheVVrS2pMQnNMc25zMHNnOCtaVzdqVTQ1TVxuVU10Y1g2Y0NJUURCa29lRnVHQnUrNks3cEM2YlI4djQ0bGlJNmtCNlkzamwxTGR6TDlQTVVBPT1cbi0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS1cbiJ9'
try {
    $pairing = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pairedConfig)) | ConvertFrom-Json
} catch {
    throw 'Önce B bilgisayarında B-PanCafe-Kur.cmd dosyasını çalıştır. Orada üretilen A dosyasını bu bilgisayara kopyala.'
}

$settings = $pairing.config
$api = [Uri]$settings.apiBaseUrl
if ($settings.mode -ne 'connected' -or $api.Scheme -ne 'https' -or $api.Port -ne 8443 -or
    $api.AbsolutePath -ne '/api/v1' -or $settings.deviceKey -cnotmatch '^[a-zA-Z0-9_-]{40,}$' -or
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
