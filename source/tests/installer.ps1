param([string]$PackageRoot,[string]$FixtureRoot)
$ErrorActionPreference='Stop'
$testId=[Guid]::NewGuid().ToString('N')
$registryRoot='Software\ClassroomQrInstallTest\'+$testId
$fixture=Join-Path $FixtureRoot $testId
New-Item -ItemType Directory -Force (Join-Path $fixture 'native') | Out-Null
foreach($file in @('ClassroomQr.Host.exe','ffmpeg.exe','alarm.wav')) {
    [IO.File]::WriteAllText((Join-Path $fixture ('native\'+$file)),'fixture')
}
foreach($script in @('install.ps1','uninstall.ps1')) {
    $text=[IO.File]::ReadAllText((Join-Path $PackageRoot $script))
    $text=$text.Replace('Software\Google\Chrome',($registryRoot+'\Chrome')).Replace('Software\Microsoft\Edge',($registryRoot+'\Edge'))
    [IO.File]::WriteAllText((Join-Path $fixture $script),$text)
}
function Assert($ok,$message) {if(-not $ok){throw $message}}
$manifestPath=Join-Path $fixture 'native\cn.classroom.qr_watch.json'
try {
    & (Join-Path $fixture 'install.ps1') -ExtensionId ('a'*32)
    & (Join-Path $fixture 'install.ps1') -ExtensionId ('b'*32)
    & (Join-Path $fixture 'install.ps1') -ExtensionId ('b'*32)
    $manifest=Get-Content $manifestPath -Raw | ConvertFrom-Json
    Assert ($manifest.allowed_origins.Count -eq 2) 'IDs were lost or duplicated'
    foreach($id in @(('a'*32),('b'*32))) {Assert ($manifest.allowed_origins -contains "chrome-extension://$id/") 'ID missing'}
    $invalidRejected=$false
    try { & (Join-Path $fixture 'install.ps1') -ExtensionId 'invalid' } catch {$invalidRejected=$true}
    Assert $invalidRejected 'Invalid extension ID was accepted'
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
        try {
            foreach($browser in @('Chrome','Edge')) {
                $key=$base.OpenSubKey($registryRoot+'\'+$browser+'\NativeMessagingHosts\cn.classroom.qr_watch')
                Assert ($null -ne $key) 'Missing browser registration'
                try {Assert ($key.GetValue('') -eq $manifestPath) 'Wrong manifest path'} finally {$key.Dispose()}
            }
        } finally {$base.Dispose()}
    }
    # HKCU Software keys may be shared across 32/64-bit views: validate before mutation.
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
        try {
            $key=$base.OpenSubKey($registryRoot+'\Edge\NativeMessagingHosts\cn.classroom.qr_watch',$true)
            try {$key.SetValue('','C:\OtherPackage\host.json')} finally {$key.Dispose()}
        } finally {$base.Dispose()}
    }
    & (Join-Path $fixture 'uninstall.ps1')
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
        try {
            $key=$base.OpenSubKey($registryRoot+'\Chrome\NativeMessagingHosts\cn.classroom.qr_watch')
            if($key){$key.Dispose();throw 'Own registration was not removed'}
            $key=$base.OpenSubKey($registryRoot+'\Edge\NativeMessagingHosts\cn.classroom.qr_watch')
            Assert ($null -ne $key) 'Other package registration was removed'
            try {Assert ($key.GetValue('') -eq 'C:\OtherPackage\host.json') 'Other package was changed'} finally {$key.Dispose()}
        } finally {$base.Dispose()}
    }
} finally {
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
        try {$base.DeleteSubKeyTree($registryRoot,$false)} finally {$base.Dispose()}
    }
}
