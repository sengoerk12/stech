param([string]$OutputDirectory = 'D:\stech-build-cache\pancafe-bridge')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$backend = Join-Path $PSScriptRoot 'PanCafeBackend'
& node (Join-Path $backend 'BuildBackendHook.cjs') --output $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw 'Native PanCafe bridge build failed.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$sources = @('PanCafeReadOnly.cs','PanCafeMemberWriter.cs','PanCafeBalanceWriter.cs','PanCafeHistoryReader.cs',
    'PanCafeAdminWriter.cs','PanCafeProfileWriter.cs','PanCafeConnectedTerminals.cs','PanCafeNativeSessions.cs',
    'PanCafeNativeCredits.cs','PanCafeNativeTickets.cs','PanCafeBridge.cs',
    'PanCafeBackend\NativeBridge.cs','PanCafeBackend\ControllerDatabase.cs','PanCafeBackend\FbDb.cs',
    'PanCafeBackend\FbConnection.cs','PanCafeBackend\LiveBackend.cs','PanCafeBackend\SessionConnectionWaiter.cs',
    'PanCafeBackend\Balance.cs','PanCafeBackend\Session.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
$options = @('/nologo','/platform:x86','/target:winexe','/unsafe+','/optimize+','/codepage:65001','/main:PanCafeBridge',
    '/reference:System.Web.Extensions.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',
    "/win32manifest:$(Join-Path $PSScriptRoot 'pancafe-bridge.manifest')",
    "/resource:$OutputDirectory\ControllerBackend.x86.dll,ControllerBackend.x86.dll",
    "/resource:$OutputDirectory\backend-profile.json,ControllerBackend.profile",
    "/out:$OutputDirectory\PanCafeBridge.exe") + $sources
& $compiler @options
if ($LASTEXITCODE -ne 0) { throw 'Bridge build failed.' }
Write-Output "Native bridge built in $OutputDirectory. Start explicitly and approve Windows elevation yourself."
