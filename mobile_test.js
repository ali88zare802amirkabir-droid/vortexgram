const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-mobile';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4821','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4821/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
  if(!list||!list.length){ console.log('NO PAGE TARGET'); dbg.kill(); process.exit(3); }
  const page = list.find(t=>t.type==='page')||list[0];
  const ws = new WS(page.webSocketDebuggerUrl);
  let nextId=1; const pending={};
  ws.on('error', e=>console.log('WS ERR', e.message));
  function send(method,params){ return new Promise((res)=>{ const id=nextId++; pending[id]=res; ws.send(JSON.stringify({id,method,params})); }); }
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.id&&pending[m.id]){ pending[m.id](m); delete pending[m.id]; } }catch(e){} });
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable'); await send('Console.enable');
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error'){ console.log('[CONSOLE ERROR]', m.params.args.map(a=>a.value||a.description).join(' ')); } }catch(e){} });
  // Emulate mobile viewport 390x844
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,mobile:true,deviceScaleFactor:2});
  await send('Page.navigate',{url:'http://localhost:'+PORT+'/'}); await wait(2000);
  await send('Runtime.evaluate',{expression:"localStorage.setItem('ft_token','"+TOKEN+"'); location.reload();"}); await wait(2500);
  await wait(800);

  const geom = await send('Runtime.evaluate',{expression:"(function(){ function g(sel){ var e=document.querySelector(sel); if(!e) return sel+' => NOT FOUND'; var r=e.getBoundingClientRect(); var cs=getComputedStyle(e); return sel+' => L='+Math.round(r.left)+' T='+Math.round(r.top)+' W='+Math.round(r.width)+' H='+Math.round(r.height)+' pos='+cs.position+' disp='+cs.display+' transform='+cs.transform; } return [g('#app'),g('#nav-sidebar'),g('#chat-list-column'),g('#conversation'),g('#command-dock')].join('\\n'); })()"});
  console.log('=== GEOMETRY (390x844) ===');
  console.log(geom.result.result.value);

  // Is nav visible in viewport?
  const navVisible = await send('Runtime.evaluate',{expression:"(function(){ var e=document.querySelector('#nav-sidebar'); var r=e.getBoundingClientRect(); return (r.left < window.innerWidth) && (r.right > 0); })()"});
  console.log('nav overlapping viewport:', navVisible.result.result.value);

  // Now open nav via hamburger to see where it lands
  await send('Runtime.evaluate',{expression:"var b=[].slice.call(document.querySelectorAll('.nav-item,.mobile-only')).find(e=>e.dataset&&e.dataset.nav==='menu'||(e.classList&&e.classList.contains('nav-item')&&e.dataset.nav==='menu'));"});
  // find hamburger
  const opened = await send('Runtime.evaluate',{expression:"(function(){ var btns=document.querySelectorAll('.nav-item'); for(var i=0;i<btns.length;i++){ if(btns[i].dataset.nav==='menu'){ btns[i].click(); return true; } } return false; })()"});
  await wait(500);
  const navOpen = await send('Runtime.evaluate',{expression:"(function(){ var e=document.querySelector('#nav-sidebar'); var r=e.getBoundingClientRect(); return 'nav L='+Math.round(r.left)+' W='+Math.round(r.width)+' inView='+((r.left<window.innerWidth)&&(r.right>0)); })()"});
  console.log('After hamburger tap:', navOpen.result.result.value);

  console.log('TEST DONE');
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 60000);
