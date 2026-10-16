import {writeFileSync, mkdirSync} from 'node:fs';
const rate=22050, seconds=1.2, count=Math.floor(rate*seconds);
const wav=Buffer.alloc(44+count*2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++){
  const t=i/rate, local=t%0.4, envelope=local<0.23?Math.min(1,local/0.015,(0.23-local)/0.025):0;
  const f=t<0.4?740: t<0.8?930:1100;
  wav.writeInt16LE(Math.round(Math.sin(t*2*Math.PI*f)*envelope*6500),44+i*2);
}
mkdirSync('../native',{recursive:true});writeFileSync('../native/alarm.wav',wav);
