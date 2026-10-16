import test from 'node:test';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{writeFileSync,mkdirSync}from'node:fs';import{resolve,dirname}from'node:path';import{build}from'esbuild';
const r=await build({entryPoints:['extension/qr-journal.ts'],bundle:true,write:false,format:'esm',platform:'node'});const {classify,defaultRules}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
test('native and UI agree: Chaoxing exact URL host/path, rotating params, spoofed hosts, block priority and unknown',()=>{
 const base='https://mobilelearn.chaoxing.com/widget/sign/e';const cases=[
 {text:base+'?id=123&enc=rotates'}, {text:base+'?id=456&enc=next'},
 {text:'https://mobilelearn.chaoxing.com/login?redirect='+base}, {text:'https://mobilelearn.chaoxing.com.evil.invalid/widget/sign/e'},
 {text:base+'/login'}, {text:'arbitrary desktop login token'},
 {text:base,qrRules:[]}, {text:base,qrRules:[...defaultRules,{id:'block',action:'block',kind:'exact',pattern:base}]},
 {text:base,qrRules:[{id:'contains',action:'allow',kind:'contains',pattern:'widget/sign'}]}
 ];
 const file=resolve('../.qa/qa/qr-classification.json');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(cases));
 const actual=JSON.parse(execFileSync(resolve('../native/ClassroomQr.Host.exe'),['--classify-qr',file],{encoding:'utf8',timeout:10000,windowsHide:true}));
 const expected=cases.map(c=>classify(c.text,c.qrRules||defaultRules));assert.deepEqual(actual,expected);assert.deepEqual(actual.map(x=>x.decision),['attendance','attendance','unknown','unknown','unknown','unknown','unknown','blocked','attendance']);
});
