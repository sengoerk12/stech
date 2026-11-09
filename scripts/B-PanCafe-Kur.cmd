@echo off
setlocal
set "STECH_SETUP_SELF=%~f0"
set "STECH_SETUP_MODE=%~1"
powershell.exe -NoLogo -NoProfile -STA -Command "$ErrorActionPreference='Stop'; try { $text=Get-Content -LiteralPath $env:STECH_SETUP_SELF -Raw -Encoding UTF8; $mark=[regex]::Match($text,'(?m)^:STECH_POWERSHELL\r?\n'); if (!$mark.Success) { throw 'Kurulum dosyasi eksik.' }; & ([scriptblock]::Create($text.Substring($mark.Index+$mark.Length))) } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
set "STECH_SETUP_EXIT=%errorlevel%"
pause
exit /b %STECH_SETUP_EXIT%
:STECH_POWERSHELL
function Write-Json($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8))
}

function Quote-PS($Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Require-Command($Name, $WingetId) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    if (!(Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw "$Name eksik. Microsoft App Installer (winget) gerekli." }
    Write-Host "$Name kuruluyor..."
    & winget.exe install --exact --id $WingetId --source winget --accept-source-agreements --accept-package-agreements | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Name kurulamadı. Kurulum çıktısını kontrol et." }
    $env:Path += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (!$command) { throw "$Name kuruldu fakat bu pencere henüz göremiyor. Dosyayı tekrar aç." }
    return $command.Source
}

function Read-IPv4($Prompt, $Default) {
    $value = (Read-Host $Prompt).Trim()
    if (!$value) { $value = $Default }
    $address = $null
    if ($value -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or
        ![Net.IPAddress]::TryParse($value, [ref]$address) -or [Net.IPAddress]::IsLoopback($address)) {
        throw 'Geçerli bir yerel IPv4 adresi gir.'
    }
    return $address.ToString()
}

function Health($Url, $Key) {
    try {
        $headers = @{}
        if ($Key) { $headers.Authorization = "Bearer $Key" }
        Invoke-RestMethod -UseBasicParsing -Uri $Url -Headers $headers -TimeoutSec 2
    } catch { $null }
}

function Wait-Ready($Check, $ErrorMessage) {
    for ($i = 0; $i -lt 30; $i++) {
        $result = & $Check
        if ($result) { return $result }
        Start-Sleep -Seconds 1
    }
    throw $ErrorMessage
}

function Is-Listening($Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-PanCafeIfNeeded($Folder) {
    if (Get-Process -Name pncserver -ErrorAction SilentlyContinue) { return }
    if (Test-Path -LiteralPath "$Folder\pncserver.exe") {
        Start-Process -FilePath "$Folder\pncserver.exe" -WorkingDirectory $Folder
    } else {
        [void](Read-Host 'PanCafe uygulamasını aç. Açılınca Enter tuşuna bas')
    }
    [void](Wait-Ready { Get-Process -Name pncserver -ErrorAction SilentlyContinue } 'PanCafe çalışmıyor. PanCafe uygulamasını açıp dosyayı tekrar çalıştır.')
}

function Make-KioskLauncher($Template, $Destination, $KioskConfig, $Certificate) {
    $text = Get-Content -LiteralPath $Template -Raw -Encoding UTF8
    $marker = '__STECH_PAIRING_BUNDLE__'
    if (!$text.Contains($marker) -or $text.IndexOf($marker) -ne $text.LastIndexOf($marker)) {
        throw 'Yanındaki A-Kiosk-Kur.cmd dosyası eşleştirilmemiş şablon olmalı.'
    }
    $payload = @{ config = $KioskConfig; rootCertificate = $Certificate } | ConvertTo-Json -Compress -Depth 8
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    [IO.File]::WriteAllText($Destination, ($text.Replace($marker, $encoded) -replace '\r?\n', "`r`n"))
}

$here = Split-Path -Parent $env:STECH_SETUP_SELF
$template = Join-Path $here 'A-Kiosk-Kur.cmd'
if (!(Test-Path -LiteralPath $template -PathType Leaf)) { throw 'A-Kiosk-Kur.cmd şablonunu bu dosyanın yanına koy.' }
$work = "$env:LOCALAPPDATA\STech-Kiosk-Sunucu"
$source = "$work\stech"
$bridge = "$work\Bridge"
$transfer = Join-Path $here 'A-Bilgisayarina-Kopyala'
[void][IO.Directory]::CreateDirectory($work)
[void][IO.Directory]::CreateDirectory($transfer)
$pairingPath = "$work\pairing.json"
$pairing = if (Test-Path -LiteralPath $pairingPath) { Get-Content -LiteralPath $pairingPath -Raw | ConvertFrom-Json } else { $null }
$repair = $env:STECH_SETUP_MODE -eq '--yeniden-esle'

Write-Host 'S TECH | B bilgisayarı kurulumu' -ForegroundColor Cyan
$git = Require-Command git.exe Git.Git
$node = Require-Command node.exe OpenJS.NodeJS.LTS
$caddy = Require-Command caddy.exe CaddyServer.Caddy
if ([int](& $node -p "process.versions.node.split('.')[0]") -lt 22) { throw 'Node.js 22 veya üstü gerekli.' }

if (!(Test-Path -LiteralPath "$source\.git")) {
    & $git clone --depth 1 --branch kiosk-v0.1.0 https://github.com/sengoerk12/stech.git $source
    if ($LASTEXITCODE -ne 0) { throw 'S TECH kaynakları indirilemedi.' }
}
$commit = & $git -C $source rev-parse HEAD
if ($commit -ne 'e8be40a6356bcc2494a3130d2d8875056946074d') { throw 'B kaynakları kiosk-v0.1.0 ile eşleşmiyor.' }
$appModule = "$source\apps\api\dist\apps\api\src\app.js"
$buildMarker = "$work\api-build-commit.txt"
if (!(Test-Path -LiteralPath $appModule) -or !(Test-Path -LiteralPath $buildMarker) -or
    (Get-Content -LiteralPath $buildMarker -Raw).Trim() -ne $commit) {
    Push-Location -LiteralPath $source
    try {
        & npm.cmd ci --workspace '@stech/api' --include-workspace-root=false
        if ($LASTEXITCODE -ne 0) { throw 'API bağımlılıkları kurulamadı.' }
        & npm.cmd run build --workspace '@stech/api'
        if ($LASTEXITCODE -ne 0) { throw 'API derlenemedi.' }
        [IO.File]::WriteAllText($buildMarker, $commit)
    } finally { Pop-Location }
}

$firebase = "$work\firebase.json"
if (!(Test-Path -LiteralPath $firebase)) {
    Write-Host 'wallet-stech projesi için indirdiğin hizmet hesabı JSON dosyasını seç.'
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Firebase hizmet hesabı JSON dosyasını seç'
    $picker.Filter = 'JSON (*.json)|*.json'
    if ($picker.ShowDialog() -ne 'OK') { throw 'Firebase JSON dosyası seçilmedi. Hazır olunca B dosyasını tekrar çalıştır.' }
    try { $credential = Get-Content -LiteralPath $picker.FileName -Raw | ConvertFrom-Json } catch { throw 'Firebase JSON dosyası okunamadı.' }
    if ($credential.type -ne 'service_account' -or $credential.project_id -ne 'wallet-stech' -or !$credential.private_key) {
        throw 'wallet-stech projesinin hizmet hesabı JSON dosyasını seç.'
    }
    Copy-Item -LiteralPath $picker.FileName -Destination $firebase
}

$bridgeConfig = "$bridge\connection.json"
if (Test-Path -LiteralPath $bridgeConfig) {
    $config = Get-Content -LiteralPath $bridgeConfig -Raw | ConvertFrom-Json
} else {
    $uninstall = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    $installed = Get-ItemProperty -Path $uninstall -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'PanCafe Pro*' } | Select-Object -First 1 -ExpandProperty InstallLocation
    $pan = @($installed, 'C:\Program Files (x86)\Pan Group\PanCafe Pro Server', 'D:\Pan Group') |
        Where-Object { $_ -and (Test-Path -LiteralPath "$_\Data\USDB.DAT") -and (Test-Path -LiteralPath "$_\Core\fbembed.dll") } | Select-Object -First 1
    if (!$pan) { $pan = (Read-Host 'PanCafe klasörü (içinde Data ve Core bulunan klasör)').Trim('"') }
    if (!(Test-Path -LiteralPath "$pan\Data\USDB.DAT") -or !(Test-Path -LiteralPath "$pan\Core\fbembed.dll")) {
        throw 'PanCafe Data\USDB.DAT veya Core\fbembed.dll bulunamadı.'
    }
    Start-PanCafeIfNeeded $pan
    $memberId = [int](Read-Host 'Aktif PanCafe üyesinin numarası')
    $username = (Read-Host 'Aynı üyenin kullanıcı adı').Trim()
    if ($memberId -lt 1 -or $username -notmatch '^[a-zA-Z0-9_.]{1,32}$') { throw 'Geçerli bir üye numarası ve kullanıcı adı gir.' }
    $installation = (Read-Host 'Firestore kurulum kimliği (ilk kurulumda Enter = stech-b)').Trim()
    if (!$installation) { $installation = 'stech-b' }
    if ($installation -notmatch '^[a-zA-Z0-9_-]{1,80}$') { throw 'Kurulum kimliğinde sadece harf, rakam, tire ve alt çizgi kullanılabilir.' }
    $port = 3002, 3003, 3004 | Where-Object { !(Is-Listening $_) } | Select-Object -First 1
    if (!$port) { throw 'PanCafe Bridge için 3002, 3003 veya 3004 portlarından birinin boş olması gerekiyor.' }
    [void][IO.Directory]::CreateDirectory($bridge)
    $config = [pscustomobject]@{
        databasePath = "$pan\Data\USDB.DAT"; clientDirectory = "$pan\Core"; expectedMemberId = $memberId
        expectedUsername = $username; installationId = $installation; displayName = 'S TECH'
        apiKey = (& $node "$source\kiosk\scripts\provision.cjs" device-key); port = $port
        allowRegistration = $false; allowBalanceCredit = $false; allowAdminAdjustments = $false
        allowFirebaseSync = $true; allowFirebaseBalanceWrite = $true; firebaseAddressColumn = 'ADDRESS'
    }
    Write-Json $bridgeConfig $config
}

Start-PanCafeIfNeeded (Split-Path -Parent (Split-Path -Parent $config.databasePath))
if (!(Test-Path -LiteralPath "$bridge\PanCafeBridge.exe")) {
    & powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "$source\scripts\build-pancafe-bridge.ps1" -OutputDirectory $bridge
    if ($LASTEXITCODE -ne 0) { throw 'PanCafe Bridge derlenemedi.' }
}
$localIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress)
if (!$pairing -or $repair -or $pairing.bIp -notin $localIps) {
    Write-Host ('Bu bilgisayarın IPv4 adresleri: ' + ($localIps -join ', '))
    $bIp = Read-IPv4 'B bilgisayarının yerel IPv4 adresi' $(if ($localIps.Count -eq 1) { $localIps[0] })
    if ($bIp -notin $localIps) { throw 'Girilen B adresi bu bilgisayara ait değil.' }
    $aIp = Read-IPv4 'Kiosk bilgisayarının IPv4 adresi (orada ipconfig ile bak)' $pairing.aIp
    if ($aIp -eq $bIp) { throw 'İki bilgisayarın IPv4 adresleri farklı olmalı.' }
    if ($pairing -and $pairing.bIp -ne $bIp -and (Is-Listening 8443)) {
        throw 'B adresi değişti. Eski Caddy işlemini kapat, ardından B dosyasını tekrar çalıştır.'
    }
    if ($pairing) { $key = $pairing.deviceKey; $pinHash = $pairing.adminPinHash } else {
        $key = & $node "$source\kiosk\scripts\provision.cjs" device-key
        $pin = Read-Host 'Kiosk çıkışı için 6–16 rakamlık yönetici PIN kodu' -AsSecureString
        $pinHash = [Net.NetworkCredential]::new('', $pin).Password | & $node "$source\kiosk\scripts\provision.cjs" pin-hash
        if ($LASTEXITCODE -ne 0 -or $pinHash -notmatch '^[0-9a-f]{128}$') { throw 'PIN 6–16 rakam olmalı.' }
    }
    $schema = ''
    $columnFile = "$work\member-columns.txt"
    if (!$pairing) {
        $schema = @"
& powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $(Quote-PS "$source\scripts\inspect-pancafe.ps1") -Database $(Quote-PS $config.databasePath) -ClientDirectory $(Quote-PS $config.clientDirectory) -OutputDirectory $(Quote-PS "$work\Inspect") -MemberColumns | Set-Content -LiteralPath $(Quote-PS $columnFile) -Encoding UTF8
if (`$LASTEXITCODE -ne 0) { throw 'PanCafe sütunları okunamadı.' }
"@
    }
    $adminActions = @"
`$ErrorActionPreference = 'Stop'
try {
    $schema
    if (Get-NetFirewallRule -Name 'STech-Kiosk-8443' -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -Name 'STech-Kiosk-8443' -Direction Inbound -Protocol TCP -LocalPort 8443 -LocalAddress '$bIp' -RemoteAddress '$aIp','$bIp' -Action Allow -Enabled True
    } else {
        New-NetFirewallRule -Name 'STech-Kiosk-8443' -DisplayName 'S TECH Kiosk HTTPS' -Direction Inbound -Protocol TCP -LocalPort 8443 -LocalAddress '$bIp' -RemoteAddress '$aIp','$bIp' -Action Allow | Out-Null
    }
} catch {
    Set-Content -LiteralPath $(Quote-PS "$work\setup-admin-error.log") -Value `$_.Exception.Message -Encoding UTF8
    exit 1
}
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($adminActions))
    Write-Host 'Windows, PanCafe kontrolü ve HTTPS güvenlik duvarı için yönetici onayı isteyecek.'
    $admin = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile', '-EncodedCommand', $encoded -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($admin.ExitCode -ne 0) { throw "PanCafe veya güvenlik duvarı adımı tamamlanamadı. Günlük: $work\setup-admin-error.log" }
    if (!$pairing) {
        $columns = Get-Content -LiteralPath $columnFile
        $addresses = @($columns | Where-Object { $_ -match '^(?:(?:EV_?)?ADRES(?:I)?|ADDRESS|ADRESS)(?:_?[1-9])?$' })
        if ('ADDRESS' -in $addresses) { $config.firebaseAddressColumn = 'ADDRESS' }
        elseif ($addresses.Count -eq 1) { $config.firebaseAddressColumn = $addresses[0] }
        else { throw "PanCafe adres sütunu belirlenemedi. Sütun listesi: $columnFile" }
        $identityColumns = @($columns | Where-Object { $_ -match '^(?:TC|TCKN|TCKIMLIK|TC_KIMLIK|KIMLIK|NATIONAL_ID)(?:_?(?:NO|NUMARASI|NUMBER))?$' })
        if ($identityColumns.Count -eq 1) {
            $config | Add-Member -NotePropertyName firebaseNationalIdColumn -NotePropertyValue $identityColumns[0] -Force
        }
        Write-Json $bridgeConfig $config
    }
    $pairing = [pscustomobject]@{ bIp = $bIp; aIp = $aIp; deviceKey = $key; adminPinHash = $pinHash }
    Write-Json $pairingPath $pairing
}

$bridgeUrl = "http://127.0.0.1:$($config.port)/health"
if (!(Health $bridgeUrl $config.apiKey).connected) {
    if (Is-Listening $config.port) { throw "Bridge portu $($config.port) başka bir işlem tarafından kullanılıyor." }
    Start-Process -FilePath "$bridge\PanCafeBridge.exe" -WorkingDirectory $bridge -Verb RunAs
    [void](Wait-Ready { $result = Health $bridgeUrl $config.apiKey; if ($result.connected) { $result } } 'Bridge açılmadı. Bridge penceresindeki hata mesajını kontrol et.')
}

$apiPort = 3091
$apiHealth = "http://127.0.0.1:$apiPort/api/v1/health"
$api = Health $apiHealth
if ($api) {
    $listener = Get-NetTCPConnection -LocalPort $apiPort -State Listen | Select-Object -First 1
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if (!$process.CommandLine -or $process.CommandLine.IndexOf("$work\start-api.cjs", [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "API portu $apiPort başka bir işlem tarafından kullanılıyor."
    }
} else {
    if (Is-Listening $apiPort) { throw "API portu $apiPort başka bir işlem tarafından kullanılıyor." }
    $dir = $work.Replace('\', '/')
    [IO.File]::WriteAllText("$work\api.env", @"
ENVIRONMENT=development
CAFE_ADAPTER=pancafe
PAYMENT_PROVIDER=mock
PANCAFE_PAYMENT_SIMULATION=false
PANCAFE_BALANCE_CREDIT=false
PANCAFE_BRIDGE_CONFIG="$dir/Bridge/connection.json"
DATA_DIR="$dir/api-data"
KIOSK_DEVICE_KEY=$($pairing.deviceKey)
FIREBASE_SYNC_ENABLED=true
FIREBASE_BALANCE_WRITE_ENABLED=true
FIREBASE_PROJECT_ID=wallet-stech
GOOGLE_APPLICATION_CREDENTIALS="$dir/firebase.json"
STECH_SOURCE_DIR="$dir/stech"
PORT=$apiPort
"@)
    [IO.File]::WriteAllText("$work\start-api.cjs", @'
const path = require("node:path");
const source = process.env.STECH_SOURCE_DIR;
require(require.resolve("reflect-metadata", { paths: [source] }));
const { createApp } = require(path.join(source, "apps/api/dist/apps/api/src/app.js"));
createApp().then(app => app.listen(Number(process.env.PORT), "127.0.0.1")).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
'@)
    Start-Process -FilePath $node -ArgumentList "`"--env-file=$work\api.env`"", "`"$work\start-api.cjs`"" `
        -WorkingDirectory "$source\apps\api" -WindowStyle Hidden -RedirectStandardOutput "$work\api.log" -RedirectStandardError "$work\api-error.log"
    $api = Wait-Ready { Health $apiHealth } "S TECH API açılmadı. Günlük: $work\api-error.log"
}
if ($api.cafe -ne 'pancafe' -or !$api.firebaseBalanceWrite) { throw "Port $apiPort üzerinde beklenen PanCafe API’si çalışmıyor." }

$bIp = $pairing.bIp
$site = "https://${bIp}:8443"
$env:XDG_DATA_HOME = "$work\caddy-data"
$env:XDG_CONFIG_HOME = "$work\caddy-config"
$certPath = "$env:XDG_DATA_HOME\caddy\pki\authorities\local\root.crt"
$caddyfile = "$work\Caddyfile"
[IO.File]::WriteAllText($caddyfile, @"
{
    admin off
    auto_https disable_redirects
    skip_install_trust
    default_sni $bIp
}
$site {
    bind $bIp
    tls internal
    @kiosk path /api/v1/health /api/v1/kiosk/* /api/v1/me/dashboard /api/v1/me/transactions /api/v1/me/session-history /api/v1/auth/logout
    handle @kiosk {
        reverse_proxy 127.0.0.1:$apiPort
    }
    handle {
        respond 404
    }
}
"@)
$httpsCheck = {
    if (Test-Path -LiteralPath $certPath) {
        $previousCa = $env:NODE_EXTRA_CA_CERTS
        try {
            $env:NODE_EXTRA_CA_CERTS = $certPath
            'fetch(process.argv[2], {signal: AbortSignal.timeout(2000)}).then(r => {if (!r.ok) process.exitCode = 1;}, () => {process.exitCode = 1;});' |
                & $node - "$site/api/v1/health"
            if ($LASTEXITCODE -eq 0) { $true }
        } finally { $env:NODE_EXTRA_CA_CERTS = $previousCa }
    }
}
if (!(& $httpsCheck)) {
    if (Is-Listening 8443) { throw 'HTTPS portu 8443 dolu veya mevcut Caddy bağlantısı doğrulanamadı.' }
    Start-Process -FilePath $caddy -ArgumentList 'run', '--config', "`"$caddyfile`"", '--adapter', 'caddyfile' `
        -WorkingDirectory $work -WindowStyle Hidden -RedirectStandardOutput "$work\caddy.log" -RedirectStandardError "$work\caddy-error.log"
    [void](Wait-Ready $httpsCheck "HTTPS hazır olmadı. Günlük: $work\caddy-error.log")
}

$kiosk = @{ mode = 'connected'; station = 'S TECH'; apiBaseUrl = "$site/api/v1"; deviceKey = $pairing.deviceKey; adminPinHash = $pairing.adminPinHash }
$generated = Join-Path $transfer 'A-Kiosk-Kur.cmd'
Make-KioskLauncher $template $generated $kiosk (Get-Content -LiteralPath $certPath -Raw)
$current = Health $apiHealth
if ($current.firebaseSync -eq 'error') { Write-Warning "Firebase eşitlemesi hata verdi. Yetkiyi ve Bridge ayarlarını kontrol et. Günlük: $work\api-error.log" }
else { Write-Host "Firebase eşitleme durumu: $($current.firebaseSync)" }
Write-Host "B hazır. A’ya şu dosyayı kopyalayıp çift tıkla: $generated" -ForegroundColor Green
