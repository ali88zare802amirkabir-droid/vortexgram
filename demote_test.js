const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-demote';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4820','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4820/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
  if(!list||!list.length){ console.log('NO PAGE TARGET'); dbg.kill(); process.exit(3); }
  const page = list.find(t=>t.type==='page')||list[0];
  const ws = new WS(page.webSocketDebuggerUrl);
  let nextId=1; const pending={};
  ws.on('error', e=>console.log('WS ERR', e.message));
  function send(method,params){ return new Promise((res)=>{ const id=nextId++; pending[id]=res; ws.send(JSON.stringify({id,method,params})); }); }
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.id&&pending[m.id]){ pending[m.id](m); delete pending[m.id]; } }catch(e){} });
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Runtime.enable');
  await send('Console.enable');
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error'){ console.log('[CONSOLE ERROR]', m.params.args.map(a=>a.value||a.description).join(' ')); } else if(m.method==='Runtime.exceptionThrown'){ console.log('[EXCEPTION]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); } }catch(e){} });
  await send('Page.navigate',{url:'http://localhost:'+PORT+'/'}); await wait(2000);
  await send('Runtime.evaluate',{expression:"localStorage.setItem('ft_token','"+TOKEN+"'); location.reload();"}); await wait(2500);
  
  // Go to users
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='users'); el&&el.click();})()"});
  await wait(1000);
  
  // Click profile on u9383992025 (non-admin) - find row with that username
  await send('Runtime.evaluate',{expression:"(function(){var rows=document.querySelectorAll('.au-row'); for(var i=0;i<rows.length;i++){ if(rows[i].dataset.u==='u9383992025'){ rows[i].querySelector('[data-act=profile]').click(); break; } }})()"});
  await wait(800);
  
  const promoteBtn = await send('Runtime.evaluate',{expression:"!!document.querySelector('[data-act=promote]')"});
  console.log('Promote button (u9383992025, non-admin):', promoteBtn.result.result.value);
  const demoteBtn = await send('Runtime.evaluate',{expression:"!!document.querySelector('[data-act=demote]')"});
  console.log('Demote button (u9383992025, non-admin):', demoteBtn.result.result.value);
  
  // Check admin's own profile (self) - should have NO demote (self blocked)
  await send('Runtime.evaluate',{expression:"(function(){var el=document.querySelector('.nav-profile'); if(el) el.click();})()"});
  await wait(800);
  // close details if open
  await send('Runtime.evaluate',{expression:"var dp=document.querySelector('.dp-close'); if(dp) dp.click();"});
  await wait(300);
  // open own profile
  await send('Runtime.evaluate',{expression:"(function(){var el=[].slice.call(document.querySelectorAll('.nav-item')).find(e=>e.dataset.nav==='users'); el&&el.click();})()"});
  await wait(800);
  await send('Runtime.evaluate',{expression:"(function(){var rows=document.querySelectorAll('.au-row'); for(var i=0;i<rows.length;i++){ if(rows[i].dataset.u==='admin'){ rows[i].querySelector('[data-act=profile]').click(); break; } }})()"});
  await wait(800);
  const selfDemote = await send('Runtime.evaluate',{expression:"!!document.querySelector('[data-act=demote]')"});
  console.log('Demote button on self (admin):', selfDemote.result.result.value);
  const selfPromote = await send('Runtime.evaluate',{expression:"!!document.querySelector('[data-act=promote]')"});
  console.log('Promote button on self (admin):', selfPromote.result.result.value);
  
  console.log('TEST DONE');
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 60000);
