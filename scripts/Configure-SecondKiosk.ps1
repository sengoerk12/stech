param(
    [Parameter(Mandatory=$true)][string]$KioskIp,
    [string]$PosDeviceCode,
    [string]$UpdateZip
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (!$UpdateZip) { $UpdateZip = Join-Path $project 'Kurulum-Ciktisi\B-Kiosk-Neomi-v18.zip' }
$server = Join-Path $env:LOCALAPPDATA 'STech-Kiosk-Sunucu'
$posEnv = Join-Path $env:LOCALAPPDATA 'STech-OdealTunnel\odeal-api.env'
$first = Get-Content -LiteralPath (Join-Path $server 'pairing.json') -Raw | ConvertFrom-Json
$configPath = Join-Path $server 'kiosk-2.json'
$previous = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
$address = $null
if ($KioskIp -cnotmatch '^\d{1,3}(\.\d{1,3}){3}$' -or
    ![Net.IPAddress]::TryParse($KioskIp, [ref]$address) -or
    $address.IPAddressToString -in @($first.aIp, $first.bIp, '0.0.0.0', '255.255.255.255') -or
    [Net.IPAddress]::IsLoopback($address)) {
    throw 'Ikinci kiosk icin diger cihazlardan farkli, gecerli bir yerel IPv4 adresi gir.'
}
if ([string]$first.adminPinHash -cnotmatch '^[a-fA-F0-9]{128}$' -or
    [string]$first.deviceKey -cnotmatch '^[a-zA-Z0-9_-]{40,}$' -or
    [string]$first.bIp -cnotmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw 'A ve ilk kioskun LAN eslestirmesi bulunamadi. Once mevcut kurulumu kontrol et.'
}

if (!$PSBoundParameters.ContainsKey('PosDeviceCode')) { $PosDeviceCode = $previous.posDeviceCode }
if ($PosDeviceCode) {
    if ($PosDeviceCode -cnotmatch '^[a-zA-Z0-9_-]{1,100}$' -or !(Test-Path -LiteralPath $posEnv)) {
        throw 'Odeal cihaz kodunu ve A bilgisayarindaki POS ayarini kontrol et.'
    }
    $currentPos = & node.exe '--env-file' $posEnv -p 'String(process.env.ODEAL_DEVICE_CODE||String())'
    if ($LASTEXITCODE -or !$currentPos -or $PosDeviceCode -ceq $currentPos) {
        throw 'Ikinci POS icin ilk POS kodundan farkli bir Odeal cihaz kodu gerekli.'
    }
    $hostedEnv = Join-Path $server 'hosted-admin.env'
    if ((Test-Path -LiteralPath $hostedEnv) -and
        ((Get-Content -LiteralPath $hostedEnv) -match '^\s*HOSTED_ADMIN_ODEAL_RELAY\s*=\s*true\s*$')) {
        throw 'Ikinci POS icin bulut Odeal bildirim alicisina da ikinci cihaz kodu eklenmeli.'
    }
}
if ($previous.posDeviceCode -and $PosDeviceCode -cne $previous.posDeviceCode) {
    throw 'Ikinci POS zaten eslesmis. Kod degistirmeden once bu POS ile yapilan bekleyen odemeleri kontrol et.'
}

$key = $previous.deviceKey
if (!$key) {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $key = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
$settings = @{ ip = $address.IPAddressToString; deviceKey = $key }
if ($PosDeviceCode) { $settings.posDeviceCode = $PosDeviceCode }

$output = Join-Path $project 'Kurulum-Ciktisi'
$archive = Join-Path $output 'Kiosk-2-Kurulum.zip'
if (!$previous -or !(Test-Path -LiteralPath $archive) -or $PSBoundParameters.ContainsKey('UpdateZip')) {
    $cert = Join-Path $server 'caddy-data\caddy\pki\authorities\local\root.crt'
    if (!(Test-Path -LiteralPath $cert -PathType Leaf) -or !(Test-Path -LiteralPath $UpdateZip -PathType Leaf)) {
        throw 'A bilgisayarinda mevcut HTTPS sertifikasi ve kiosk program guncelleme ZIP dosyasi gerekli.'
    }
    $runtime = Join-Path $project 'kiosk\dist\current'
    foreach ($file in 'kiosk.exe','ffmpeg.dll','icudtl.dat','resources.pak','v8_context_snapshot.bin','locales\en-US.pak') {
        if (!(Test-Path -LiteralPath (Join-Path $runtime $file) -PathType Leaf)) {
            throw 'Tam kiosk calisma dosyalari eksik. Once scripts\build-kiosk.ps1 dosyasini calistir.'
        }
    }
    $bundle = Join-Path $output ('Kiosk-2-Kurulum-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($bundle)
    try {
        $update = Join-Path $bundle 'update'
        Expand-Archive -LiteralPath $UpdateZip -DestinationPath $update
        $updateExe = Get-Item -LiteralPath (Join-Path $update 'program\kiosk.exe')
        $runtimeExe = Get-Item -LiteralPath (Join-Path $runtime 'kiosk.exe')
        if ($updateExe.VersionInfo.FileVersion -ne $runtimeExe.VersionInfo.FileVersion) {
            throw 'Guncelleme paketiyle Electron calisma dosyalarinin surumleri uyusmuyor.'
        }
        $program = Join-Path $bundle 'program'
        Copy-Item -LiteralPath $runtime -Destination $program -Recurse
        Copy-Item -LiteralPath $updateExe.FullName -Destination (Join-Path $program 'kiosk.exe') -Force
        Copy-Item -LiteralPath (Join-Path $update 'program\resources\app.asar') -Destination (Join-Path $program 'resources\app.asar') -Force
        Copy-Item -LiteralPath $cert -Destination (Join-Path $bundle 'root.crt')
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'B-Kiosk-Baslat.cmd') -Destination (Join-Path $bundle 'Kiosk-Baslat.cmd')
        $client = @{
            mode='connected'; station='S TECH - Kiosk 2'; apiBaseUrl="https://$($first.bIp):8443/api/v1";
            deviceKey=$key; adminPinHash=$first.adminPinHash
        }
        [IO.File]::WriteAllText((Join-Path $bundle 'kiosk.config.json'), ($client | ConvertTo-Json))
        $stagedZip = Join-Path $bundle 'ready.zip'
        $contents = 'program','root.crt','Kiosk-Baslat.cmd','kiosk.config.json' | ForEach-Object { Join-Path $bundle $_ }
        Compress-Archive -LiteralPath $contents -DestinationPath $stagedZip -CompressionLevel Fastest
        if (Test-Path -LiteralPath $archive) { [IO.File]::Replace($stagedZip,$archive,[NullString]::Value) }
        else { [IO.File]::Move($stagedZip,$archive) }
        Write-Host "Ikinci kiosk paketi $archive"
    } finally {
        $resolved = (Resolve-Path -LiteralPath $bundle).Path
        if ($resolved -eq $bundle -and (Split-Path -Parent $resolved) -eq (Resolve-Path -LiteralPath $output).Path) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
[IO.File]::WriteAllText($configPath, ($settings | ConvertTo-Json))
if ($PosDeviceCode) { Write-Host 'Ikinci POS eslemesi kaydedildi.' }
else { Write-Host 'Ikinci kioskun POS ile bakiye yuklemesi cihaz kodu eklenince acilacak.' }
Write-Host 'Bekleyen POS islemleri bitince A bilgisayarinda S TECH Baslat menusunden 7, sonra 2 sec.'
