param(
    [ValidateSet('Menu', 'Local', 'Server', 'Pair', 'Admin', 'Status')]
    [string]$Mode = 'Menu'
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$serverHome = Join-Path $env:LOCALAPPDATA 'STech-Kiosk-Sunucu'
$posHome = Join-Path $env:LOCALAPPDATA 'STech-OdealTunnel'
$bridgeHome = Join-Path $serverHome 'Bridge'
$bridgeConfig = Join-Path $bridgeHome 'connection.json'
$pairingFile = Join-Path $serverHome 'pairing.json'
$firebaseFile = Join-Path $serverHome 'firebase.json'
$activeKiosk = Join-Path $project 'kiosk\dist\current'
$port = 3091
$healthUrl = "http://127.0.0.1:$port/api/v1/health"
$adminUrl = "http://127.0.0.1:$port/admin/"
$env:Path += ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Text($Path, $Content) {
    [IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Test-Listener($Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Require-Program($Name, $Package) {
    if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
    Write-Host "$Name kuruluyor..."
    & winget.exe install --exact --id $Package --source winget --accept-source-agreements --accept-package-agreements | Out-Host
    if ($LASTEXITCODE) { throw "$Name kurulumu tamamlanamadi." }
    $env:Path += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User')
    if (!(Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name bulunamadi. Menuden yeniden baslat." }
}

function Get-Health($Url, $Headers = @{}) {
    try { Invoke-RestMethod -UseBasicParsing -Uri $Url -Headers $Headers -TimeoutSec 2 }
    catch { $null }
}

function Wait-Ready($Check, $Message) {
    $deadline = [DateTime]::Now.AddSeconds(30)
    do {
        $value = & $Check
        if ($value) { return $value }
        Start-Sleep -Milliseconds 700
    } while ([DateTime]::Now -lt $deadline)
    throw $Message
}

function Start-Background($File, $Arguments, $Folder, $Log, $Check) {
    Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $Folder -WindowStyle Hidden `
        -RedirectStandardOutput "$Log.log" -RedirectStandardError "$Log-error.log"
    return (Wait-Ready $Check "Baslatilamadi. Gunluk: $Log-error.log")
}

function Initialize-Server($SetupMode) {
    $installer = Join-Path $PSScriptRoot 'B-PanCafe-Kur.cmd'
    $previous = $env:STECH_SETUP_SELF
    $previousMode = $env:STECH_SETUP_MODE
    try {
        $env:STECH_SETUP_SELF = $installer
        $env:STECH_SETUP_MODE = $SetupMode
        $content = [IO.File]::ReadAllText($installer)
        $start = [regex]::Match($content, '(?m)^:STECH_POWERSHELL\r?\n')
        if (!$start.Success) { throw 'PanCafe kurulum dosyasi eksik.' }
        & ([scriptblock]::Create($content.Substring($start.Index + $start.Length)))
    } finally {
        $env:STECH_SETUP_SELF = $previous
        $env:STECH_SETUP_MODE = $previousMode
    }
}

function Start-Bridge($Config) {
    $url = "http://127.0.0.1:$($Config.port)/health"
    $headers = @{ Authorization = "Bearer $($Config.apiKey)" }
    $health = Get-Health $url $headers
    $exe = Join-Path $bridgeHome 'PanCafeBridge.exe'
    $stamp = Join-Path $bridgeHome 'source.sha256'
    $files = @(Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Name -like 'PanCafe*.cs' -or $_.Name -eq 'pancafe-bridge.manifest' } | Sort-Object Name)
    $sourceVersion = (($files | Get-FileHash -Algorithm SHA256).Hash -join [Environment]::NewLine)
    $installedVersion = if (Test-Path -LiteralPath $stamp) { [IO.File]::ReadAllText($stamp) }
    if (!(Test-Path -LiteralPath $exe) -or $sourceVersion -ne $installedVersion) {
        $staging = Join-Path $bridgeHome 'build'
        $build = Join-Path $PSScriptRoot 'build-pancafe-bridge.ps1'
        & $build -OutputDirectory $staging | Out-Host
        if (!(Test-Path -LiteralPath (Join-Path $staging 'PanCafeBridge.exe'))) { throw 'PanCafe koprusu derlenemedi.' }
        $updater = Join-Path $PSScriptRoot 'update-pancafe-bridge.ps1'
        $arguments = @('-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', ('"' + $updater + '"'))
        $upgrade = Start-Process -FilePath powershell.exe -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        if ($upgrade.ExitCode -ne 0) { throw "Kopru guncellenemedi. Gunluk: $bridgeHome\update-error.log" }
        Write-Text $stamp $sourceVersion
        $health = $null
    }
    if (!$health) {
        if (Test-Listener $Config.port) { throw 'PanCafe kopru portu baska bir uygulamada acik.' }
        $panCafe = Split-Path -Parent (Split-Path -Parent $Config.databasePath)
        if (!(Get-Process pncserver -ErrorAction SilentlyContinue)) {
            $panCafeExe = Join-Path $panCafe 'pncserver.exe'
            if (!(Test-Path -LiteralPath $panCafeExe)) { throw 'PanCafe Pro uygulamasini acip yeniden dene.' }
            Start-Process -FilePath $panCafeExe -WorkingDirectory $panCafe
        }
        Start-Process -FilePath $exe -WorkingDirectory $bridgeHome -Verb RunAs -WindowStyle Hidden
        $health = Wait-Ready { Get-Health $url $headers } 'PanCafe koprusu acilmadi. Windows izin ekranini ve Bridge\status.json dosyasini kontrol et.'
    }
    if (!$health.connected -or $health.installationId -ne $Config.installationId) {
        throw 'PanCafe koprusu kayitli kurulumla eslesmedi.'
    }
    try {
        [void](Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$($Config.port)/computers" -Headers $headers -TimeoutSec 5)
    } catch {
        throw 'PanCafe koprusunden bilgisayar listesi okunamadi.'
    }
}

function Get-ServerEnvironment($Config, $Pairing) {
    $posEnv = Join-Path $posHome 'odeal-api.env'
    if (Test-Path -LiteralPath $posEnv) { return $posEnv }
    $installedEnv = Join-Path $serverHome 'api.env'
    if (Test-Path -LiteralPath $installedEnv) { return $installedEnv }
    $envFile = Join-Path $serverHome 'launcher-api.env'
    $adminSetupSetting = if (Test-Path -LiteralPath $envFile) {
        Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*ADMIN_SETUP_TOKEN\s*=' } | Select-Object -Last 1
    }
    $folder = $serverHome.Replace('\', '/')
    Write-Text $envFile @"
ENVIRONMENT=development
CAFE_ADAPTER=pancafe
PAYMENT_PROVIDER=mock
PANCAFE_PAYMENT_SIMULATION=false
PANCAFE_BALANCE_CREDIT=$(([bool]$Config.allowBalanceCredit).ToString().ToLowerInvariant())
PANCAFE_BRIDGE_CONFIG="$folder/Bridge/connection.json"
DATA_DIR="$folder/api-data"
KIOSK_DEVICE_KEY=$($Pairing.deviceKey)
FIREBASE_SYNC_ENABLED=true
FIREBASE_BALANCE_WRITE_ENABLED=$(([bool]$Config.allowFirebaseBalanceWrite).ToString().ToLowerInvariant())
FIREBASE_PROJECT_ID=wallet-stech
GOOGLE_APPLICATION_CREDENTIALS="$folder/firebase.json"
$adminSetupSetting
"@
    return $envFile
}

function Start-Api($Config, $Pairing) {
    $existing = Get-Health $healthUrl
    if ($existing) {
        if ($existing.cafe -ne 'pancafe') { throw "Port $port uzerindeki API PanCafe modunda degil." }
    } else {
        if (Test-Listener $port) { throw "Port $port baska bir uygulama tarafindan kullaniliyor." }
        $app = Join-Path $project 'apps\api\dist\apps\api\src\app.js'
        if (!(Test-Path -LiteralPath $app)) {
            Push-Location -LiteralPath $project
            try {
                if (!(Test-Path -LiteralPath 'node_modules\typescript')) {
                    & npm.cmd ci --workspace '@stech/api' --include-workspace-root=false | Out-Host
                    if ($LASTEXITCODE) { throw 'API bagimliliklari kurulamadi.' }
                }
                & npm.cmd run build:api | Out-Host
                if ($LASTEXITCODE) { throw 'API derlenemedi.' }
            } finally { Pop-Location }
        }
        $envFile = Get-ServerEnvironment $Config $Pairing
        $node = (Get-Command node.exe).Source
        $entry = Join-Path $PSScriptRoot 'start-server.cjs'
        $cwd = Join-Path $project 'apps\api'
        $oldAdminDir = $env:ADMIN_WEB_DIR
        $oldKioskDir = $env:KIOSK_UI_DIR
        try {
            $env:ADMIN_WEB_DIR = Join-Path $project 'apps\admin'
            $env:KIOSK_UI_DIR = Join-Path $project 'kiosk\ui'
            $arguments = @(('"' + "--env-file=$envFile" + '"'), ('"' + $entry + '"'))
            [void](Start-Background $node $arguments $cwd (Join-Path $serverHome 'launcher-api') { Get-Health $healthUrl })
        } finally {
            $env:ADMIN_WEB_DIR = $oldAdminDir
            $env:KIOSK_UI_DIR = $oldKioskDir
        }
    }
    $connected = Get-Health "http://127.0.0.1:$port/api/v1/kiosk/pc-availability" @{ 'X-Kiosk-Key' = $Pairing.deviceKey }
    if (!$connected) { throw 'API acik ancak PanCafe veya kiosk eslestirmesi dogrulanamadi.' }
}

function Start-Pos {
    if (!(Test-Path -LiteralPath (Join-Path $posHome 'odeal-api.env'))) { return }
    $gateway = Join-Path $PSScriptRoot 'odeal-webhook-gateway.cjs'
    $node = (Get-Command node.exe).Source
    if (!(Test-Listener 3011)) {
        [void](Start-Background $node ('"' + $gateway + '"') $posHome (Join-Path $posHome 'gateway') { Test-Listener 3011 })
    }
    $envFile = Join-Path $posHome 'odeal-api.env'
    $endpoint = (& $node "--env-file=$envFile" -p 'new URL(process.env.ODEAL_WEBHOOK_BASE_URL).origin')
    if ($LASTEXITCODE -or $endpoint -notmatch '^https://[a-zA-Z0-9.-]+$') { throw 'Odeal HTTPS adresi okunamadi.' }
    $ngrok = (Get-Command ngrok.exe -ErrorAction Stop).Source
    $ngrokHealth = { (Get-Health 'http://127.0.0.1:4040/api/tunnels').tunnels | Where-Object public_url -eq $endpoint }
    if (!(& $ngrokHealth)) {
        if (Test-Listener 4040) { throw 'Baska bir ngrok oturumu acik. Odeal adresinin ayarini kontrol et.' }
        [void](Start-Background $ngrok @('http', 'http://127.0.0.1:3011', "--url=$endpoint", '--inspect=false', '--log=stdout') `
            $posHome (Join-Path $posHome 'ngrok') $ngrokHealth)
    }
    Write-Host 'Odeal HTTPS tuneli acik.' -ForegroundColor Green
}

function Start-Lan($Pairing) {
    $address = $Pairing.bIp
    $clientAddress = $Pairing.aIp
    $localAddresses = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
    $parsed = $null
    if (![Net.IPAddress]::TryParse($clientAddress, [ref]$parsed) -or
        $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        !$address -or $address -notin $localAddresses) {
        throw 'A veya B adresi eksik veya degismis. Menuden 3 ile eslestirmeyi yeniden olustur.'
    }
    $caddyExe = (Get-Command caddy.exe -ErrorAction Stop).Source
    $site = "https://${address}:8443"
    $config = Join-Path $serverHome 'Caddyfile'
    $env:XDG_DATA_HOME = Join-Path $serverHome 'caddy-data'
    $env:XDG_CONFIG_HOME = Join-Path $serverHome 'caddy-config'
    $script:certificate = Join-Path $env:XDG_DATA_HOME 'caddy\pki\authorities\local\root.crt'
    $node = (Get-Command node.exe).Source
    $probe = {
        if (!(Test-Path -LiteralPath $script:certificate)) { return }
        $previous = $env:NODE_EXTRA_CA_CERTS
        try {
            $env:NODE_EXTRA_CA_CERTS = $script:certificate
            & $node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)process.exitCode=1},()=>{process.exitCode=1})' "$site/api/v1/health"
            return $LASTEXITCODE -eq 0
        } finally { $env:NODE_EXTRA_CA_CERTS = $previous }
    }
    $caddyConfig = @"
{
    admin off
    auto_https disable_redirects
    skip_install_trust
    default_sni $address
}
$site {
    bind $address
    tls internal
    @kiosk {
        remote_ip $address $parsed
        path /api/v1/health /api/v1/kiosk/* /api/v1/me/dashboard /api/v1/me/transactions /api/v1/me/session-history /api/v1/auth/logout
    }
    handle @kiosk {
        reverse_proxy 127.0.0.1:$port
    }
    handle {
        respond 404
    }
}
"@
    $changed = !(Test-Path -LiteralPath $config) -or [IO.File]::ReadAllText($config) -ne $caddyConfig
    if ($changed -or !(& $probe)) {
        if (Test-Listener 8443) {
            $listener = Get-NetTCPConnection -LocalPort 8443 -State Listen | Select-Object -First 1
            $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
            if ($owner.Name -ne 'caddy.exe' -or !$owner.CommandLine.Contains($config)) { throw '8443 portu baska bir uygulamada acik.' }
            Stop-Process -Id $owner.ProcessId
            [void](Wait-Ready { !(Test-Listener 8443) } 'Eski HTTPS dinleyicisi kapanmadi.')
        }
        if ($changed) { Write-Text $config $caddyConfig }
        [void](Start-Background $caddyExe @('run', '--config', ('"' + $config + '"'), '--adapter', 'caddyfile') `
            $serverHome (Join-Path $serverHome 'caddy') $probe)
    }
    Write-Host "B kiosku icin HTTPS: $site" -ForegroundColor Green
}

function Get-KioskSettings($Pairing, $Url) {
    if (![regex]::IsMatch([string]$Pairing.deviceKey, '^[a-zA-Z0-9_-]{40,}$') -or
        ![regex]::IsMatch([string]$Pairing.adminPinHash, '^[a-fA-F0-9]{128}$')) {
        throw 'Kiosk anahtari veya PIN ayari eksik. Ilk kurulumu yeniden ac.'
    }
    return @{ mode = 'connected'; station = 'S TECH'; apiBaseUrl = $Url; deviceKey = $Pairing.deviceKey; adminPinHash = $Pairing.adminPinHash }
}

function Require-KioskBuild {
    if (!(Test-Path -LiteralPath (Join-Path $activeKiosk 'kiosk.exe')) -or !(Test-Path -LiteralPath (Join-Path $activeKiosk 'resources\app.asar'))) {
        Write-Host 'Kiosk ilk kez hazirlaniyor. Derleme birkac dakika surebilir.'
        & (Join-Path $PSScriptRoot 'build-kiosk.ps1')
    }
}

function Open-LocalKiosk($Pairing) {
    $running = @(Get-Process -Name kiosk -ErrorAction SilentlyContinue)
    $exe = Join-Path $activeKiosk 'kiosk.exe'
    if ($running | Where-Object { $_.Path -ne $exe }) { throw 'Daha once acilmis baska bir kiosk var. Ctrl+Alt+Q ve yetkili PIN ile kapatip yeniden dene.' }
    if ($running) { Write-Host 'Kiosk zaten acik.'; return }
    $settings = Get-KioskSettings $Pairing "http://127.0.0.1:$port/api/v1"
    $env:STECH_KIOSK_CONFIG = Join-Path $serverHome 'local-kiosk.config.json'
    Write-Text $env:STECH_KIOSK_CONFIG ($settings | ConvertTo-Json)
    Start-Process -FilePath $exe -WorkingDirectory $activeKiosk -ArgumentList '--portrait-preview'
    Write-Host 'Kiosk acildi.' -ForegroundColor Green
}

function Export-Kiosk($Pairing) {
    $output = Join-Path $project 'Kurulum-Ciktisi'
    [void][IO.Directory]::CreateDirectory($output)
    $stage = Join-Path $output ('staging-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($stage)
    $tempZip = Join-Path $stage 'temp.zip'
    $client = Join-Path $stage 'B-Kiosk'
    [void][IO.Directory]::CreateDirectory($client)
    try {
        Copy-Item -LiteralPath $activeKiosk -Destination (Join-Path $client 'program') -Recurse
        Copy-Item -LiteralPath $script:certificate -Destination (Join-Path $client 'root.crt')
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'B-Kiosk-Baslat.cmd') -Destination (Join-Path $client 'Kiosk-Baslat.cmd')
        $settings = Get-KioskSettings $Pairing "https://$($Pairing.bIp):8443/api/v1"
        Write-Text (Join-Path $client 'kiosk.config.json') ($settings | ConvertTo-Json)
        Compress-Archive -LiteralPath $client -DestinationPath $tempZip -CompressionLevel Fastest
        $zip = Join-Path $output 'B-Kiosk.zip'
        if (Test-Path -LiteralPath $zip) { [IO.File]::Replace($tempZip, $zip, [NullString]::Value) }
        else { [IO.File]::Move($tempZip, $zip) }
        Write-Host "B bilgisayarina bu paketi kopyala: $zip" -ForegroundColor Green
    } finally {
        $resolved = (Resolve-Path -LiteralPath $stage).Path
        if ($resolved -eq $stage -and (Split-Path -Parent $resolved) -eq $output) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}

try {
    $interactive = $Mode -eq 'Menu'
    if ($interactive) {
        Write-Host 'S TECH' -ForegroundColor Cyan
        Write-Host '1  PanCafe ve kiosk bu bilgisayarda'
        Write-Host '2  A bilgisayari: PanCafe sunucusunu baslat'
        Write-Host '3  A bilgisayari: Ilk kurulum / B kiosk paketini olustur'
        Write-Host '4  Admin panelini ac'
        Write-Host '5  Durumu goster'
        $Mode = @{ '1' = 'Local'; '2' = 'Server'; '3' = 'Pair'; '4' = 'Admin'; '5' = 'Status' }[(Read-Host 'Secim').Trim()]
        if (!$Mode) { return }
    }
    if ($Mode -eq 'Admin') {
        if (!(Get-Health $healthUrl)) {
            throw 'Sunucu kapali. PanCafe bilgisayarinda once 1 veya 2 ile sunucuyu baslat, sonra 4 ile admin panelini ac.'
        }
        Start-Process -FilePath $adminUrl
        return
    }
    if ($Mode -eq 'Status') {
        $api = Get-Health $healthUrl
        $bridge = if (Test-Path -LiteralPath $bridgeConfig) { Get-Content -LiteralPath $bridgeConfig -Raw | ConvertFrom-Json }
        $connection = if ($bridge) { Get-Health "http://127.0.0.1:$($bridge.port)/health" @{ Authorization = "Bearer $($bridge.apiKey)" } }
        Write-Host ('PanCafe koprusu: ' + $(if ($connection.connected) { 'bagli' } else { 'kapali' }))
        Write-Host ('Backend: ' + $(if ($api) { 'acik' } else { 'kapali' }))
        Write-Host ('Firebase: ' + $api.firebaseSync)
        Write-Host ('Kiosk: ' + $(if (Get-Process kiosk -ErrorAction SilentlyContinue) { 'acik' } else { 'kapali' }))
        Write-Host ('Odeal tuneli: ' + $(if ((Get-Health 'http://127.0.0.1:4040/api/tunnels').tunnels) { 'acik' } else { 'kapali' }))
        Write-Host "Yonetim paneli: $adminUrl"
        if ($interactive) { [void](Read-Host 'Kapatmak icin Enter') }
        return
    }
    Require-Program node.exe OpenJS.NodeJS.LTS
    if ([int](& node.exe -p "process.versions.node.split('.')[0]") -lt 22) { throw 'Node.js 22 veya ustu gerekli.' }
    if ($Mode -in @('Local', 'Pair')) { Require-KioskBuild }
    $firstSetup = @(@($bridgeConfig, $pairingFile, $firebaseFile) | Where-Object { !(Test-Path -LiteralPath $_) }).Count -gt 0
    if ($Mode -eq 'Pair') {
        Require-Program caddy.exe CaddyServer.Caddy
        Initialize-Server 'lan'
    } elseif ($firstSetup) {
        if ($Mode -eq 'Server') { throw 'Ilk kurulum icin menude 3 secenegini kullan.' }
        Initialize-Server 'local'
    }
    $bridge = Get-Content -LiteralPath $bridgeConfig -Raw | ConvertFrom-Json
    $pairing = Get-Content -LiteralPath $pairingFile -Raw | ConvertFrom-Json
    Start-Bridge $bridge
    Start-Api $bridge $pairing
    Write-Host "PanCafe ve backend hazir. Yonetim paneli: $adminUrl" -ForegroundColor Green
    if ($Mode -in @('Server', 'Pair')) { Start-Lan $pairing }
    try { Start-Pos } catch { Write-Warning $_.Exception.Message }
    if ($Mode -eq 'Pair') { Export-Kiosk $pairing }
    if ($Mode -eq 'Local') { Open-LocalKiosk $pairing }
    if ($Mode -eq 'Pair' -and $interactive) { [void](Read-Host 'Kapatmak icin Enter') }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
