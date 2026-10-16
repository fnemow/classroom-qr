$ErrorActionPreference='Stop'
$expected=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'native\cn.classroom.qr_watch.json'))
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
    $baseKey=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
    try { foreach ($browserRoot in @('Software\Google\Chrome','Software\Microsoft\Edge')) {
    $subkey=$browserRoot+'\NativeMessagingHosts\cn.classroom.qr_watch'
    $key=$baseKey.OpenSubKey($subkey)
    if ($null -ne $key) {
        $registered=$key.GetValue(''); $key.Dispose()
        if ($registered -eq $expected) { $baseKey.DeleteSubKey($subkey,$false) }
        else { Write-Warning 'Registration belongs to another package location; it was left unchanged.' }
    }
    } } finally { $baseKey.Dispose() }
}
Write-Host 'Registration removed. Close the live window and remove the extension in Chrome / Edge.'
