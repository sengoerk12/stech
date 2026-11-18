param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (!$OutputDirectory) {
    $OutputDirectory = Join-Path $project ('Kurulum-Ciktisi\Admin-PHP74-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($output)
$zipPath = Join-Path $output 'cPanel-admin.zip'
$sqlPath = Join-Path $output 'admin-kurulum.sql'
$guidePath = Join-Path $output 'KURULUM.md'
if (@($zipPath,$sqlPath,$guidePath) | Where-Object { Test-Path -LiteralPath $_ }) {
    throw 'Hedefte admin kurulum dosyalari zaten var. Yeni bir klasor sec.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($name in @('.htaccess','index.php','api.php','bridge.php','webhook.php','runtime.php','odeal-notification.php','maintenance.php')) {
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $PSScriptRoot $name), "admin/$name")
    }
    foreach ($name in @('app.js','style.css')) {
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $project "apps\admin\$name"), "admin/$name")
    }
} finally { $zip.Dispose() }

$sql = foreach ($name in @('odeal-inbox.sql','schema.sql')) { [IO.File]::ReadAllText((Join-Path $PSScriptRoot $name)) }
[IO.File]::WriteAllText($sqlPath, ($sql -join [Environment]::NewLine))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'KURULUM.md') -Destination $guidePath
Write-Host "Admin kurulum dosyalari: $output"
