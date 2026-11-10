@echo off
setlocal
set "STECH_SETUP_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -STA -Command "$ErrorActionPreference='Stop'; try { $text=Get-Content -LiteralPath $env:STECH_SETUP_SELF -Raw -Encoding UTF8; $mark=[regex]::Match($text,'(?m)^:STECH_POWERSHELL\r?\n'); if (!$mark.Success) { throw 'Kurulum dosyasi eksik.' }; & ([scriptblock]::Create($text.Substring($mark.Index+$mark.Length))) } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
set "STECH_SETUP_EXIT=%errorlevel%"
if not "%STECH_SETUP_EXIT%"=="0" pause
exit /b %STECH_SETUP_EXIT%
:STECH_POWERSHELL
$pairedConfig = '__STECH_PAIRING_BUNDLE__'
try {
    $pairing = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pairedConfig)) | ConvertFrom-Json
} catch {
    throw 'B bilgisayarında B-PanCafe-Kur.cmd dosyasını çalıştır. Orada oluşturulan A-Kiosk-Kur.cmd dosyasını bu bilgisayara kopyala.'
}

$settings = $pairing.config
$api = [Uri]$settings.apiBaseUrl
if ($settings.mode -ne 'connected' -or $api.Scheme -ne 'https' -or $api.Port -ne 8443 -or
    $api.AbsolutePath -ne '/api/v1' -or $settings.deviceKey -cnotmatch '^[a-zA-Z0-9_-]{40,}$' -or
    $settings.adminPinHash -notmatch '^[0-9a-f]{128}$' -or $pairing.rootCertificate -notmatch '-----BEGIN CERTIFICATE-----' -or
    $pairing.kioskSha256 -notmatch '^[0-9a-f]{64}$' -or
    $pairing.kioskUrl -cnotmatch '^https://github\.com/sengoerk12/stech/releases/download/kiosk-v[0-9]+\.[0-9]+\.[0-9]+/kiosk\.exe$') {
    throw 'Kiosk bağlantı ayarları geçersiz. B bilgisayarında A dosyasını yeniden oluştur.'
}
$kioskVersion = ([Uri]$pairing.kioskUrl).Segments[-2].TrimEnd('/')

if (Get-Process -Name kiosk -ErrorAction SilentlyContinue) {
    throw 'Önce açık kiosk uygulamasını kapat, sonra bu dosyayı tekrar çalıştır.'
}
if (![Environment]::Is64BitOperatingSystem) { throw 'Kiosk 64 bit Windows gerektirir.' }
$work = "$env:LOCALAPPDATA\STechKiosk"
[void][IO.Directory]::CreateDirectory($work)
$exe = "$work\kiosk.exe"

$env:STECH_KIOSK_CONFIG = "$work\kiosk.config.json"
$env:NODE_EXTRA_CA_CERTS = "$work\root.crt"

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($curl -and (& $curl.Source --help all | Select-String -SimpleMatch '--ssl-revoke-best-effort' -Quiet)) {
    Write-Host 'PanCafe bilgisayarına HTTPS bağlantısı deneniyor...'
    $probeCa = "$work\root.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($probeCa, $pairing.rootCertificate)
        & $curl.Source --fail --silent --max-time 10 --ssl-revoke-best-effort --cacert $probeCa "$($api.AbsoluteUri)/health" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "B bilgisayarına bağlanılamadı ($($api.Host):8443). B bilgisayarında kurulum dosyasını çalıştır ve iki bilgisayarın aynı ağda olduğunu kontrol et."
        }
    } finally { [IO.File]::Delete($probeCa) }
}
if (!(Test-Path -LiteralPath $exe) -or (Get-FileHash -LiteralPath $exe).Hash -ne $pairing.kioskSha256) {
    Write-Host "kiosk.exe indiriliyor ($kioskVersion)..."
    $staged = "$exe.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        if ($curl) {
            & $curl.Source --fail --location --progress-bar --connect-timeout 15 --max-time 600 `
                --speed-limit 1024 --speed-time 45 --retry 2 --retry-max-time 90 --output $staged $pairing.kioskUrl
            if ($LASTEXITCODE -ne 0) { throw "GitHub indirmesi tamamlanamadı (curl $LASTEXITCODE). İnternet bağlantısını kontrol edip A dosyasını tekrar aç." }
        } else {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $ProgressPreference = 'Continue'
            Invoke-WebRequest -UseBasicParsing -Uri $pairing.kioskUrl -OutFile $staged -TimeoutSec 600
        }
        Write-Host 'İndirilen kiosk.exe doğrulanıyor...'
        if ((Get-FileHash -LiteralPath $staged).Hash -ne $pairing.kioskSha256) { throw 'İndirilen kiosk.exe doğrulanamadı.' }
        if ([IO.File]::Exists($exe)) { [IO.File]::Replace($staged, $exe, [NullString]::Value) }
        else { [IO.File]::Move($staged, $exe) }
    } finally { [IO.File]::Delete($staged) }
}
$launcher = "$work\A-Kiosk-Kur.cmd"
if ($env:STECH_SETUP_SELF -ne $launcher) {
    Copy-Item -LiteralPath $env:STECH_SETUP_SELF -Destination $launcher -Force
    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    if ($desktop) {
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'S TECH Kiosk.lnk'))
        $shortcut.TargetPath = $launcher
        $shortcut.WorkingDirectory = $work
        $shortcut.IconLocation = "$exe,0"
        $shortcut.Save()
    }
}
[IO.File]::WriteAllText($env:STECH_KIOSK_CONFIG, ($settings | ConvertTo-Json))
[IO.File]::WriteAllText($env:NODE_EXTRA_CA_CERTS, $pairing.rootCertificate)
Start-Process -FilePath $exe -WorkingDirectory $work
Write-Host "Kiosk açıldı ($kioskVersion). Yetkili çıkışı için Ctrl+Alt+Q ve kurulumda seçilen PIN kullanılır."
