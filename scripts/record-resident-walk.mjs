import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(process.env.LAB_OUT || 'art/resident/tripo-transitions');
const scratch = path.resolve(process.env.WALK_FRAMES || 'art/resident/generated/walk-frames');
const fps=30, views=['front','side','back'], labels={front:'正面',side:'侧面',back:'背面'};
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const report=[],errors=[];
const variants=[
  ...(process.env.BASELINE_URL?[{mode:'before',url:process.env.BASELINE_URL,title:'修复前 · fe8bf8c',dynamic:true}]:[]),
  {mode:'static',url:process.env.LAB_URL,title:'修复后 · 基础动作',dynamic:false},
  {mode:'dynamic',url:process.env.LAB_URL,title:'修复后 · 开启动态',dynamic:true},
];
try {
  await fs.mkdir(out,{recursive:true});
  for(const variant of variants) {
    const page=await browser.newPage({viewport:{width:700,height:760},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(variant.url || 'http://127.0.0.1:8946/?dev=resident&asset=transitions');
    await page.waitForFunction(()=>window.residentAudit?.ready);
    await page.evaluate(()=>window.residentAudit.setAutomatic(false));
    await page.getByRole('button',{name:'播放动作',exact:true}).click();
    await page.addStyleTag({content:'.resident-lab-view{inset:0!important}.resident-lab-panel{display:none}'});
    await page.waitForTimeout(150);
    for(const view of views) await fs.mkdir(path.join(scratch,variant.mode,view),{recursive:true});
    let frame=0;
    for(const [clip,duration] of [['SitCycle',2.4],['Walk',3.6]]) {
      await page.getByLabel('测试动作').selectOption(clip,{force:true});
      await page.getByLabel('身体往返移动').evaluate((el,walk)=>{if(el.checked!==walk)el.click()},clip==='Walk');
      await page.evaluate(({clip,dynamic})=>{const l=window.residentAudit;l.configure({hair:dynamic,dress:dynamic,collisions:dynamic});l.setPose(clip,0)}, {clip,dynamic:variant.dynamic});
      const samples=[];
      for(let i=0;i<Math.round(duration*fps);i+=10) {
        const batch=await page.evaluate(({i,duration,clip,variant,views,labels,fps})=>{
          const l=window.residentAudit,source=document.querySelector('.resident-lab-view canvas');
          const canvas=document.createElement('canvas');canvas.width=700;canvas.height=820;
          const ctx=canvas.getContext('2d'),batch=[];
          for(let j=i;j<Math.min(i+10,Math.round(duration*fps));j++) {
            const images={},time=j/fps,contact=l.surfaceContacts(true,true).dress;
            const maxAngleDegrees=l.snapshot().maxAngle*180/Math.PI;
            for(const view of views) {
              l.camera(view);ctx.fillStyle='#e8edf3';ctx.fillRect(0,0,700,820);ctx.drawImage(source,0,40,700,760);
              ctx.font='600 20px Microsoft YaHei';ctx.fillStyle='#244058';ctx.fillText(variant.title+' · '+labels[view],20,28);
              ctx.font='16px Microsoft YaHei';ctx.fillText(clip==='SitCycle'?'步行接近 → 减速停稳':'Walk · 匹配根位移 / 跟随观察',20,810);
              ctx.textAlign='right';ctx.fillText(time.toFixed(2)+' s',680,810);ctx.textAlign='left';
              images[view]=canvas.toDataURL('image/jpeg',.93).split(',')[1];
            }
            batch.push({time,contact,maxAngleDegrees,images});l.advance(1/fps,120);
          }
          return batch;
        },{i,duration,clip,variant,views,labels,fps});
        for(const item of batch) {
          samples.push({time:item.time,maxAngleDegrees:item.maxAngleDegrees,...item.contact});
          for(const [view,data] of Object.entries(item.images)) await fs.writeFile(path.join(scratch,variant.mode,view,String(frame).padStart(5,'0')+'.jpg'),Buffer.from(data,'base64'));
          frame++;
        }
      }
      const walking=samples.filter(s=>clip==='Walk'||s.time<2.1);
      const summary={clip,mode:variant.mode,frames:samples.length,
        meanPenetrating:samples.reduce((s,x)=>s+x.penetrating,0)/samples.length,maxDepth:Math.max(...samples.map(x=>x.maxDepth)),
        maxWalkingSecondaryAngleDegrees:Math.max(...walking.map(x=>x.maxAngleDegrees))};
      report.push({...summary,samples});console.log(JSON.stringify(summary));
      if(variant.mode!=='before') {
        assert.equal(summary.meanPenetrating,0,JSON.stringify(summary));
        assert.ok(summary.maxWalkingSecondaryAngleDegrees<9.01,JSON.stringify(summary));
      }
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);
  const ffmpeg=args=>execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-nostdin','-y',...args],{stdio:'inherit'});
  const video=[];
  for(const [file,left,right,view] of [
    ...views.map(view=>['walk-'+view+'.mp4','static','dynamic',view]),
    ...(process.env.BASELINE_URL?[['before-after-side.mp4','before','dynamic','side']]:[]),
  ]) {
    ffmpeg(['-framerate','30','-i',path.join(scratch,left,view,'%05d.jpg'),'-framerate','30','-i',path.join(scratch,right,view,'%05d.jpg'),
      '-filter_complex','hstack=inputs=2','-frames:v','180','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,file)]);
    const probe=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,avg_frame_rate,nb_frames,duration','-of','json',path.join(out,file)],{encoding:'utf8'})).streams[0];
    assert.equal(Number(probe.nb_frames),180);assert.equal(Number(probe.duration),6);assert.equal(probe.avg_frame_rate,'30/1');
    ffmpeg(['-i',path.join(out,file),'-f','null','-']);
    video.push({file,...probe});
  }
  if(process.env.BASELINE_URL) ffmpeg(['-i',path.join(out,'before-after-side.mp4'),'-vf','select=eq(n\\,28)+eq(n\\,44),tile=1x2','-frames:v','1',path.join(out,'back-repair-comparison.png')]);
  await fs.writeFile(path.join(out,'walk-browser-validation.json'),JSON.stringify({fps,report,video,errors},null,2)+'\n');
} finally { await browser.close(); }
