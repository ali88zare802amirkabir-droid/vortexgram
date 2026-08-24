const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-skins2';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4811','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4811/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
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
  
  // Go to settings -> skins
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='settings'); el&&el.click();})()"});
  await wait(800);
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.set-cat')).find(e=>e.dataset.cat==='skins'); if(el) el.click();})()"});
  await wait(800);
  
  // Click the LAST skin card (premium-black, theme: midnight, accent: cyan)
  const beforeDataTheme = await send('Runtime.evaluate',{expression:"document.documentElement.getAttribute('data-theme')"});
  console.log('Before data-theme:', beforeDataTheme.result.result.value);
  
  await send('Runtime.evaluate',{expression:"(function(){var cards=document.querySelectorAll('.skin-card'); var last=cards[cards.length-1]; var btn=last.querySelector('.skin-act'); if(btn) btn.click();})()"});
  await wait(500);
  
  const afterDataTheme = await send('Runtime.evaluate',{expression:"document.documentElement.getAttribute('data-theme')"});
  console.log('After data-theme:', afterDataTheme.result.result.value);
  
  const afterAccent = await send('Runtime.evaluate',{expression:"document.documentElement.getAttribute('data-accent')"});
  console.log('After data-accent:', afterAccent.result.result.value);
  
  // Check if the body background changed
  const bgColor = await send('Runtime.evaluate',{expression:"getComputedStyle(document.body).backgroundColor"});
  console.log('Body bg:', bgColor.result.result.value);
  
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 60000);