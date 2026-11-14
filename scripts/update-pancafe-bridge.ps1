$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'STech-Kiosk-Sunucu\Bridge'
$installed = Join-Path $folder 'PanCafeBridge.exe'
$update = Join-Path $folder 'build\PanCafeBridge.exe'
try {
    if (!(Test-Path -LiteralPath $update -PathType Leaf)) { throw 'Bridge build missing.' }
    $old = @(Get-Process -Name PanCafeBridge -ErrorAction SilentlyContinue | Where-Object Path -eq $installed)
    foreach ($process in $old) {
        if (!$process.CloseMainWindow() -or !$process.WaitForExit(5000)) {
            Stop-Process -Id $process.Id
            if (!$process.WaitForExit(5000)) { throw 'Bridge did not stop.' }
        }
    }
    if (Test-Path -LiteralPath $installed) {
        $backup = Join-Path $folder 'PanCafeBridge.previous.exe'
        [IO.File]::Replace($update, $installed, $backup)
    } else {
        [IO.File]::Move($update, $installed)
    }
} catch {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $folder 'update-error.log')
    exit 1
}
