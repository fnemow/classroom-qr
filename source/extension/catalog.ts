import ICAL from 'ical.js';
import { unzipSync, strFromU8 } from 'fflate';
export type Lesson={id:string;name:string;room:string;start:number;end:number};
export type Rooms=Record<string,string[]>;
export const templateDefault='http://202.117.115.99:8092/pag/202.117.115.50/7302/00XXXX/0/MAIN/TCP/live.m3u8';
export const roomKey=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s\-—_]/g,'');
export function roomMap(pairs:string[][]):Rooms {const result:Rooms={};for(const [room,code] of pairs){if(!/^\d{4}$/.test(code)||!room.trim())continue;const key=roomKey(room);result[key]=[...new Set([...(result[key]||[]),code])];}return result;}
export function streamUrl(template:string,code:string,offset=0){if(!/^\d{4}$/.test(code)||![-1,0,1].includes(offset))throw Error('教室编号或视角无效');const n=Number(code)+offset;if(n<0||n>9999)throw Error('视角编号越界');if(!template.includes('/7302/00XXXX/'))throw Error('模板必须包含 /7302/00XXXX/');const url=new URL(template.replace('XXXX',String(n).padStart(4,'0')));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('直播地址必须为无账号密码的 HTTP/HTTPS 地址');return url.href;}
const shanghai=new ICAL.Timezone({tzid:'Asia/Shanghai',component:new ICAL.Component(ICAL.parse('BEGIN:VTIMEZONE\r\nTZID:Asia/Shanghai\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0800\r\nTZOFFSETTO:+0800\r\nEND:STANDARD\r\nEND:VTIMEZONE'))});
export function calendar(text:string,from:number,to:number){
 if(text.length>5_000_000)throw Error('课表超过 5MB');
 ICAL.TimezoneService.reset();ICAL.TimezoneService.register(shanghai,'Asia/Shanghai');
 const root=new ICAL.Component(ICAL.parse(text.replace(/UNTIL=(\d{8})(?=[;\r\n]|$)/g,'UNTIL=$1T235959')));
 if(root.name!=='vcalendar')throw Error('不是有效 ICS 课表');
 for(const zone of root.getAllSubcomponents('vtimezone')){const id=zone.getFirstPropertyValue('tzid');if(typeof id==='string')ICAL.TimezoneService.register(new ICAL.Timezone({tzid:id,component:zone}),id);}
 const lessons:Lesson[]=[],issues:string[]=[],names=new Set<string>();const components=root.getAllSubcomponents('vevent');
 const epoch=(t:ICAL.Time)=>{const c=t.clone();if(c.zone.tzid==='floating')c.zone=shanghai;return c.toUnixTime()*1000;};
 for(const [index,c] of components.entries()){
  if(c.hasProperty('recurrence-id'))continue;
  try{
   const name=String(c.getFirstPropertyValue('summary')||'未命名课程').split('@')[0]; names.add(name);
   for(const p of c.getAllProperties()){const tz=p.getParameter('tzid');if(typeof tz==='string'&&!ICAL.TimezoneService.has(tz))throw Error('不支持的时区 '+tz);}
   const event=new ICAL.Event(c);if(!c.hasProperty('dtstart')||(!c.hasProperty('dtend')&&!c.hasProperty('duration')))throw Error('缺少开始/结束时间');
   if(epoch(event.endDate)<=epoch(event.startDate))throw Error('结束时间必须晚于开始时间');
   if(c.getFirstPropertyValue('status')==='CANCELLED')continue;
   if(event.uid)for(const ex of components.filter(x=>x.hasProperty('recurrence-id')&&x.getFirstPropertyValue('uid')===event.uid))event.relateException(ex);
   const iterator=event.iterator();let count=0;let next;
   while((next=iterator.next())){if(++count>20000)throw Error('重复展开超过安全上限');if(epoch(next)>=to)break;const occurrence=event.getOccurrenceDetails(next);if(occurrence.item.component.getFirstPropertyValue('status')==='CANCELLED')continue;
    const start=epoch(occurrence.startDate),end=epoch(occurrence.endDate);if(end>from&&start<to)lessons.push({id:(event.uid||String(index))+':'+next.toString(),name:occurrence.item.summary.split('@')[0]||name,room:occurrence.item.location||'待定',start,end});
    if(!event.isRecurring())break;
   }
  }catch(e){issues.push(`第 ${index+1} 个课程：${e instanceof Error?e.message:e}`);}
 }
 if(!components.length)throw Error('课表没有课程');
 return {lessons:lessons.sort((a,b)=>a.start-b.start||a.name.localeCompare(b.name)),issues,names:[...names].sort(),events:components.length};
}
export function excelRooms(bytes:Uint8Array):Rooms {
 if(bytes.length>10_000_000)throw Error('Excel 超过 10MB');
 const zip=unzipSync(bytes,{filter:e=>e.originalSize<10_000_000&&/^xl\/(sharedStrings.xml|worksheets\/sheet\d+.xml)$/.test(e.name)});
 const xml=(name:string)=>new DOMParser().parseFromString(strFromU8(zip[name]),'application/xml');
 const strings=zip['xl/sharedStrings.xml']?[...xml('xl/sharedStrings.xml').getElementsByTagName('si')].map(x=>x.textContent||''):[];
 const pairs:string[][]=[];
 for(const name of Object.keys(zip).filter(x=>x.includes('/worksheets/'))){for(const row of xml(name).getElementsByTagName('row')){const cells=new Map<string,string>();for(const cell of row.getElementsByTagName('c')){const ref=(cell.getAttribute('r')||'').replace(/\d/g,'');const value=cell.getElementsByTagName('v')[0]?.textContent||'';cells.set(ref,cell.getAttribute('t')==='s'?strings[Number(value)]||'':cell.getAttribute('t')==='inlineStr'?cell.textContent||'':value);}for(const [a,b]of [['A','B'],['C','D'],['E','F'],['G','H']]){const room=cells.get(a)||'',code=cells.get(b)||'';if(/^(?:[abc]\d+|信远i\d+)$/i.test(roomKey(room)))pairs.push([room,code]);}}}
 const result=roomMap(pairs);if(!Object.keys(result).length)throw Error('未找到教室—四位编号数据');return result;
}
