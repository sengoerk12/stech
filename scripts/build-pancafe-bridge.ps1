param([string]$OutputDirectory = 'D:\stech-build-cache\pancafe-bridge')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$compiler = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
& $compiler /nologo /platform:x86 /target:winexe /main:PanCafeBridge /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/win32manifest:$(Join-Path $PSScriptRoot 'pancafe-bridge.manifest')" "/out:$(Join-Path $OutputDirectory 'PanCafeBridge.exe')" (Join-Path $PSScriptRoot 'PanCafeReadOnly.cs') (Join-Path $PSScriptRoot 'PanCafeMemberWriter.cs') (Join-Path $PSScriptRoot 'PanCafeBalanceWriter.cs') (Join-Path $PSScriptRoot 'PanCafeHistoryReader.cs') (Join-Path $PSScriptRoot 'PanCafeBridge.cs')
if($LASTEXITCODE -ne 0) {throw 'Bridge build failed.'}
Write-Output "Bridge built in $OutputDirectory. Start explicitly and approve Windows elevation yourself."
