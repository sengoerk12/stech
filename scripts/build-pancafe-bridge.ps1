param([string]$OutputDirectory = 'D:\stech-build-cache\pancafe-bridge')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$compiler = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
$winMetadata = Join-Path $env:WINDIR 'System32\WinMetadata'
$winReferences = @('Foundation','Storage','Graphics','Media','Globalization') | ForEach-Object {
    '/reference:' + (Join-Path $winMetadata "Windows.$_.winmd")
}
$runtime = Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\System.Runtime\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Runtime.dll'
$winRuntime = Join-Path (Split-Path -Parent $compiler) 'System.Runtime.WindowsRuntime.dll'
$automationLibraries = @('UIAutomationClient','UIAutomationTypes','WindowsBase') | ForEach-Object {
    '/reference:' + (Join-Path $env:WINDIR ("Microsoft.NET\assembly\GAC_MSIL\$_\v4.0_4.0.0.0__31bf3856ad364e35\$_.dll"))
}
$sources = @('PanCafeReadOnly.cs','PanCafeMemberWriter.cs','PanCafeBalanceWriter.cs','PanCafeHistoryReader.cs',
    'PanCafeAdminWriter.cs','PanCafeProfileWriter.cs','PanCafeConnectedTerminals.cs','PanCafeNativeSessions.cs',
    'PanCafeNativeCredits.cs','PanCafeUiAutomation.cs','PanCafeNativeTickets.cs','PanCafeNativeNavigation.cs','PanCafeScreenText.cs','PanCafeBridge.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
& $compiler /nologo /platform:x86 /target:winexe /main:PanCafeBridge /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:Accessibility.dll "/reference:$runtime" "/reference:$winRuntime" "/win32manifest:$(Join-Path $PSScriptRoot 'pancafe-bridge.manifest')" "/out:$(Join-Path $OutputDirectory 'PanCafeBridge.exe')" $winReferences $automationLibraries $sources
if($LASTEXITCODE -ne 0) {throw 'Bridge build failed.'}
Write-Output "Bridge built in $OutputDirectory. Start explicitly and approve Windows elevation yourself."
