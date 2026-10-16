import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
test('installer registers both browsers, preserves IDs, and only removes its own registrations',()=>{
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','tests/installer.ps1',
    '-PackageRoot',resolve('..'),'-FixtureRoot',resolve('../.qa/installer-qa')],{encoding:'utf8',windowsHide:true,timeout:30000});
});
