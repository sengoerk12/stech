param(
  [Parameter(Mandatory=$true)][string]$Database,
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$MemberId,
  [Parameter(Mandatory=$true)][string]$ExpectedUsername,
  [string]$ClientDirectory = 'D:\Pan Group\Core',
  [string]$OutputDirectory = 'D:\stech-build-cache\pancafe-inspection'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$reader = Join-Path $OutputDirectory 'PanCafeReadOnly.exe'
$source = Join-Path $PSScriptRoot 'PanCafeReadOnly.cs'
& "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" /nologo /platform:x86 /reference:System.Web.Extensions.dll "/out:$reader" $source
if ($LASTEXITCODE -ne 0) { throw 'PanCafe reader could not be built.' }
$query = "SELECT ID, USERNAME, CAST(BAKIYE AS DECIMAL(18,2)) AS BALANCE_TL, CAST(AVAILBONUS AS DECIMAL(18,2)) AS BONUS_TL, ACCTYPE, ACCSTATUS FROM MEMBERS WHERE ID=$MemberId"
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($query))
$result = & $reader $Database $ClientDirectory $encoded
if ($LASTEXITCODE -ne 0) { throw 'PanCafe read failed. No member binding was activated.' }
$rows = @($result | ConvertFrom-Json)
if ($rows.Count -ne 1 -or [int]$rows[0].ID -ne $MemberId -or $rows[0].USERNAME.Trim() -ine $ExpectedUsername.Trim()) {
  throw 'Member ID and username were not verified. No member binding was activated.'
}
$rows | ConvertTo-Json -Compress
