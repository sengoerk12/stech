$ErrorActionPreference = 'Stop'

function Read-Private($Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
}

function Encode-Private($Value) {
    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}

function New-RandomHex($Size) {
    $bytes = New-Object byte[] $Size
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

$folder = Join-Path $env:LOCALAPPDATA 'STech-Kiosk-Sunucu'
$posFile = Join-Path $env:LOCALAPPDATA 'STech-OdealTunnel\odeal-api.env'
[void][IO.Directory]::CreateDirectory($folder)
$bridgeEnv = Join-Path $folder 'hosted-admin.env'
$config = Join-Path $folder 'stech-admin-cloud.php'
if ((Test-Path -LiteralPath $bridgeEnv) -or (Test-Path -LiteralPath $config)) {
    throw 'Bulut admin ayarlari zaten var. Dosyalari koruyup mevcut ayarlari kullan.'
}

$username = (Read-Host 'Web admin kullanici adi').Trim().ToLowerInvariant()
if ($username -cnotmatch '^[a-z0-9_.-]{3,40}$') { throw 'Gecersiz yonetici adi.' }
$password = Read-Private 'Web admin sifresi (en az 12 karakter)'
if ($password.Length -lt 12 -or [Text.Encoding]::UTF8.GetByteCount($password) -gt 512) { throw 'Gecersiz sifre uzunlugu.' }
$confirmation = Read-Private 'Web admin sifresini tekrar yaz'
if ($password -cne $confirmation) { throw 'Web admin sifreleri ayni degil.' }
$mysqlUser = (Read-Host 'cPanel tam veritabani kullanici adi').Trim()
if ($mysqlUser -cnotmatch '^[a-zA-Z0-9_]{1,80}$') { throw 'Gecersiz veritabani kullanici adi.' }
$mysqlPassword = Read-Private 'Veritabani kullanicisinin sifresi'
if (!$mysqlPassword) { throw 'Veritabani sifresi bos.' }

$odealKey = ''
$device = ''
if (Test-Path -LiteralPath $posFile) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $posValues = & $node '--env-file' $posFile -p 'JSON.stringify([process.env.ODEAL_REQUEST_KEY||String(),process.env.ODEAL_DEVICE_CODE||String()])' | ConvertFrom-Json
    if ($LASTEXITCODE) { throw 'Odeal ayar dosyasi okunamadi.' }
    $odealKey = [string]$posValues[0]
    $device = [string]$posValues[1]
}

$key = New-RandomHex 32
$salt = New-RandomHex 16
$derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($password, [Text.Encoding]::UTF8.GetBytes($salt), 600000, [Security.Cryptography.HashAlgorithmName]::SHA256)
try { $verifier = [BitConverter]::ToString($derive.GetBytes(32)).Replace('-', '').ToLowerInvariant() } finally { $derive.Dispose() }
$private = @"
<?php
return [
    'db_user' => '$mysqlUser',
    'db_password' => base64_decode('$(Encode-Private $mysqlPassword)'),
    'bridge_key' => '$key',
    'owner' => '$username',
    'owner_salt' => '$salt',
    'owner_verifier' => '$verifier',
    'odeal_enabled' => false,
    'odeal_request_key' => base64_decode('$(Encode-Private $odealKey)'),
    'odeal_device' => base64_decode('$(Encode-Private $device)'),
];
"@
[IO.File]::WriteAllText($config, $private)
[IO.File]::WriteAllText($bridgeEnv, @"
HOSTED_ADMIN_URL=https://stechespor.com/wallet/admin/
HOSTED_ADMIN_BRIDGE_KEY=$key
HOSTED_ADMIN_ODEAL_RELAY=false
"@)
Write-Host "cPanel'de public_html disina yuklenecek dosya: $config"
Write-Host 'A web paneline veri gonderecek. Odeal adres degisikligi ayri adimda yapilir.'
