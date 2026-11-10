/** Package real browser captures into aligned before/after review videos. Requires ffmpeg. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const input = path.resolve(process.env.CHAIR_OUTPUT || 'chair-motion-review.local');
const output = path.resolve('art/resident/chair-motion/review');
await fs.mkdir(output, { recursive: true });
const captures = JSON.parse(await fs.readFile(path.join(input, 'browser-motion.json'), 'utf8'));
const run = args => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error || Error(result.stderr);
};
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : 'font=Sans:';
for (const view of ['front', 'side']) {
  const cropX = view === 'front' ? 320 : 460;
  for (const [label, speed] of [['normal', 1], ['slow', .5]]) {
    const branches = ['old', 'new'].map((mode, index) => {
      const capture = captures.find(c => c.mode === mode && c.view === view);
      if (!capture || capture.errors.length) throw Error(`Missing or failed ${mode}/${view} capture`);
      const start = Math.max(0, capture.firstSitAt - .12);
      return `[${index}:v]trim=start=${start},setpts=PTS-STARTPTS,crop=640:888:${cropX}:0,fps=30,tpad=stop_mode=clone:stop_duration=1,trim=duration=3.1,setpts=PTS/${speed},fps=30,drawbox=x=0:y=0:w=iw:h=46:color=0x132027@0.94:t=fill,drawtext=${font}text='${mode === 'old' ? 'BEFORE' : 'AFTER'}  |  ${view.toUpperCase()}  |  ${speed}x':x=20:y=13:fontsize=20:fontcolor=white[v${index}]`;
    });
    run(['-i', path.join(input, `old-${view}.webm`), '-i', path.join(input, `new-${view}.webm`),
      '-filter_complex', `${branches.join(';')};[v0][v1]hstack=inputs=2[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(output, `${view}-${label}.mp4`)]);
  }
  run(['-ss', '2.1', '-i', path.join(output, `${view}-normal.mp4`), '-frames:v', '1', '-update', '1', path.join(output, `${view}-comparison.jpg`)]);
}
const angle = s => Math.atan2(s.neck[2] - s.hips[2], s.neck[1] - s.hips[1]) * 180 / Math.PI;
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
const metrics = captures.map(c => {
  const sit = c.samples.filter(s => s.phase === 'SIT_DOWN');
  const a = sit[0], b = c.samples.at(-1);
  return { mode: c.mode, view: c.view, errors: c.errors, samples: c.samples.length, firstSitAt: c.firstSitAt,
    hipDrop: a.hips[1] - b.hips[1], hipBackward: a.hips[2] - b.hips[2], maximumTorsoLean: Math.max(...sit.map(angle)),
    ankleDriftDuringSit: Math.max(...sit.flatMap(s => [distance(s.leftFoot, a.leftFoot), distance(s.rightFoot, a.rightFoot)])) };
});
await fs.writeFile(path.join(output, 'browser-summary.json'), JSON.stringify(metrics, null, 2) + '\n');
try {
  const flow = JSON.parse(await fs.readFile(path.resolve(process.env.CHAIR_FLOW_OUTPUT || 'chair-review.local', 'browser.json'), 'utf8'));
  const summary = { seated: flow.seated, noScoot: flow.noScoot, floorExit: flow.floorExit.phase, cancelled: flow.cancelled.phase,
    interruptedSit: flow.interruptedSit.phase, touch: flow.touch, phases: [...new Set(flow.samples.map(s => s.phase))], errors: flow.errors, resourceErrors: flow.resourceErrors };
  await fs.writeFile(path.join(output, 'flow-summary.json'), JSON.stringify(summary, null, 2) + '\n');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PocketWorld · 坐下动作对比</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101a20;color:#e9eef0;font:16px/1.65 system-ui,sans-serif}main{max-width:1260px;margin:auto;padding:40px 24px}h1{font-size:32px;margin:0 0 12px}h2{font-size:21px;margin:0 0 12px}p{max-width:940px;color:#bbccd4}nav{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}button,a{color:#b4dcbf}button{border:1px solid #719180;background:#1e302b;border-radius:8px;padding:10px 16px;cursor:pointer}section{padding:24px 0;border-top:1px solid #35444c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}video{display:block;width:100%;background:#071015;border-radius:8px}figcaption{color:#bbccd4;margin-top:8px}figure{margin:0}table{border-collapse:collapse;width:100%;max-width:960px}td,th{padding:10px;border-bottom:1px solid #35444c;text-align:left}.small{font-size:14px}@media(max-width:780px){.grid{grid-template-columns:1fr}main{padding:24px 16px}}
</style>
<main><h1>坐下动作 · 五阶段重做</h1>
<p>左侧为原动作，右侧为新动作。录像来自真实浏览器中的同一角色与同一把椅子；按进入 SIT_DOWN 的时刻对齐，前置 0.12 秒，最后保留坐稳画面。半速只改变播放时间。两次录制的环境背景时间不同。</p>
<nav><button id="replay">全部从头播放</button><button id="pause">全部暂停</button><a href="../README.md">动作说明</a><a href="browser-summary.json">浏览器测量</a><a href="../authoring.json">动画曲线</a></nav>
${['front','side'].map(view => `<section><h2>${view === 'front' ? '正面：膝盖、双手与落座顺序' : '侧面：前倾、后移与接触缓冲'}</h2><div class="grid">${['normal','slow'].map(speed => `<figure><video controls muted playsinline preload="metadata" poster="${view}-comparison.jpg" src="${view}-${speed}.mp4"></video><figcaption>${speed === 'normal' ? '正常速度 1×' : '半速 0.5×'} · 左：原动作 / 右：新动作</figcaption></figure>`).join('')}</div></section>`).join('')}
<section><h2>动作节奏</h2><table><thead><tr><th>时间</th><th>观察点</th></tr></thead><tbody><tr><td>0–0.18 秒</td><td>躯干先前倾，髋部基本保持高度。</td></tr><tr><td>0.18–0.46 秒</td><td>臀部后移，随后逐步屈膝。</td></tr><tr><td>0.46–1.00 秒</td><td>主要下降阶段；双脚保持支撑，双手留在身体两侧。</td></tr><tr><td>1.00–1.24 秒</td><td>进入支撑，轻微下沉、回弹、收稳。</td></tr><tr><td>1.24–1.80 秒</td><td>躯干先稳定，双手随后收至裙面；再衔接坐姿呼吸。</td></tr></tbody></table>
<p class="small">椅子和原角色 GLB 均未修改。新动作使用独立 948,368 字节 GLB 动画资源。原裙摆仍有硬折；现有接触处理不是完整布料自碰撞。测量单位为场景单位；模型按实际 1.45 比例加载。</p></section></main>
<script>const videos=[...document.querySelectorAll('video')];document.querySelector('#replay').onclick=()=>videos.forEach(v=>{v.currentTime=0;v.play().catch(()=>{});});document.querySelector('#pause').onclick=()=>videos.forEach(v=>v.pause());</script></html>`);
console.log(JSON.stringify({ output, metrics }));
