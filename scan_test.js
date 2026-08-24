const http = require('http');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const UD = 'C:\\Users\\PC-ali\\AppData\\Local\\Temp\\fake-telegram\\edge-scan';
const PORT = 1458;
const TOKEN = 'TESTADMINTOKEN';
const WS = require('ws');
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function get(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async () => {
  fs.rmSync(UD, {recursive:true, force:true}); fs.mkdirSync(UD, {recursive:true});
  const dbg = require('child_process').spawn(EDGE, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--user-data-dir='+UD,'--remote-debugging-port=4823','about:blank'], {stdio:'ignore'});
  let list=null;
  for(let i=0;i<30;i++){ try{ list=JSON.parse(await get('http://localhost:4823/json/list')); if(Array.isArray(list)&&list.length)break; }catch(e){} await wait(400); }
  if(!list||!list.length){ console.log('NO PAGE TARGET'); dbg.kill(); process.exit(3); }
  const page = list.find(t=>t.type==='page')||list[0];
  const ws = new WS(page.webSocketDebuggerUrl);
  let nextId=1; const pending={};
  ws.on('error', e=>console.log('WS ERR', e.message));
  function send(method,params){ return new Promise((res)=>{ const id=nextId++; pending[id]=res; ws.send(JSON.stringify({id,method,params})); }); }
  ws.on('message',(raw)=>{ try{ const m=JSON.parse(raw); if(m.id&&pending[m.id]){ pending[m.id](m); delete pending[m.id]; } }catch(e){} });
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable'); await send('Console.enable');

  async function scan(w,h,label,openChat){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,mobile:true,deviceScaleFactor:2});
    await send('Page.navigate',{url:'http://localhost:'+PORT+'/'}); await wait(1500);
    await send('Runtime.evaluate',{expression:"localStorage.setItem('ft_token','"+TOKEN+"'); location.reload();"}); await wait(2000);
    await wait(500);
    if(openChat){
      await send('Runtime.evaluate',{expression:"(function(){var rows=document.querySelectorAll('.cl-row'); if(rows&&rows.length){ rows[0].click(); }})()"});
      await wait(1000);
    }
    const out = await send('Runtime.evaluate',{expression:"(function(){ var vw=window.innerWidth, vh=window.innerHeight; var res=[]; var all=document.querySelectorAll('*'); for(var i=0;i<all.length;i++){ var e=all[i]; var r=e.getBoundingClientRect(); if(r.height > vh*0.5 && r.width>0 && r.width < vw*0.5){ var cx=r.left+r.width/2; if(cx > vw*0.25 && cx < vw*0.75){ res.push(e.className+'|L='+Math.round(r.left)+' T='+Math.round(r.top)+' W='+Math.round(r.width)+' H='+Math.round(r.height)); } } } return 'VW='+vw+' VH='+vh+'\\n'+res.slice(0,15).join('\\n'); })()"});
    console.log('=== '+label+' ===');
    console.log(out.result.result.value);
  }

  await scan(390,844,'390 list',false);
  await scan(390,844,'390 chat',true);
  await scan(768,1024,'768 list',false);
  await scan(820,1180,'820 list',false);
  await scan(360,780,'360 list',false);

  console.log('DONE');
  ws.close(); dbg.kill(); process.exit(0);
})().catch(e=>{console.log('FATAL',e.message);process.exit(9);});
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(8);}, 90000);
