param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
$exePath = Join-Path $packageRoot 'native\ClassroomQr.Host.exe'
foreach ($file in @($exePath,(Join-Path $packageRoot 'native\ffmpeg.exe'),(Join-Path $packageRoot 'native\alarm.wav'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing package file: $file" }
}
$hostManifest = Join-Path $packageRoot 'native\cn.classroom.qr_watch.json'
$origins = @("chrome-extension://$ExtensionId/")
# Keep previously registered browser IDs when adding Chrome or Edge on the same package.
if (Test-Path -LiteralPath $hostManifest) {
    $previous = Get-Content -LiteralPath $hostManifest -Raw | ConvertFrom-Json
    $origins += @($previous.allowed_origins | Where-Object { $_ -cmatch '^chrome-extension://[a-p]{32}/$' })
}
$manifest = @{name='cn.classroom.qr_watch';description='Classroom QR monitor';path=$exePath;type='stdio';allowed_origins=@($origins | Select-Object -Unique)}
[System.IO.File]::WriteAllText($hostManifest,($manifest | ConvertTo-Json -Depth 4),(New-Object System.Text.UTF8Encoding($false)))
# Register each browser explicitly in both views; don't rely on Edge's Chrome fallback.
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
    $baseKey=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
    try {
        foreach ($browserRoot in @('Software\Google\Chrome','Software\Microsoft\Edge')) {
            $key=$baseKey.CreateSubKey($browserRoot+'\NativeMessagingHosts\cn.classroom.qr_watch')
            try { $key.SetValue('',$hostManifest,[Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
        }
    } finally { $baseKey.Dispose() }
}
Write-Host 'Installed for the current user. Return to the extension and start monitoring.'
Write-Host 'Keep this package at its current location, or run install.ps1 again after moving it.'
