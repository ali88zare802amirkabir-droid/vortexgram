const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-shot';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4822','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4822/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
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

  async function shot(w,h,file,openChat){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,mobile:true,deviceScaleFactor:2});
    await send('Page.navigate',{url:'http://localhost:'+PORT+'/'}); await wait(1800);
    await send('Runtime.evaluate',{expression:"localStorage.setItem('ft_token','"+TOKEN+"'); location.reload();"}); await wait(2200);
    await wait(600);
    if(openChat){
      await send('Runtime.evaluate',{expression:"(function(){var rows=document.querySelectorAll('.cl-row'); if(rows&&rows.length){ rows[0].click(); }})()"});
      await wait(1200);
    }
    const scr = await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(file, Buffer.from(scr.result.data,'base64'));
    console.log('Saved', file);
  }

  await shot(390,844,'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\shot-390-list.png',false);
  await shot(390,844,'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\shot-390-chat.png',true);
  await shot(820,1180,'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\shot-820-list.png',false);

  console.log('DONE');
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 60000);
