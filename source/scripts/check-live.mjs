import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const url=process.argv[2];if(!url)throw Error('Usage: node scripts/check-live.mjs <HLS URL>');
const child=spawn(resolve('../native/ClassroomQr.Host.exe'),['chrome-extension://'+'a'.repeat(32)+'/'],{windowsHide:true});
let pending=Buffer.alloc(0),frames=0,done=false;const started=Date.now(),id=randomUUID();
const send=(command,extra={})=>{const b=Buffer.from(JSON.stringify({sessionId:id,command,...extra})),h=Buffer.alloc(4);h.writeUInt32LE(b.length);child.stdin.write(Buffer.concat([h,b]));};
const timer=setTimeout(()=>{console.error('Timed out before receiving three frames');process.exitCode=1;send('stop');child.stdin.end()},60000);
child.stderr.pipe(process.stderr);
child.stdout.on('data',b=>{
  pending=Buffer.concat([pending,b]);while(pending.length>=4){const n=pending.readUInt32LE();if(pending.length<n+4)break;const m=JSON.parse(pending.subarray(4,n+4));pending=pending.subarray(n+4);
    if(m.type==='alert')m.text='[redacted]';
    console.log(JSON.stringify({...m,elapsedMs:Date.now()-started}));
    if(m.type==='frame'&&++frames===3&&!done){done=true;clearTimeout(timer);send('stop');child.stdin.end()}
  }
});
child.on('exit',code=>{clearTimeout(timer);if(code!==0||frames<3)process.exitCode=1});
send('start',{url,windowToken:`[CQ-${randomUUID()}]`});
