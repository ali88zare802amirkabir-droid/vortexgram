const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-final2';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4899','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4899/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
  if(!list||!list.length){ console.log('NO PAGE TARGET'); dbg.kill(); process.exit(3); }
  const page = list.find(t=>t.type==='page')||list[0];
  const ws = new WS(page.webSocketDebuggerUrl);
  let nextId=1; const pending={};
  ws.on('error', e=>console.log('WS ERR', e.message));
  function send(method,params){ return new Promise((res)=>{ const id=nextId++; pending[id]=res; ws.send(JSON.stringify({id,method,params})); }); }
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.id&&pending[m.id]){ pending[m.id](m); delete pending[m.id]; } }catch(e){} });
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://localhost:'+PORT+'/'}); await wait(2000);
  await send('Runtime.evaluate',{expression:"localStorage.setItem('ft_token','"+TOKEN+"'); location.reload();"}); await wait(2500);
  
  // Go to settings
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='settings'); el&&el.click();})()"});
  await wait(800);
  
  // Check settings main
  const main = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-main')"});
  console.log('Settings main:', main.result.result.value);
  
  // Click appearance
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.set-cat')).find(e=>e.dataset.cat==='appearance'); el&&el.click();})()"});
  await wait(500);
  const appSub = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-sub')"});
  console.log('Appearance sub:', appSub.result.result.value);
  
  // Click back - use view-back button
  await send('Runtime.evaluate',{expression:"document.querySelector('.view-head #view-back')?.click()"});
  await wait(500);
  const backMain = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-main')"});
  console.log('Back to main:', backMain.result.result.value);
  
  // Click privacy
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.set-cat')).find(e=>e.dataset.cat==='privacy'); el&&el.click();})()"});
  await wait(500);
  const privSub = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-sub')"});
  console.log('Privacy sub:', privSub.result.result.value);
  const switches = await send('Runtime.evaluate',{expression:"document.querySelectorAll('.switch input[type=checkbox]').length"});
  console.log('Privacy switches:', switches.result.result.value);
  
  // Click back to main
  await send('Runtime.evaluate',{expression:"document.querySelector('.view-head #view-back')?.click()"});
  await wait(500);
  
  // Click skins
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.set-cat')).find(e=>e.dataset.cat==='skins'); el&&el.click();})()"});
  await wait(500);
  const skins = await send('Runtime.evaluate',{expression:"!!document.querySelector('.skins-grid')"});
  console.log('Skins grid:', skins.result.result.value);
  const skinCards = await send('Runtime.evaluate',{expression:"document.querySelectorAll('.skin-card').length"});
  console.log('Skin cards:', skinCards.result.result.value);
  
  // Go to users
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='users'); el&&el.click();})()"});
  await wait(1000);
  
  // Click profile on a NON-admin user (second row)
  await send('Runtime.evaluate',{expression:"(function(){var rows=document.querySelectorAll('.au-row'); if(rows.length>1){rows[1].querySelector('[data-act=profile]')?.click();}else{rows[0].querySelector('[data-act=profile]')?.click();}})()"});
  await wait(800);
  
  const profile = await send('Runtime.evaluate',{expression:"!!document.querySelector('.profile-view')"});
  console.log('Profile view:', profile.result.result.value);
  
  const impBtn = await send('Runtime.evaluate',{expression:"!!document.querySelector('[data-act=impersonate]')"});
  console.log('Impersonate button:', impBtn.result.result.value);
  
  const promoteBtn = await send('Runtime.evaluate',{expression:"!!document.querySelector('[data-act=promote]')"});
  console.log('Promote button:', promoteBtn.result.result.value);
  
  const filesSec = await send('Runtime.evaluate',{expression:"!!document.querySelector('.profile-files')"});
  console.log('Files section:', filesSec.result.result.value);
  
  // Check rec UI element
  const recUI = await send('Runtime.evaluate',{expression:"!!document.getElementById('rec-ui')"});
  console.log('Rec UI exists:', recUI.result.result.value);
  
  // Check emoji functions
  const emojiFn = await send('Runtime.evaluate',{expression:"typeof emojiOnly === 'function' && typeof emojiCount === 'function'"});
  console.log('Emoji functions:', emojiFn.result.result.value);
  
  console.log('ALL CHECKS DONE');
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 120000);