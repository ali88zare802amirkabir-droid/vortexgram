const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-cl';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4831','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4831/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
  if(!list||!list.length){ console.log('NO PAGE TARGET'); dbg.kill(); process.exit(3); }
  const page = list.find(t=>t.type==='page')||list[0];
  const ws = new WS(page.webSocketDebuggerUrl);
  let nextId=1; const pending={};
  ws.on('error', e=>console.log('WS ERR', e.message));
  function send(method,params){ return new Promise((res)=>{ const id=nextId++; pending[id]=res; ws.send(JSON.stringify({id,method,params})); }); }
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.id&&pending[m.id]){ pending[m.id](m); delete pending[m.id]; } }catch(e){} });
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable');

  async function geo(w,label,addClass){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:900,mobile:false,deviceScaleFactor:1});
    await send('Page.navigate',{url:'http://localhost:'+PORT+'/'}); await wait(1500);
    await send('Runtime.evaluate',{expression:"localStorage.setItem('ft_token','"+TOKEN+"'); location.reload();"}); await wait(2000);
    await wait(500);
    if(addClass){
      await send('Runtime.evaluate',{expression:"document.documentElement.classList.add('mobile');"});
      await wait(300);
    }
    const g = await send('Runtime.evaluate',{expression:"(function(){ function f(s){ var e=document.querySelector(s); if(!e) return s+' NONE'; var r=e.getBoundingClientRect(); return s+' L='+Math.round(r.left)+' W='+Math.round(r.width); } return 'VW='+window.innerWidth+' htmlMobile='+document.documentElement.classList.contains('mobile')+' | '+[f('#chat-list-column'),f('#conversation'),f('#nav-sidebar')].join(' | '); })()"});
    console.log(label+': '+g.result.result.value);
  }
  await geo(1280,'1280 no-class',false);
  await geo(1280,'1280 +html.mobile',true);
  await geo(412,'412 (normal phone)',false);
  console.log('DONE'); ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG');process.exit(8);}, 60000);
