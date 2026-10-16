import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

const chrome=process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const edge=process.env.EDGE_BIN || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
for(const [name,browser] of [['Chrome',chrome],['Edge',edge]]) {
test(`${name} accepts the built MV3 package and rejects blob workers (regression)`,{skip:!browser||!existsSync(browser)},()=>{
  const root=resolve('../.qa/'+name.toLowerCase()+'-manifest-test-'+Date.now());mkdirSync(root,{recursive:true});
  const good=join(root,'good'),bad=join(root,'bad');
  cpSync(resolve('../extension'),good,{recursive:true});cpSync(good,bad,{recursive:true});
  const manifest=JSON.parse(readFileSync(join(bad,'manifest.json'),'utf8'));
  manifest.content_security_policy.extension_pages=manifest.content_security_policy.extension_pages.replace("worker-src 'self'", "worker-src 'self' blob:");
  writeFileSync(join(bad,'manifest.json'),JSON.stringify(manifest));
  function pack(dir){return execFileSync(browser,[`--pack-extension=${dir}`,`--user-data-dir=${dir}-profile`,'--no-message-box'],{windowsHide:true,encoding:'utf8',timeout:30000});}
  // Edge may hand off to its browser child and return zero even on rejection.
  try {pack(bad);} catch {}
  assert.equal(existsSync(bad+'.crx'),false);
  pack(good);
  const end=Date.now()+15000;
  while(!existsSync(good+'.crx')&&Date.now()<end)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
  assert.equal(existsSync(good+'.crx'),true);
});
}
