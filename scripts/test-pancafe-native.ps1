param(
    [Parameter(Mandatory=$true)][string]$BackupPath,
    [string]$ClientDirectory = 'C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Core'
)
$ErrorActionPreference='Stop'
$backup=(Resolve-Path -LiteralPath $BackupPath).Path
$backend=Join-Path $PSScriptRoot 'PanCafeBackend'
$output=Join-Path (Split-Path -Parent $PSScriptRoot) '.data\pancafe-native-tests'
New-Item -ItemType Directory -Path $output -Force | Out-Null
& node (Join-Path $backend 'BuildBackendHook.cjs') --fixture --output $output
if($LASTEXITCODE -ne 0){throw 'Native fixture build failed.'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$sources=@('PanCafeReadOnly.cs','PanCafeMemberWriter.cs','PanCafeBalanceWriter.cs','PanCafeHistoryReader.cs',
    'PanCafeNativeSessions.cs','PanCafeNativeCredits.cs','PanCafeNativeTickets.cs',
    'PanCafeBackend\NativeBridge.cs','PanCafeBackend\ControllerDatabase.cs','PanCafeBackend\FbDb.cs','PanCafeBackend\FbConnection.cs',
    'PanCafeBackend\LiveBackend.cs','PanCafeBackend\SessionConnectionWaiter.cs','PanCafeBackend\Balance.cs','PanCafeBackend\Session.cs',
    'PanCafeBackend\NativePhysicalFixtureTests.cs','PanCafeBackend\CoreBackendTests.cs','PanCafeBackend\BridgeIntegrationTests.cs') |
    ForEach-Object {Join-Path $PSScriptRoot $_}
$options=@('/nologo','/target:exe','/platform:x86','/unsafe+','/optimize+','/warnaserror+','/codepage:65001',
    '/reference:System.Web.Extensions.dll','/main:STech.PanCafeBackend.BridgeIntegrationTests',
    "/resource:$output\ControllerBackend.fixture.x86.dll,ControllerBackend.x86.dll",
    "/resource:$output\backend-fixture-profile.json,ControllerBackend.profile","/out:$output\BridgeIntegrationTests.exe")+$sources
& $compiler @options
if($LASTEXITCODE -ne 0){throw 'Test compilation failed.'}
& (Join-Path $output 'BridgeIntegrationTests.exe') $backup $ClientDirectory
if($LASTEXITCODE -ne 0){throw 'Isolated PanCafe native tests failed.'}
