import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['extension/live-policy.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {liveSeekTarget}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('live playback discards accumulated delay, and forces catchup on return or alert',()=>{
  assert.equal(liveSeekTarget(true,10,28,20),28);
  assert.equal(liveSeekTarget(true,27,28,3),undefined);
  assert.equal(liveSeekTarget(true,27,28,3,true),28);
  assert.equal(liveSeekTarget(true,28,28,2,true),undefined);
  assert.equal(liveSeekTarget(true,29,28,1,true),undefined);
});
test('VOD, absent and invalid live positions never seek',()=>{
  assert.equal(liveSeekTarget(false,0,28,30,true),undefined);
  assert.equal(liveSeekTarget(true,0,null,30,true),undefined);
  assert.equal(liveSeekTarget(true,0,NaN,30,true),undefined);
});
