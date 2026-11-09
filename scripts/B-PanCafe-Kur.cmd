@echo off
setlocal
set "STECH_SETUP_SELF=%~f0"
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

function Update-SetupPath {
    $env:Path += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"
}

function Require-Command($Name, $WingetId) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    if (!(Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw "$Name eksik. Microsoft App Installer (winget) gerekli." }
    Write-Host "$Name kuruluyor..."
    & winget.exe install --exact --id $WingetId --source winget --accept-source-agreements --accept-package-agreements | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Name kurulamadı. Kurulum çıktısını kontrol et." }
    Update-SetupPath
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

function Get-OwnedListener($Port, $Executable, $Path) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$listener) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($process.Name -ne $Executable -or !$process.CommandLine -or
        $process.CommandLine.IndexOf($Path, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Port $Port başka bir uygulama tarafından kullanılıyor."
    }
    return $process.ProcessId
}

function Stop-OwnedListener($Port, $ProcessId) {
    Stop-Process -Id $ProcessId -ErrorAction Stop
    [void](Wait-Ready { !(Is-Listening $Port) } "Port $Port kapanmadı.")
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

function Make-KioskLauncher($Template, $Destination, $KioskConfig, $Certificate, $KioskUrl, $KioskSha256) {
    $text = Get-Content -LiteralPath $Template -Raw -Encoding UTF8
    $marker = '__STECH_PAIRING_BUNDLE__'
    if (!$text.Contains($marker) -or $text.IndexOf($marker) -ne $text.LastIndexOf($marker)) {
        throw 'Yanındaki A-Kiosk-Kur.cmd dosyası eşleştirilmemiş şablon olmalı.'
    }
    if ($KioskConfig.deviceKey -cnotmatch '^[a-zA-Z0-9_-]{40,}$' -or
        $KioskConfig.adminPinHash -cnotmatch '^[0-9a-f]{128}$' -or
        $Certificate -notmatch '-----BEGIN CERTIFICATE-----') {
        throw 'A kurulum dosyası için cihaz anahtarı, PIN özeti veya HTTPS sertifikası geçersiz.'
    }
    $payload = @{ config = $KioskConfig; rootCertificate = $Certificate; kioskUrl = $KioskUrl; kioskSha256 = $KioskSha256 } | ConvertTo-Json -Compress -Depth 8
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    $temporary = "$Destination.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, ($text.Replace($marker, $encoded) -replace '\r?\n', "`r`n"))
        if ([IO.File]::Exists($Destination)) { [IO.File]::Replace($temporary, $Destination, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Destination) }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

$repository = 'https://github.com/sengoerk12/stech'
$version = 'kiosk-v0.1.1'
$kioskUrl = "$repository/releases/download/$version/kiosk.exe"
$kioskSha256 = '82F0C5A6121E2EB7634A3FDFC5357CAF52E7163F6A590F221AF11D87A3B4BCB3'
$here = Split-Path -Parent $env:STECH_SETUP_SELF
$work = "$env:LOCALAPPDATA\STech-Kiosk-Sunucu"
$source = "$work\surumler\$version"
$bridge = "$work\Bridge"
$transfer = Join-Path $here 'A-Bilgisayarina-Kopyala'
[void][IO.Directory]::CreateDirectory($work)
$pairingPath = "$work\pairing.json"
$pairing = if (Test-Path -LiteralPath $pairingPath) { Get-Content -LiteralPath $pairingPath -Raw | ConvertFrom-Json } else { $null }

Write-Host 'S TECH | B bilgisayarı kurulumu' -ForegroundColor Cyan
Update-SetupPath
$git = Require-Command git.exe Git.Git
$node = Require-Command node.exe OpenJS.NodeJS.LTS
$caddy = Require-Command caddy.exe CaddyServer.Caddy
if ([int](& $node -p "process.versions.node.split('.')[0]") -lt 22) { throw 'Node.js 22 veya üstü gerekli.' }

if (!(Test-Path -LiteralPath "$source\.git")) {
    Write-Host "S TECH sunucusu GitHub üzerinden indiriliyor ($version)..."
    $checkout = "$source.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        & $git clone --depth 1 --branch $version "$repository.git" $checkout
        if ($LASTEXITCODE) { throw 'S TECH kaynakları indirilemedi. İnternet bağlantısını kontrol edip yeniden dene.' }
        [IO.Directory]::Move($checkout, $source)
    } finally {
        if (Test-Path -LiteralPath $checkout -PathType Container) {
            $resolved = (Resolve-Path -LiteralPath $checkout).Path
            if ($resolved -eq $checkout) { Remove-Item -LiteralPath $resolved -Recurse -Force }
        }
    }
}
$releaseId = & $git -C $source rev-parse HEAD
if ($LASTEXITCODE -or $releaseId -notmatch '^[0-9a-f]{40}$') { throw 'S TECH kaynak sürümü okunamadı.' }
$tagCommit = & $git -C $source rev-parse "refs/tags/$version^{commit}"
if ($LASTEXITCODE -or $tagCommit -ne $releaseId) { throw "Sunucu kaynakları $version sürümüyle eşleşmiyor." }

$appModule = "$source\apps\api\dist\apps\api\src\app.js"
$buildMarker = "$source\api-build-ok.txt"
if (!(Test-Path -LiteralPath $appModule) -or !(Test-Path -LiteralPath $buildMarker) -or [IO.File]::ReadAllText($buildMarker) -ne $releaseId) {
    Write-Host 'Sunucu dosyaları hazırlanıyor. İlk kurulumda npm paketleri indirilecek.'
    Push-Location -LiteralPath $source
    try {
        & npm.cmd ci --workspace '@stech/api' --include-workspace-root=false
        if ($LASTEXITCODE -ne 0) { throw 'API bağımlılıkları kurulamadı.' }
        & npm.cmd run build --workspace '@stech/api'
        if ($LASTEXITCODE -ne 0) { throw 'API derlenemedi.' }
        [IO.File]::WriteAllText($buildMarker, $releaseId)
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
if (!$localIps.Count) { throw 'B bilgisayarını kiosk ile aynı yerel ağa bağla ve kurucuyu tekrar aç.' }
$bIp = if ($pairing.bIp -in $localIps) { $pairing.bIp } elseif ($localIps.Count -eq 1) { $localIps[0] }
if (!$bIp) {
    Write-Host ('Bu bilgisayarın IPv4 adresleri: ' + ($localIps -join ', '))
    $bIp = Read-IPv4 'B bilgisayarının yerel IPv4 adresi' $null
}
if ($bIp -notin $localIps) { throw 'Girilen B adresi bu bilgisayara ait değil.' }
Write-Host "B bilgisayarının adresi $bIp"
$aPrompt = 'Kiosk bilgisayarının IPv4 adresi (A bilgisayarında Komut İstemi açıp ipconfig yaz)'
if ($pairing) { $aPrompt = "Kiosk IPv4 adresi değiştiyse yeni adresi gir (Enter = $($pairing.aIp))" }
$aIp = Read-IPv4 $aPrompt $pairing.aIp
if ($aIp -eq $bIp) { throw 'İki bilgisayarın IPv4 adresleri farklı olmalı.' }
if (!$pairing -or $pairing.bIp -ne $bIp -or $pairing.aIp -ne $aIp) {
    if ($pairing) { $key = $pairing.deviceKey; $pinHash = $pairing.adminPinHash } else {
        $key = & $node "$source\kiosk\scripts\provision.cjs" device-key
        $pin = Read-Host 'Kiosk çıkışı için 6–16 rakamlık yönetici PIN kodu' -AsSecureString
        $pinHash = [Net.NetworkCredential]::new('', $pin).Password | & $node "$source\kiosk\scripts\provision.cjs" pin-hash
        if ($LASTEXITCODE -ne 0 -or $pinHash -notmatch '^[0-9a-f]{128}$') { throw 'PIN 6–16 rakam olmalı.' }
    }
    $schema = ''
    $columnFile = "$work\member-columns.txt"
    if (!$pairing) {
        $schemaQuery = 'SELECT TRIM(RDB$FIELD_NAME) AS COLUMN_NAME FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = ''MEMBERS'' ORDER BY RDB$FIELD_POSITION'
        $encodedQuery = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($schemaQuery))
        $reader = "$work\Inspect\PanCafeReadOnly.exe"
        $schema = @"
[void][IO.Directory]::CreateDirectory($(Quote-PS "$work\Inspect"))
& $(Quote-PS "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") /nologo /platform:x86 /reference:System.Web.Extensions.dll $(Quote-PS "/out:$reader") $(Quote-PS "$source\scripts\PanCafeReadOnly.cs")
if (`$LASTEXITCODE -ne 0) { throw 'PanCafe sütun okuyucusu derlenemedi.' }
`$result = & $(Quote-PS $reader) $(Quote-PS $config.databasePath) $(Quote-PS $config.clientDirectory) '$encodedQuery'
if (`$LASTEXITCODE -ne 0) { throw 'PanCafe sütunları okunamadı.' }
`$rows = `$result | ConvertFrom-Json
`$columns = @(`$rows) | Select-Object -ExpandProperty COLUMN_NAME
if (!`$columns) { throw 'PanCafe MEMBERS tablosunda sütun bulunamadı.' }
`$columns | Set-Content -LiteralPath $(Quote-PS $columnFile) -Encoding UTF8
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
$apiProcess = Get-OwnedListener $apiPort 'node.exe' "$work\start-api.cjs"
$api = Health $apiHealth
$activeRelease = "$work\api-active-release.txt"
$runningRelease = if (Test-Path -LiteralPath $activeRelease) { [IO.File]::ReadAllText($activeRelease) }
if ($apiProcess -and (!$api -or $runningRelease -ne $releaseId)) {
    Write-Host 'S TECH API yeni sürümle yeniden açılıyor...'
    Stop-OwnedListener $apiPort $apiProcess
    $api = $null
}
if (!$api) {
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
STECH_SOURCE_DIR="$($source.Replace('\', '/'))"
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
if ($api.cafe -ne 'pancafe' -or !$api.firebaseBalanceWrite) { throw "Port $apiPort üzerinde beklenen PanCafe API yanıtı alınamadı." }
[IO.File]::WriteAllText($activeRelease, $releaseId)

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
            $probe = 'fetch(process.argv[1], {signal: AbortSignal.timeout(2000)}).then(r => {if (!r.ok) process.exitCode = 1;}, () => {process.exitCode = 1;});'
            & $node -e $probe "$site/api/v1/health"
            if ($LASTEXITCODE -eq 0) { $true }
        } finally { $env:NODE_EXTRA_CA_CERTS = $previousCa }
    }
}
if (!(& $httpsCheck)) {
    $caddyProcess = Get-OwnedListener 8443 'caddy.exe' $caddyfile
    if ($caddyProcess) { Stop-OwnedListener 8443 $caddyProcess }
    Start-Process -FilePath $caddy -ArgumentList 'run', '--config', "`"$caddyfile`"", '--adapter', 'caddyfile' `
        -WorkingDirectory $work -WindowStyle Hidden -RedirectStandardOutput "$work\caddy.log" -RedirectStandardError "$work\caddy-error.log"
    [void](Wait-Ready $httpsCheck "HTTPS hazır olmadı. Günlük: $work\caddy-error.log")
}

$kiosk = @{ mode = 'connected'; station = 'S TECH'; apiBaseUrl = "$site/api/v1"; deviceKey = $pairing.deviceKey; adminPinHash = $pairing.adminPinHash }
[void][IO.Directory]::CreateDirectory($transfer)
$generated = Join-Path $transfer 'A-Kiosk-Kur.cmd'
Make-KioskLauncher "$source\scripts\A-Kiosk-Kur.cmd" $generated $kiosk ([IO.File]::ReadAllText($certPath)) $kioskUrl $kioskSha256
$current = Health $apiHealth
if ($current.firebaseSync -eq 'error') { Write-Warning "Firebase eşitlemesi hata verdi. Yetkiyi ve Bridge ayarlarını kontrol et. Günlük: $work\api-error.log" }
else { Write-Host "Firebase eşitleme durumu: $($current.firebaseSync)" }
Write-Host "B hazır. A bilgisayarına kopyalayıp açacağın dosya: $generated" -ForegroundColor Green
Write-Host 'Sonraki açılışlarda masaüstündeki S TECH Kiosk kısayolunu kullan.'
