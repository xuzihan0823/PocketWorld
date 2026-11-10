/** Actual WebGL comparison: run the accepted and new source trees with identical cameras.
 * PW_MODULE and BROWSER_PATH select an installed Playwright and Chrome. No production UI hooks.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright');
const root=process.cwd(),out=path.resolve(process.env.CHAIR_OUTPUT || 'chair-motion-review.local');
await fs.mkdir(out,{recursive:true});
const modes=process.argv.includes('--current-only')?['new']:['old','new'];
const views=process.argv.includes('--side')?['side']:['front','side'];
const results=[];
for(const mode of modes){
 const workspace=mode==='old'?path.resolve(process.env.CHAIR_BASELINE || '../chair-stage2.local'):root;
 const server=await createServer({root:workspace,cacheDir:path.join(root,'chair-cache.local',mode),server:{host:'127.0.0.1',port:mode==='old'?8976:8977,strictPort:true},logLevel:'error'});
 let browser;
 try{
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
  for(const view of views){
   const page=await browser.newPage({viewport:{width:1280,height:888}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))errors.push(m.text());});
   page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))errors.push(`${r.status()} ${r.url()}`);});
   await page.goto(`http://127.0.0.1:${mode==='old'?8976:8977}/?resident=tripo`);
   await page.waitForFunction(()=>window.tripoRoomAudit);
   await page.evaluate(async view=>{
    const url=performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('@react-three_fiber.js'));
    const fiber=await import(url),store=[...fiber._roots.values()][0].store,state=store.getState();
    const actor=state.scene.getObjectByName('OrbitalResidents_habitat').getObjectByName('OrbitalResident');
    const chair=state.scene.getObjectByName('Furniture_habitat').getObjectByName('OfficeChair');
    let mesh;actor.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});
    const vec=()=>actor.position.clone().set(0,0,0),bone=n=>mesh.skeleton.bones.find(b=>b.name.replace(/[^\w]/g,'')==='mixamorig'+n);
    const pos=n=>actor.worldToLocal(bone(n).getWorldPosition(vec())).toArray();
    const data={actor,chair,mesh,samples:[],recording:false};window.motionReview=data;
    const dir=(view==='front'?vec().set(0,.10,1):vec().set(1,.08,0)).applyAxisAngle(vec().set(0,1,0),3.0915926535897933).multiplyScalar(1.35);
    let close=false;
    state.internal.subscribers.push({priority:0,store,ref:{current:()=>{
     const s=actor.userData.chairSeating;
     if(s?.phase==='TURN')close=true;
     if(close){const target=actor.getWorldPosition(vec()).add(vec().set(0,.72,0));state.camera.position.copy(target).add(dir);state.camera.lookAt(target);state.camera.fov=70;state.camera.updateProjectionMatrix();}
     if(data.recording&&data.samples.length<1000){
      actor.updateWorldMatrix(true,true);
      data.samples.push({at:(performance.now()-data.started)/1000,phase:s?.phase,elapsed:s?.elapsed,position:actor.position.toArray(),hips:pos('Hips'),neck:pos('Neck'),head:pos('Head'),leftKnee:pos('LeftLeg'),rightKnee:pos('RightLeg'),leftFoot:pos('LeftFoot'),rightFoot:pos('RightFoot'),leftHand:pos('LeftHand'),rightHand:pos('RightHand')});
     }
    }}});
    const p=chair.getObjectByName('SeatContact').getWorldPosition(vec()).project(state.camera);data.click={x:(p.x*.5+.5)*innerWidth,y:(-p.y*.5+.5)*innerHeight};
   },view);
   const click=await page.evaluate(()=>window.motionReview.click);await page.mouse.click(click.x,click.y);
   await page.waitForFunction(()=>{const s=window.motionReview.actor.userData.chairSeating;return s?.phase==='TURN'&&s.turnProgress>=.80;},{},{timeout:45000});
   await page.evaluate(()=>{
    const r=window.motionReview;r.chunks=[];r.stream=document.querySelector('canvas').captureStream(30);
    r.recorder=new MediaRecorder(r.stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:5500000});r.recorder.ondataavailable=e=>r.chunks.push(e.data);
    r.started=performance.now();r.recording=true;r.recorder.start(100);
   });
   await page.waitForFunction(()=>{const s=window.motionReview.actor.userData.chairSeating;return s?.phase==='SEATED_IDLE'&&s.elapsed>=1.15;},{},{timeout:12000});
   await page.screenshot({path:path.join(out,`${mode}-${view}.png`)});
   const result=await page.evaluate(async()=>{
    const r=window.motionReview;r.recording=false;await new Promise(resolve=>{r.recorder.onstop=resolve;r.recorder.stop();});r.stream.getTracks().forEach(t=>t.stop());
    const b=new Uint8Array(await new Blob(r.chunks).arrayBuffer());let text='';for(let i=0;i<b.length;i+=8192)text+=String.fromCharCode(...b.subarray(i,i+8192));
    return {video:btoa(text),samples:r.samples};
   });
   await fs.writeFile(path.join(out,`${mode}-${view}.webm`),Buffer.from(result.video,'base64'));
   const firstSit=result.samples.find(s=>s.phase==='SIT_DOWN');
   results.push({mode,view,errors,firstSitAt:firstSit?.at,samples:result.samples});
   await fs.writeFile(path.join(out,'browser-motion.json'),JSON.stringify(results,null,2));
   console.log(JSON.stringify({mode,view,errors,samples:result.samples.length,firstSitAt:firstSit?.at}));
   await page.close();
  }
 }finally{await browser?.close();await server.close();}
}
