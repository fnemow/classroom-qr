import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import QRCode from 'qrcode';

const pkg=resolve('..'), qa=resolve('../.qa/qa'); mkdirSync(qa,{recursive:true});
const host=join(pkg,'native/ClassroomQr.Host.exe'), ffmpeg=join(pkg,'native/ffmpeg.exe');
function ppm(payload,{blur=false,multiple=false}={}) {
  const w=960,h=540, pixels=Buffer.alloc(w*h*3,240);
  function draw(text,left,top,scale) {
    const qr=QRCode.create(text,{errorCorrectionLevel:'M'}).modules;
    for(let y=-4;y<qr.size+4;y++)for(let x=-4;x<qr.size+4;x++){
      const v=x>=0&&y>=0&&x<qr.size&&y<qr.size&&qr.get(y,x)?(blur?70:0):(blur?185:255);
      for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
        const offset=((top+(y+4)*scale+dy)*w+left+(x+4)*scale+dx)*3;
        pixels.fill(v,offset,offset+3);
      }
    }
  }
  if(payload)draw(payload,100,80,7);
  if(multiple)draw('classroom-second',550,80,7);
  return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),pixels]);
}
class Client {
  messages=[]; pending=Buffer.alloc(0); stderr='';
  constructor(){
    this.child=spawn(host,['chrome-extension://'+'a'.repeat(32)+'/'],{windowsHide:true});
    this.child.stderr.on('data',b=>this.stderr+=b);
    this.child.stdout.on('data',b=>{
      this.pending=Buffer.concat([this.pending,b]);
      while(this.pending.length>=4){const n=this.pending.readUInt32LE();if(this.pending.length<n+4)break;this.messages.push(JSON.parse(this.pending.subarray(4,n+4)));this.pending=this.pending.subarray(n+4);}
    });
  }
  send(command,sessionId,extra={}){const b=Buffer.from(JSON.stringify({command,sessionId,...(command==='start'?{qrRules:[{id:'test-sign',action:'allow',kind:'urlPath',pattern:'https://example.invalid/classroom-test'}]}:{}),...extra}));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);this.child.stdin.write(Buffer.concat([h,b]));}
  async wait(predicate,timeout=20000,after=0){const end=Date.now()+timeout;while(Date.now()<end){const m=this.messages.slice(after).find(predicate);if(m)return m;if(this.child.exitCode!==null)throw Error('Host exited: '+this.stderr);await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+JSON.stringify(this.messages.slice(-10))+' '+this.stderr);}
  async close(){this.child.stdin.end();await Promise.race([new Promise(r=>this.child.once('exit',r)),new Promise((_,j)=>setTimeout(()=>j(Error('Host EOF cleanup timeout')),5000))]);assert.equal(this.child.exitCode,0,this.stderr);}
}
let serve=true;
const upstreamCounts=new Map();
const server=createServer((req,res)=>{
  upstreamCounts.set(req.url,(upstreamCounts.get(req.url)||0)+1);
  const file=join(qa,(req.url||'/').split('?')[0]);
  if(!serve || !file.startsWith(qa) || !existsSync(file)){res.writeHead(503);res.end();return;}
  res.setHeader('Content-Type',extname(file)==='.m3u8'?'application/vnd.apple.mpegurl':'video/mp2t');res.setHeader('Access-Control-Allow-Origin','*');res.end(readFileSync(file));
});
test('QR decoding through production PPM reader: blank, brief, persistent, changed, multiple, reduced contrast',async()=>{
  const input=join(qa,'cases.ppm');
  writeFileSync(input,Buffer.concat([ppm(null),ppm('brief'),ppm(null),ppm('persistent'),ppm('persistent'),ppm('changed'),ppm('first',{multiple:true}),ppm('low-contrast',{blur:true})]));
  const output=execFileSync(host,['--decode-ppm',input],{encoding:'utf8',timeout:20000,windowsHide:true}).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(output.at(-1),{frames:8,hits:6});
  assert.deepEqual(output.slice(0,4).map(x=>x.text),['brief','persistent','persistent','changed']);
  assert.ok(['first','classroom-second'].includes(output[4].text));assert.equal(output[5].text,'low-contrast');
  const latest=JSON.parse(execFileSync(host,['--decode-latest-ppm',input],{encoding:'utf8',timeout:20000,windowsHide:true}));
  assert.deepEqual(latest,{text:'low-contrast',remaining:false},'stalled consumer must see only the newest frame');
  const all=execFileSync(host,['--decode-all-ppm',input],{encoding:'utf8',timeout:20000,windowsHide:true}).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(all.some(x=>x.text==='classroom-second'),'every QR in a multi-code frame must be collected');
});
test('real HLS video, native framing, single alert, rearm, independent controls, stale session, stop and EOF',async()=>{
  const frames=join(qa,'video.ppm');writeFileSync(frames,Buffer.concat([ppm(null),ppm(null),...Array.from({length:10},()=>ppm('https://example.invalid/classroom-test'))]));
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','2','-i',frames,'-c:v','libx264','-pix_fmt','yuv420p','-g','2','-hls_time','1','-hls_list_size','0','-hls_playlist_type','vod',join(qa,'stream.m3u8')],{timeout:30000,windowsHide:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/stream.m3u8`;
  const c=new Client(),id=randomUUID(),windowToken=`[CQ-${randomUUID()}]`;
  try{
    c.send('hello',id);await c.wait(m=>m.type==='ready');
    c.send('start',id,{url,windowToken});
    const alert=await c.wait(m=>m.type==='alert');assert.equal(alert.text,'https://example.invalid/classroom-test');
    await c.wait(m=>m.type==='tick',5000);
    assert.ok(Date.now()-Date.parse(alert.at)<2000,'clear QR must alert within two seconds of receiving its frame');
    assert.ok(c.messages.some(m=>m.type==='frame'));
    await c.wait(m=>m.type==='effects'&&m.sound===true);
    c.send('unpin',id);await c.wait(m=>m.type==='effects'&&!m.pinned&&m.sound);
    let from=c.messages.length;c.send('silence',id);await c.wait(m=>m.type==='effects'&&!m.sound,5000,from);
    await new Promise(r=>setTimeout(r,1200));assert.equal(c.messages.filter(m=>m.type==='alert').length,1);
    const next=randomUUID();from=c.messages.length;c.send('start',next,{url,windowToken});await c.wait(m=>m.type==='alert'&&m.sessionId===next,20000,from);
    await c.wait(m=>m.type==='effects'&&m.sessionId===next&&m.sound,5000,from);
    from=c.messages.length;c.send('silence',id);await new Promise(r=>setTimeout(r,200));assert.equal(c.messages.slice(from).filter(m=>m.type==='effects').length,0);
    c.send('stop',next);await c.wait(m=>m.type==='effects'&&!m.sound&&!m.pinned,5000,from);
    await c.close();
  }finally{if(c.child.exitCode===null)c.child.kill();await new Promise(r=>server.close(r));}
});
test('unavailable stream reconnects, recovers, and can stop while waiting for a frame',async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  serve=false; const c=new Client(),id=randomUUID(),url=`http://127.0.0.1:${server.address().port}/stream.m3u8`,windowToken=`[CQ-${randomUUID()}]`;
  try{
    c.send('start',id,{url,windowToken});await c.wait(m=>m.state==='reconnecting');
    assert.equal(c.messages.filter(m=>m.state==='monitoring').length,0);
    serve=true;await c.wait(m=>m.type==='alert',20000);
    c.send('stop',id);await c.wait(m=>m.state==='stopped');
    const next=randomUUID();serve=false;c.send('start',next,{url,windowToken});await c.wait(m=>m.state==='reconnecting'&&m.sessionId===next);
    await c.close();
  }finally{serve=true;if(c.child.exitCode===null)c.child.kill();await new Promise(r=>server.close(r));}
});
test('playback and detection share upstream segments, byte ranges, capability check, and relay cleanup',async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));upstreamCounts.clear();
  const c=new Client(),id=randomUUID(),url=`http://127.0.0.1:${server.address().port}/stream.m3u8`,windowToken=`[CQ-${randomUUID()}]`;
  try{
    c.send('start',id,{url,windowToken});
    const playback=await c.wait(m=>m.type==='playback');
    assert.equal(new URL(playback.url).hostname,'127.0.0.1');
    const denied=await fetch(new URL('/wrong-session/media.m3u8',playback.url));assert.equal(denied.status,403);
    const manifest=await(await fetch(playback.url)).text();
    const segments=manifest.split(/\r?\n/).filter(x=>x&&!x.startsWith('#'));
    assert.ok(segments.length>0);assert.ok(segments.every(x=>x.startsWith(new URL(playback.url).origin)));
    const [a,b]=await Promise.all([fetch(segments[1]).then(r=>r.arrayBuffer()),fetch(segments[1]).then(r=>r.arrayBuffer())]);
    assert.deepEqual(Buffer.from(a),Buffer.from(b));
    const range=await fetch(segments[1],{headers:{Range:'bytes=0-31'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),Buffer.from(a).subarray(0,32));
    await c.wait(m=>m.type==='alert');
    for(const [path,count]of upstreamCounts)if(path.endsWith('.ts'))assert.equal(count,1,'duplicate upstream download: '+path);
    // Detection pauses at first QR while playback must keep working from the relay.
    assert.equal((await fetch(playback.url)).status,200);
    c.send('stop',id);await c.wait(m=>m.state==='stopped');
    await assert.rejects(()=>fetch(playback.url));await c.close();
  }finally{if(c.child.exitCode===null)c.child.kill();await new Promise(r=>server.close(r));}
});
test('rejects non-network URLs and an invalid window marker without starting monitoring',async()=>{
  const c=new Client(),id=randomUUID();try{
    c.send('start',id,{url:'file:///C:/Windows/win.ini',windowToken:`[CQ-${randomUUID()}]`});await c.wait(m=>m.type==='error');
    assert.equal(c.messages.filter(m=>m.state==='monitoring').length,0);
    const from=c.messages.length;c.send('start',id,{url:'http://127.0.0.1/stream.m3u8',windowToken:'not-a-session-marker'});await c.wait(m=>m.type==='error',5000,from);
    assert.equal(c.messages.filter(m=>m.state==='monitoring').length,0);await c.close();
  }finally{if(c.child.exitCode===null)c.child.kill();}
});
test('playback-only view switch never re-arms QR detection',async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const c=new Client(),id=randomUUID();
 try{c.send('start',id,{url:`http://127.0.0.1:${server.address().port}/stream.m3u8`,windowToken:`[CQ-${randomUUID()}]`,detectEnabled:false});
 const p=await c.wait(m=>m.type==='playback');assert.equal((await fetch(p.url)).status,200);await c.wait(m=>m.type==='tick');assert.equal(c.messages.some(m=>m.type==='frame'||m.type==='alert'),false);c.send('stop',id);await c.wait(m=>m.state==='stopped');await c.close();
 }finally{if(c.child.exitCode===null)c.child.kill();await new Promise(r=>server.close(r));}
});
test('unknown/blocked QR is logged silently; live rule update permits attendance; logging continues after alert',async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const c=new Client(),id=randomUUID();
 try{
 c.send('start',id,{url:`http://127.0.0.1:${server.address().port}/stream.m3u8`,windowToken:`[CQ-${randomUUID()}]`,qrRules:[]});
 await c.wait(m=>m.type==='qr'&&m.decision==='unknown');assert.equal(c.messages.some(m=>m.type==='alert'||m.sound===true),false);
 const allow={id:'sign',action:'allow',kind:'urlPath',pattern:'https://example.invalid/classroom-test'};
 c.send('setQrRules',id,{qrRules:[allow,{...allow,id:'login-block',action:'block'}]});await c.wait(m=>m.type==='qr'&&m.decision==='blocked');assert.equal(c.messages.some(m=>m.type==='alert'),false);
 c.send('setQrRules',id,{qrRules:[allow]});await c.wait(m=>m.type==='alert',25000);const from=c.messages.length;await c.wait(m=>m.type==='qr',15000,from);assert.equal(c.messages.filter(m=>m.type==='alert').length,1);
 c.send('stop',id);await c.wait(m=>m.state==='stopped');await c.close();
 }finally{if(c.child.exitCode===null)c.child.kill();await new Promise(r=>server.close(r));}
});
