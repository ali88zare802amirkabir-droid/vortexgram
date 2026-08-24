const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-mf';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4832','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4832/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
  if(!list||!list.length){ console.log('NO PAGE TARGET'); dbg.kill(); process.exit(3); }
  const page = list.find(t=>t.type==='page')||list[0];
  const ws = new WS(page.webSocketDebuggerUrl);
  let nextId=1; const pending={};
  ws.on('error', e=>console.log('WS ERR', e.message));
  function send(method,params){ return new Promise((res)=>{ const id=nextId++; pending[id]=res; ws.send(JSON.stringify({id,method,params})); }); }
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.id&&pending[m.id]){ pending[m.id](m); delete pending[m.id]; } }catch(e){} });
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable'); await send('Console.enable');
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){ console.log('[ERR]', m.params.args.map(a=>a.value||a.description).join(' ')); } }catch(e){} });

  async function geo(w,h,label){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,mobile:false,deviceScaleFactor:1});
    await send('Page.navigate',{url:'http://localhost:'+PORT+'/'}); await wait(1500);
    await send('Runtime.evaluate',{expression:"localStorage.setItem('ft_token','"+TOKEN+"'); location.reload();"}); await wait(3500);
    await wait(500);
    const g = await send('Runtime.evaluate',{expression:"(function(){ function f(s){ var e=document.querySelector(s); if(!e) return s+' NONE'; var r=e.getBoundingClientRect(); return s+' L='+Math.round(r.left)+' W='+Math.round(r.width); } return 'VW='+window.innerWidth+' | '+[f('#chat-list-column'),f('#conversation'),f('#nav-sidebar'),f('#command-dock')].join(' | '); })()"});
    console.log(label+': '+g.result.result.value);
  }
  await geo(1280,900,'warmup');
  await geo(800,360,'800 landscape');
  await geo(1280,900,'1280 desktop');
  await geo(412,915,'412 portrait');
  console.log('DONE'); ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG');process.exit(8);}, 60000);
