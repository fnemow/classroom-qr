export class StallTracker {
 started=0;last=0;lastTime=0;continuous=0;stable=0;lastWarning=-Infinity;warning=false; samples:{at:number;ms:number}[]=[];
 reset(now:number,keepCooldown=false){this.started=now;this.last=now;this.lastTime=0;this.continuous=0;this.stable=0;this.samples=[];this.warning=false;if(!keepCooldown)this.lastWarning=-Infinity;}
 tick(now:number,time:number,active:boolean,waiting:boolean){const dt=Math.min(2000,Math.max(0,now-this.last));const moved=time>this.lastTime+0.01;this.last=now;this.lastTime=time;
 if(!active||now-this.started<15000){this.continuous=0;this.stable=0;return false;}
 const stalled=waiting&&!moved;if(stalled){this.continuous+=dt;this.stable=0;this.samples.push({at:now,ms:dt});}else{this.continuous=0;if(moved)this.stable+=dt;}
 this.samples=this.samples.filter(s=>s.at>now-60000);if(this.stable>=30000){this.warning=false;this.samples=[];}
 if((this.continuous>=10000||this.samples.reduce((sum,s)=>sum+s.ms,0)>=20000)&&now-this.lastWarning>=180000){this.lastWarning=now;this.warning=true;return true;}return false;}
}
