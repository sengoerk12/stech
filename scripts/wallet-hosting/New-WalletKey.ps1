$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'STech-Kiosk-Sunucu'
[void][IO.Directory]::CreateDirectory($folder)
$privateFile = Join-Path $folder 'wallet-private.dpapi'
$publicFile = Join-Path $folder 'wallet-public.pem'
if ((Test-Path -LiteralPath $privateFile) -and (Test-Path -LiteralPath $publicFile)) {
    Write-Output "Mevcut anahtar korunuyor. cPanel icin genel anahtar: $publicFile"
    return
}
if ((Test-Path -LiteralPath $privateFile) -or (Test-Path -LiteralPath $publicFile)) {
    throw 'Anahtar dosyalarindan biri eksik. Mevcut dosyayi koruyup kontrol et.'
}
$generate = @'
const { generateKeyPairSync } = require('node:crypto');
const keys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
process.stdout.write(JSON.stringify(keys));
'@
$output = & node.exe -e $generate
if ($LASTEXITCODE -ne 0) { throw 'Wallet anahtari olusturulamadi.' }
$keys = $output | ConvertFrom-Json
[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')
$privateBytes = [Text.Encoding]::UTF8.GetBytes($keys.privateKey)
$protected = [Security.Cryptography.ProtectedData]::Protect($privateBytes, $null, 'CurrentUser')
[Array]::Clear($privateBytes, 0, $privateBytes.Length)
[IO.File]::WriteAllBytes($privateFile, $protected)
[IO.File]::WriteAllText($publicFile, $keys.publicKey)
Write-Output "cPanel icin genel anahtar: $publicFile"
