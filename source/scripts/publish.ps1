param([string]$Dotnet='dotnet')
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
Push-Location $sourceRoot
try {
    & npm.cmd ci --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw 'npm ci failed'}
    & npm.cmd run typecheck
    if($LASTEXITCODE -ne 0){throw 'TypeScript check failed'}
    & npm.cmd run build
    if($LASTEXITCODE -ne 0){throw 'Extension build failed'}
    & node scripts/alarm.mjs
    & $Dotnet publish native/ClassroomQr.Host.csproj -c Release -o ../native --self-contained true
    if($LASTEXITCODE -ne 0){throw 'Native publish failed'}
    Write-Host 'Copy an FFmpeg win-x64 binary and its license/source information into ../native before distributing.'
} finally { Pop-Location }
