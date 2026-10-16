import { qrJournal } from './qr-journal';
import Hls from 'hls.js';
import { liveSeekTarget } from './live-policy';
import { timetable } from './timetable';
import { type Lesson } from './catalog';
import { StallTracker } from './stall';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = el<HTMLInputElement>('url');
const video = el<HTMLVideoElement>('video');
const button = (id: string) => el<HTMLButtonElement>(id);
let port: chrome.runtime.Port | undefined;
let session = crypto.randomUUID();
let running = false;
let hls: Hls | undefined;
let playbackTimer: number | undefined;
let playbackDelay = 0;
let source = '';
let playbackSource = '';
let bufferPause = false;
let resumePending = false;
let live = false;
let hiddenAt = 0;
let lastRefresh = 0;
let ready = false;
let sound = false;
let pinned = false;
let busy = false;
let requestSerial=0,alerted=false;
type Target={url:string;lesson?:Lesson;offset:number};
let currentTarget:Target|undefined,previousTarget:Target|undefined;
const stall=new StallTracker();let waiting=false,manualPause=false,internalPause=false;
const catalog=timetable((url,lesson,offset)=>{void launch({url,lesson,offset});},showCatalogError);
function showCatalogError(s:string){showError(s);}
const tools=document.createElement('section');tools.innerHTML='<p id="current-course">手动直播</p><div class="toolbar"><button type="button" id="view-minus" class="secondary">编号 −1</button><button type="button" id="view-base" class="secondary">默认编号</button><button type="button" id="view-plus" class="secondary">编号 +1</button><button type="button" id="retry-stream" class="secondary">重试当前直播</button><button type="button" id="return-stream" class="secondary">返回上一直播</button></div><div id="stall-warning" class="error" hidden>直播严重卡顿，建议切换视角。请使用上方视角按钮；网络或平台拥塞时切视角也可能无效。<button type="button" id="dismiss-stall" class="secondary">暂不切换</button></div>';
document.querySelector('#form')!.after(tools);
const journal=qrJournal(rules=>{if(port && running)send('setQrRules',{qrRules:rules});},showCatalogError);
const token = `[CQ-${crypto.randomUUID()}]`;
document.title = `${token} 课堂二维码提醒`;
const showError = (message: string) => { el('error').textContent = message; el('error').hidden = false; };
function controls() {
  button('start').disabled = busy || running;
  button('stop').disabled = !running && !sound && !pinned;
  button('rearm').disabled = !running;
  button('mute').disabled = !sound;
  button('unpin').disabled = !pinned;
  button('test').disabled = sound;
  input.disabled = running || busy;
}
function send(command: string, extra: Record<string, unknown> = {}) {
  if (!port) throw new Error('本地辅助程序未连接，请先安装后重试。');
  port.postMessage({ command, sessionId: session, ...extra });
}
function disconnect() {
  ready = false; port = undefined; running = false; sound = false; pinned = false;
  stopPlayer();
  el('status').textContent = '辅助程序已断开，检测已停止'; el('badge').textContent = '已断开';
  controls();
}
let connectPromise: Promise<void> | undefined;
function connect(): Promise<void> {
  if (port && ready) return Promise.resolve();
  if (connectPromise) return connectPromise;
  connectPromise = new Promise<void>((resolve, reject) => {
    const p = chrome.runtime.connectNative('cn.classroom.qr_watch');
    port = p;
    const timeout = window.setTimeout(() => { p.disconnect(); disconnect(); reject(new Error('辅助程序连接超时，请检查安装。')); }, 8000);
    p.onMessage.addListener(m => {
      if (m.sessionId !== session) return;
      if (m.type === 'ready') {
        if(m.qrFiltering!==true||m.qrLogging!==true){clearTimeout(timeout);reject(new Error('辅助程序版本过旧：请同时更新 native 并关闭旧直播窗口后重开，避免登录码误报警。'));p.disconnect();return;}
        clearTimeout(timeout); ready = true;
        el('host-info').textContent = 'Windows 辅助程序已连接 · 检测在后台继续运行'; resolve(); return;
      }
      if (m.type === 'status') {
        el('status').textContent = m.message;
        el('badge').textContent = m.state === 'monitoring' ? '监控中' : m.state === 'reconnecting' ? '重连中' : m.state === 'alerted' ? '已发现' : m.state === 'stopped' ? '已停止' : '连接中';
        if (m.state === 'error' || m.state === 'stopped') running = false;
      }
      if (m.type === 'frame') el('last-frame').textContent = new Date(m.at).toLocaleTimeString();
      if (m.type === 'tick' || m.type === 'frame') { syncLive(); resumeBuffered(); checkStall(); }
      if (m.type === 'playback' && running && typeof m.url === 'string') {
        const local = new URL(m.url);
        if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1') return;
        playbackSource = m.url; playbackDelay = 0; play();
      }
      if(m.type==='qr')journal.record(m,{course:currentTarget?.lesson?.name||'',room:currentTarget?.lesson?.room||'',view:currentTarget?.offset||0,source});
      if (m.type === 'alert') {
        alerted=true;
        syncLive(true);
        el('alert').hidden = false;
        el('detected-at').textContent = `发现时间：${new Date(m.at).toLocaleString()}`;
        el('qr').textContent = m.text;
      }
      if (m.type === 'effects') {
        sound = m.sound; pinned = m.pinned;
        el('effects').textContent = `声音：${sound ? '提醒中' : '已停止'} · 窗口：${pinned ? '已置顶' : '未置顶'}`;
      }
      if (m.type === 'error') showError(m.message);
      controls();
    });
    p.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      const reason = chrome.runtime.lastError?.message;
      if (port === p) disconnect();
      reject(new Error(reason || '辅助程序已退出'));
      showError(`本地辅助程序连接失败：${reason || '连接已断开'}\n请按安装说明注册扩展 ID，然后重新开始。`);
    });
    p.postMessage({command:'hello', sessionId:session});
  }).finally(() => { connectPromise = undefined; });
  return connectPromise;
}
function stopPlayer() {
  live = false;
  bufferPause = false; resumePending = false;
  clearTimeout(playbackTimer); playbackTimer = undefined;
  hls?.destroy(); hls = undefined;
  video.pause(); video.removeAttribute('src'); video.load();
  el('playback').textContent = '未播放'; el('placeholder').hidden = false;
}
function retryPlayback() {
  waiting=true;
  if (!running || playbackTimer !== undefined) return;
  const delay = [2000,5000,10000,30000][Math.min(playbackDelay++,3)];
  el('playback').textContent = `播放重连中（${delay/1000} 秒）`;
  playbackTimer = window.setTimeout(() => { playbackTimer = undefined; if (running) play(); }, delay);
}
function play() {
  live = false;
  hls?.destroy(); hls = undefined;
  el('placeholder').hidden = true; el('playback').textContent = '正在加载';
  if (Hls.isSupported()) {
    // A packaged worker stays within MV3's worker-src 'self', without a blob worker.
    hls = new Hls({ enableWorker: true, workerPath: chrome.runtime.getURL('hls.worker.js'),
      lowLatencyMode: false, liveSyncDuration: 2, liveMaxLatencyDuration: 4,
      liveSyncOnStallIncrease: 0, maxLiveSyncPlaybackRate: 1.1,
      maxBufferLength: 6, maxMaxBufferLength: 10, backBufferLength: 2, startFragPrefetch: true });
    bufferPause = true;
    hls.attachMedia(video); hls.loadSource(playbackSource);
    hls.on(Hls.Events.FRAG_BUFFERED, resumeBuffered);
    hls.on(Hls.Events.LEVEL_UPDATED, (_event, data) => { live = data.details.live; syncLive(); });
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) retryPlayback(); });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = playbackSource; void video.play().catch(() => { el('playback').textContent = '请点击播放'; });
  } else { el('playback').textContent = '浏览器不支持此直播格式'; }
}
function syncLive(force = false) {
  if (!running || !hls || !live) return;
  const target = liveSeekTarget(live, video.currentTime, hls.liveSyncPosition, hls.latency, force);
  if (target !== undefined) {
    video.currentTime = target;
    if (bufferPause) resumeBuffered();
  }
  if (!bufferPause && !video.paused) el('playback').textContent = `播放中 · 距流末端约 ${hls.latency.toFixed(1)} 秒`;
}
function refreshLive() {
  if (!running || !playbackSource || !live || Date.now()-lastRefresh < 3000) return;
  lastRefresh = Date.now();
  // Recreate the loader after a long background suspension to fetch a fresh playlist.
  clearTimeout(playbackTimer); playbackTimer = undefined; play();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else { if(hiddenAt && Date.now()-hiddenAt>4000) refreshLive(); else syncLive(true); hiddenAt=0; }
});
window.addEventListener('focus', () => syncLive(true));
function bufferedAhead() {
  for (let i=0;i<video.buffered.length;i++) if(video.currentTime>=video.buffered.start(i)-0.1&&video.currentTime<video.buffered.end(i)) return video.buffered.end(i)-video.currentTime;
  return 0;
}
function resumeBuffered() {
  if(!running || !bufferPause || resumePending) return;
  // Transport-stream timestamps may begin after zero, including on first load.
  if(video.buffered.length && video.currentTime < video.buffered.start(0)) {
    video.currentTime = video.buffered.start(0);
  }
  const ahead=bufferedAhead();
  el('playback').textContent = `缓冲中 · ${ahead.toFixed(1)} 秒`;
  const needed=live?0.5:Number.isFinite(video.duration)?Math.min(2,Math.max(0.1,video.duration-video.currentTime-0.1)):2;
  if(ahead<needed) return;
  resumePending=true;
  void video.play().catch(()=>{el('playback').textContent='请点击播放';}).finally(()=>{resumePending=false;});
}
video.addEventListener('playing', () => { if(video.paused) return; waiting=false; manualPause=false; bufferPause=false; playbackDelay = 0; el('playback').textContent = '播放中'; });
video.addEventListener('pause',()=>{if(!internalPause&&!bufferPause&&running&&!video.ended)manualPause=true;});
video.addEventListener('play',()=>{manualPause=false;});
video.addEventListener('canplay', resumeBuffered);
video.addEventListener('progress', resumeBuffered);
video.addEventListener('error', retryPlayback);
video.addEventListener('waiting', () => {
  if (!running) return;
  el('playback').textContent = '缓冲中';
  waiting=true;
  if(!video.paused) { bufferPause=true; video.pause(); }
  resumeBuffered();
});
// A play/waiting event race can leave no new progress event to resume from.
window.setInterval(() => { syncLive(); resumeBuffered(); checkStall(); }, 500);

