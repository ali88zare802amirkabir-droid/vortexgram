const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-skins';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4810','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4810/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
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
  
  const isPrem = await send('Runtime.evaluate',{expression:"state.me ? state.me.isPremium : 'no-state'"});
  console.log('isPremium:', isPrem.result.result.value);
  
  // Go to settings
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='settings'); el&&el.click();})()"});
  await wait(800);
  
  // Click skins category
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.set-cat')).find(e=>e.dataset.cat==='skins'); if(el) el.click(); else console.log('skins cat not found');})()"});
  await wait(800);
  
  const hasGrid = await send('Runtime.evaluate',{expression:"!!document.querySelector('.skins-grid')"});
  console.log('Skins grid:', hasGrid.result.result.value);
  
  const cards = await send('Runtime.evaluate',{expression:"document.querySelectorAll('.skin-card').length"});
  console.log('Skin cards:', cards.result.result.value);
  
  const onlyPrem = await send('Runtime.evaluate',{expression:"!!document.querySelector('.settings-sub .placeholder')"});
  console.log('Only-premium placeholder:', onlyPrem.result.result.value);
  
  // Click first skin card apply button
  const beforeTheme = await send('Runtime.evaluate',{expression:"localStorage.getItem('vx_theme')"});
  console.log('Before theme:', beforeTheme.result.result.value);
  
  await send('Runtime.evaluate',{expression:"(function(){var btn=document.querySelector('.skin-act'); if(btn) btn.click();})()"});
  await wait(500);
  
  const afterTheme = await send('Runtime.evaluate',{expression:"localStorage.getItem('vx_theme')"});
  console.log('After theme:', afterTheme.result.result.value);
  
  const dataTheme = await send('Runtime.evaluate',{expression:"document.documentElement.getAttribute('data-theme')"});
  console.log('data-theme attr:', dataTheme.result.result.value);
  
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 60000);