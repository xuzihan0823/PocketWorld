// Browser integration fixture. Run from the project root; PW_MODULE/BROWSER_PATH are optional.
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright');
const output = process.env.CHAIR_OUTPUT || 'chair-review.local';
const port = Number(process.env.CHAIR_PORT || 8974);
await fs.mkdir(output, { recursive: true });
const server=await createServer({root:process.cwd(),server:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
const page=await browser.newPage({viewport:{width:1440,height:1000},recordVideo:{dir:output+'/video',size:{width:1440,height:1000}}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await page.goto(`http://127.0.0.1:${port}/`);await page.waitForTimeout(4000);
await page.screenshot({path:output+'/room.png'});
console.log(await page.evaluate(async()=>{
 const url=performance.getEntriesByType('resource').map(e=>e.name).find(n=>n.includes('/.vite/deps/@react-three_fiber.js'));
 const fiber=await import(url), store=[...fiber._roots.values()][0].store,state=store.getState();window.review={state,store};
 const root=state.scene.getObjectByName('OrbitalResident');const names=[];state.scene.traverse(o=>{if(o.name&&/chair|Resident/.test(o.name))names.push(o.name)});
 return {url,names,root:root?.position.toArray(),text:document.body.innerText};
}));
await page.mouse.click(851,549);
await page.waitForTimeout(1200);console.log('clicked',await page.evaluate(()=>({data:window.review.state.scene.getObjectByName('OrbitalResident').userData,pos:window.review.state.scene.getObjectByName('OrbitalResident').position.toArray(),text:document.body.innerText.slice(-400)})));
await page.waitForFunction(()=>window.review.state.scene.getObjectByName('OrbitalResident').userData.chairMotion?.phase==='backing',{},{timeout:30000});
await page.evaluate(()=>{const {state}=window.review,actor=state.scene.getObjectByName('OrbitalResident');window.review.actor=actor;window.review.view='side';window.review.samples=[];
 state.internal.subscribers.push({priority:0,store:window.review.store,ref:{current:()=>{
  const view=window.review.view;if(view==='room'){state.camera.position.set(11,10.05,14);state.camera.fov=34;state.camera.lookAt(0,1.05,0);state.camera.updateProjectionMatrix();return;}const v=actor.position.clone().set(view==='front'?0:1,.25,view==='front'?1:.15).applyAxisAngle(actor.up,actor.rotation.y);
  const target=actor.getWorldPosition(actor.position.clone()).add(actor.position.clone().set(0,.85,0));
  state.camera.position.copy(target).addScaledVector(v,3.3);state.camera.fov=35;state.camera.lookAt(target);state.camera.updateProjectionMatrix();
  window.review.samples.push({phase:actor.userData.chairMotion?.phase,time:actor.userData.chairMotion?.time,position:actor.position.toArray()});
 }}});
});
for(const [label,condition] of [['start',"m?.phase==='blend-in'"],['lower',"m?.phase==='sit-down'&&m.time>1.5"],['seated',"m?.phase==='seated'"]]){
 await page.waitForFunction(condition=>{const m=window.review.actor.userData.chairMotion;return eval(condition)},condition,{timeout:30000});
 await page.screenshot({path:`${output}/${label}-side.png`});
}
await page.evaluate(()=>window.review.view='room');await page.waitForTimeout(100);await page.screenshot({path:output+'/room-seated.png'});
await page.evaluate(()=>window.review.view='side');
await page.keyboard.press('KeyE');await page.waitForFunction(()=>window.review.actor.userData.posture==='standing',{},{timeout:30000});
await page.screenshot({path:output+'/standing-front.png'});
// Re-enter and cancel during actual descent.
await page.keyboard.press('KeyE');
await page.waitForFunction(()=>window.review.actor.userData.chairMotion?.phase==='sit-down'&&window.review.actor.userData.chairMotion.time>.7,{},{timeout:30000});
await page.keyboard.press('Escape');
await page.waitForFunction(()=>window.review.actor.userData.posture==='standing',{},{timeout:30000});
// Enter again, exercise the existing chair scoot, then leave by a floor click.
await page.keyboard.press('KeyE');
await page.waitForFunction(()=>window.review.actor.userData.chairMotion?.phase==='seated',{},{timeout:30000});
const before=await page.evaluate(()=>window.review.actor.position.toArray());
await page.keyboard.down('KeyS');await page.waitForTimeout(850);await page.keyboard.up('KeyS');
await page.screenshot({path:output+'/scoot-side.png'});
await page.waitForTimeout(1600);
const after=await page.evaluate(()=>window.review.actor.position.toArray());
console.log('scoot',before,after);
await page.evaluate(()=>window.review.view='room');await page.waitForTimeout(200);
const target=await page.evaluate(()=>{const {actor,state}=window.review;let p=actor.position.clone().set(.3,0,1.2);actor.parent.localToWorld(p);p.project(state.camera);return[(p.x+1)*720,(1-p.y)*500]});
await page.mouse.click(...target);
await page.waitForFunction(()=>{const r=window.review.actor;return r.userData.posture==='standing'&&Math.hypot(r.position.x-.3,r.position.z-1.2)<.1},{},{timeout:30000});
console.log('floor exit reached');
await fs.writeFile(output+'/browser.json',JSON.stringify({errors,samples:await page.evaluate(()=>window.review.samples)},null,2));
console.log({errors,phase:await page.evaluate(()=>window.review.actor.userData.posture)});
}catch(e){process.exitCode=1;console.error(e);await page.screenshot({path:output+'/failure.png'});console.log(await page.evaluate(()=>({data:window.review.state.scene.getObjectByName('OrbitalResident').userData,pos:window.review.state.scene.getObjectByName('OrbitalResident').position.toArray(),text:document.body.innerText.slice(-400)})))}finally{await page.close();console.log('video',await page.video().path());await browser.close();await server.close();}
