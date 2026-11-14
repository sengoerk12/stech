$ErrorActionPreference = 'Stop'
$kiosk = Join-Path (Split-Path -Parent $PSScriptRoot) 'kiosk'
$dist = Join-Path $kiosk 'dist'
$current = Join-Path $dist 'current'
$staging = Join-Path $dist ('.build-' + [Guid]::NewGuid().ToString('N'))

try {
    if (Get-Process kiosk -ErrorAction SilentlyContinue | Where-Object Path -eq (Join-Path $current 'kiosk.exe')) {
        throw 'Once acik kiosku Ctrl+Alt+Q ve yetkili PIN ile kapat.'
    }
    Push-Location -LiteralPath $kiosk
    try {
        if (!(Test-Path -LiteralPath 'node_modules\.bin\electron-builder.cmd')) {
            npm.cmd ci
            if ($LASTEXITCODE) { throw 'Kiosk bagimliliklari kurulamadi.' }
        }
        npm.cmd test
        if ($LASTEXITCODE) { throw 'Kiosk testleri basarisiz.' }
        npm.cmd run pack:win -- "--config.directories.output=$staging"
        if ($LASTEXITCODE) { throw 'Windows kiosk derlemesi tamamlanamadi.' }
    } finally { Pop-Location }

    $built = Join-Path $staging 'win-unpacked'
    if (!(Test-Path -LiteralPath (Join-Path $built 'kiosk.exe')) -or
        !(Test-Path -LiteralPath (Join-Path $built 'resources\app.asar'))) { throw 'Derleme ciktisi eksik.' }
    $backup = Join-Path $staging 'previous'
    if (Test-Path -LiteralPath $current) { [IO.Directory]::Move($current, $backup) }
    try { [IO.Directory]::Move($built, $current) }
    catch {
        if (Test-Path -LiteralPath $backup) { [IO.Directory]::Move($backup, $current) }
        throw
    }
    Write-Host 'Kiosk derlendi. Proje ana klasorundeki S-TECH-Baslat.cmd dosyasini ac.' -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $staging) {
        $resolved = (Resolve-Path -LiteralPath $staging).Path
        if ($resolved -eq $staging -and (Split-Path -Parent $resolved) -eq $dist) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
