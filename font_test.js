const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-font';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4894','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4894/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
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
  const zoom0 = await send('Runtime.evaluate',{expression:"document.documentElement.style.zoom || 'none'"});
  console.log('zoom before:', zoom0.result.result.value);
  // go to settings
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='settings'); el&&el.click();})()"});
  await wait(800);
  const hasFont = await send('Runtime.evaluate',{expression:"!!document.getElementById('set-font-inc')"});
  console.log('set-font-inc present:', hasFont.result.result.value);
  await send('Runtime.evaluate',{expression:"document.getElementById('set-font-inc').click();"});
  await wait(400);
  const zoom1 = await send('Runtime.evaluate',{expression:"document.documentElement.style.zoom || 'none'"});
  console.log('zoom after +:', zoom1.result.result.value);
  console.log('DONE'); ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 40000);
