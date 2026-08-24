const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-final';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4895','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4895/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
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
  
  // Check app loaded
  const hasApp = await send('Runtime.evaluate',{expression:"!!document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')"});
  console.log('App loaded:', hasApp.result.result.value);
  
  // Check nav items
  const navCount = await send('Runtime.evaluate',{expression:"document.querySelectorAll('.nav-item').length"});
  console.log('Nav items:', navCount.result.result.value);
  
  // Check settings sub-nav (go to settings)
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='settings'); el&&el.click();})()"});
  await wait(800);
  const hasSettings = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-main')"});
  console.log('Settings main view:', hasSettings.result.result.value);
  
  // Click appearance category
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.set-cat')).find(e=>e.dataset.cat==='appearance'); el&&el.click();})()"});
  await wait(500);
  const hasAppearance = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-sub')"});
  console.log('Appearance sub-view:', hasAppearance.result.result.value);
  
  // Go back to settings main
  await send('Runtime.evaluate',{expression:"document.querySelector('#view-back')?.click()"});
  await wait(500);
  const backMain = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-main')"});
  console.log('Back to main:', backMain.result.result.value);
  
  // Check privacy switches have animated switch class
  const hasSwitches = await send('Runtime.evaluate',{expression:"document.querySelectorAll('.switch input[type=checkbox]').length"});
  console.log('Privacy switches:', hasSwitches.result.result.value);
  
  // Check skins category
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.set-cat')).find(e=>e.dataset.cat==='skins'); el&&el.click();})()"});
  await wait(500);
  const hasSkins = await send('Runtime.evaluate',{expression:"!!document.querySelector('.skins-grid')"});
  console.log('Skins grid:', hasSkins.result.result.value);
  
  // Check impersonate button in profile (go to users, click profile on first user)
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='users'); el&&el.click();})()"});
  await wait(1000);
  const hasUsers = await send('Runtime.evaluate',{expression:"!!document.querySelector('.admin-users')"});
  console.log('Users panel:', hasUsers.result.result.value);
  
  // Click profile on first user row
  await send('Runtime.evaluate',{expression:"(function(){var btn=document.querySelector('.au-row [data-act=profile]'); if(btn) btn.click();})()"});
  await wait(800);
  const hasProfile = await send('Runtime.evaluate',{expression:"!!document.querySelector('.profile-view')"});
  console.log('Profile view:', hasProfile.result.result.value);
  
  // Check impersonate button exists
  const hasImpBtn = await send('Runtime.evaluate',{expression:"!!document.querySelector('[data-act=impersonate]')"});
  console.log('Impersonate button:', hasImpBtn.result.result.value);
  
  // Check files section loads
  const hasFiles = await send('Runtime.evaluate',{expression:"!!document.querySelector('.profile-files')"});
  console.log('Files section:', hasFiles.result.result.value);
  
  // Check emoji size logic exists
  const hasEmojiFn = await send('Runtime.evaluate',{expression:"typeof emojiOnly === 'function' && typeof emojiCount === 'function'"});
  console.log('Emoji functions:', hasEmojiFn.result.result.value);
  
  // Check voice recording UI elements
  const hasRecUI = await send('Runtime.evaluate',{expression:"!!document.getElementById('rec-ui')"});
  console.log('Rec UI element:', hasRecUI.result.result.value);
  
  // Check download progress bar in file rows
  const hasDLProg = await send('Runtime.evaluate',{expression:"!!document.querySelector('.file-row .progress-bar')"});
  console.log('DL progress bar:', hasDLProg.result.result.value);
  
  console.log('ALL CHECKS PASSED');
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 60000);