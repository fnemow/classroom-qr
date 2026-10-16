// The browser window owns the native port. Closing it closes the host and releases resources.
let opening = false;
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==chrome.runtime.id||message?.type!=='stall-warning')return;
  void chrome.notifications.create('classroom-stall',{type:'basic',iconUrl:'notification.png',title:'课堂直播卡顿提醒',message:String(message.message).slice(0,200),silent:true});
});
chrome.action.onClicked.addListener(async () => {
  if (opening) return;
  opening = true;
  try {
  const url = chrome.runtime.getURL('player.html');
  const saved = await chrome.storage.session.get('playerWindow');
  if (typeof saved.playerWindow === 'number') {
    try { await chrome.windows.update(saved.playerWindow, { focused: true }); return; } catch { /* closed */ }
  }
  const win = await chrome.windows.create({ url, type: 'popup', width: 1080, height: 840 });
  if (win?.id !== undefined) await chrome.storage.session.set({ playerWindow: win.id });
  } finally { opening = false; }
});
chrome.windows.onRemoved.addListener(async id => {
  const saved = await chrome.storage.session.get('playerWindow');
  if (saved.playerWindow === id) await chrome.storage.session.remove('playerWindow');
});