function checkStall(){if(!running)return;const warn=stall.tick(Date.now(),video.currentTime,!manualPause&&!video.ended,waiting||bufferPause);if(warn){el('stall-warning').hidden=false;void chrome.runtime.sendMessage({type:'stall-warning',message:`${currentTarget?.lesson?.name||'直播'}：直播严重卡顿，建议切换视角`}).catch(()=>{});}if(!stall.warning)el('stall-warning').hidden=true;}
button('dismiss-stall').onclick=()=>{el('stall-warning').hidden=true;};
async function launch(target:Target,force=false,keepAlert=false){
 if(!force&&!busy&&running&&target.lesson?.id&&target.lesson.id===currentTarget?.lesson?.id&&target.offset===currentTarget.offset)return;
 const serial=++requestSerial;busy=true;controls();el('error').hidden=true;
 try{
 const url=new URL(target.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('请输入无账号密码的 HTTP/HTTPS 地址');
 const granted=await chrome.permissions.request({origins:[...new Set([`${url.protocol}//${url.hostname}/*`,'http://127.0.0.1/*'])]});if(serial!==requestSerial)return;if(!granted)throw Error('需要允许读取直播站点，当前直播已保留');
 await journal.ready;await connect();if(serial!==requestSerial)return;
 const preserve=keepAlert&&currentTarget?.lesson?.id===target.lesson?.id&&alerted;
 previousTarget=currentTarget;currentTarget=target;
 internalPause=true;stopPlayer();internalPause=false;session=crypto.randomUUID();source=url.href;input.value=source;running=true;alerted=!!preserve;manualPause=false;waiting=true;stall.reset(Date.now(),keepAlert);el('stall-warning').hidden=true;
 if(!preserve)el('alert').hidden=true;el('last-frame').textContent='—';
 el('current-course').textContent=target.lesson?`${target.lesson.name} · ${target.lesson.room} · 视角 ${target.offset>0?'+':''}${target.offset}`:'手动直播';catalog.setActive(target.lesson?.id||'');
 for(const [id,offset]of [['view-minus',-1],['view-base',0],['view-plus',1]] as const){let valid=!!target.lesson;try{if(target.lesson)catalog.url(target.lesson.room,offset);}catch{valid=false;}button(id).disabled=!valid;}
 send('start',{url:source,windowToken:token,detectEnabled:true,suppressAlert:!!preserve,qrRules:journal.rules});if(target.lesson)catalog.remember(target.lesson.room,target.offset);
 await chrome.storage.local.set({lastUrl:source});
 }catch(e){if(serial===requestSerial)showError((target.lesson?target.lesson.name+' · '+target.lesson.room+'：':'')+String(e instanceof Error?e.message:e));}finally{if(serial===requestSerial){busy=false;controls();}}
}
for(const [id,offset]of [['view-minus',-1],['view-base',0],['view-plus',1]] as const){button(id).disabled=true;button(id).onclick=()=>{try{if(currentTarget?.lesson)void launch({url:catalog.url(currentTarget.lesson.room,offset),lesson:currentTarget.lesson,offset},false,true);}catch(e){showError(String(e));}};}
button('retry-stream').onclick=()=>{if(currentTarget)void launch(currentTarget,true,true);};button('return-stream').onclick=()=>{if(previousTarget)void launch(previousTarget,true,currentTarget?.lesson?.id===previousTarget.lesson?.id);};

el<HTMLFormElement>('form').addEventListener('submit', async event => {
  event.preventDefault(); void launch({url:input.value.trim(),offset:0}); return;
});
button('stop').addEventListener('click', () => {
  requestSerial++;busy=false;
  try { send('stop'); } catch(e) { showError(String(e)); }
  running = false; stopPlayer(); controls();
});
button('mute').addEventListener('click', () => { try { send('silence'); } catch(e) { showError(String(e)); } });
button('unpin').addEventListener('click', () => { try { send('unpin'); } catch(e) { showError(String(e)); } });
button('rearm').addEventListener('click', () => {
  if(currentTarget){void launch(currentTarget,true);return;}
  stopPlayer();
  el('error').hidden = true; el('alert').hidden = true; session = crypto.randomUUID();
  try { send('start', {url:source, windowToken:token}); running = true; controls(); } catch(e) { showError(String(e)); }
});
button('test').addEventListener('click', async () => {
  try { await connect(); send('testSound'); } catch(e) { showError(String(e instanceof Error ? e.message : e)); }
});
void chrome.storage.local.get('lastUrl').then(data => { if (typeof data.lastUrl === 'string') input.value = data.lastUrl; });
el('host-info').textContent = `扩展 ID：${chrome.runtime.id} · 首次使用请运行 install.ps1 注册此 ID。`;
window.addEventListener('pagehide', () => { void journal.flush(); try { send('stop'); } catch { /* native EOF also cleans up */ } port?.disconnect(); });
controls();
