$ErrorActionPreference = 'Stop'
# Work around this machine's full C: drive. No files are deleted.
$sourceRoot = Split-Path $PSScriptRoot -Parent
$previewRoot = 'D:\stech-build-cache\project'
if (-not (Test-Path -LiteralPath "$previewRoot\node_modules")) {
  throw 'Preview dependencies missing. Use a normal npm install on a drive with sufficient free space.'
}
foreach ($appName in @('api', 'mobile')) {
  Copy-Item -LiteralPath "$sourceRoot\apps\$appName\src" -Destination "$previewRoot\apps\$appName" -Recurse -Force
  Copy-Item -LiteralPath "$sourceRoot\apps\$appName\package.json" -Destination "$previewRoot\apps\$appName\package.json" -Force
}
Copy-Item -LiteralPath "$sourceRoot\packages\contracts\src" -Destination "$previewRoot\packages\contracts" -Recurse -Force
Copy-Item -LiteralPath "$sourceRoot\apps\mobile\app.config.ts" -Destination "$previewRoot\apps\mobile\app.config.ts" -Force
Copy-Item -LiteralPath "$sourceRoot\apps\mobile\assets" -Destination "$previewRoot\apps\mobile" -Recurse -Force
Write-Output "Preview sources synchronized to $previewRoot"
Write-Output 'Run npm run dev:api and npm run web from that directory in separate terminals.'
