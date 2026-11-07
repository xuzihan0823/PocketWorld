import { terrainY, terrainAngle } from './engine';
import { TRAILS, type Feature, type Partner, type RenderOptions, type SkiState, type Trail } from './model';
import type { NaiwaAction, SkiAssets, SpriteClip } from './assets';
export type { RenderOptions } from './model';

const W = 800;
const H = 600;
const TAU = Math.PI * 2;
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const mod = (n: number, d: number) => ((n % d) + d) % d;

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), 0, 0, TAU);
  ctx.fill();
}
function line(ctx: CanvasRenderingContext2D, x: number, y: number, xx: number, yy: number, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xx, yy); ctx.stroke();
}
function sprite(ctx: CanvasRenderingContext2D, clip: SpriteClip, time: number, scale: number, phase = 0) {
  const frame = Math.floor(mod(time * clip.fps + phase, clip.frameCount));
  ctx.drawImage(clip.image, frame * clip.frameWidth, clip.row * clip.frameHeight,
    clip.frameWidth, clip.frameHeight, -clip.anchor[0] * scale, -clip.anchor[1] * scale,
    clip.frameWidth * scale, clip.frameHeight * scale);
}

function pine(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, snow: string) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  line(ctx, 0, 0, 0, -114, '#655C4D', 7);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -145);
  ctx.bezierCurveTo(-8, -116, -12, -112, -23, -99);
  ctx.quadraticCurveTo(-15, -100, -12, -101);
  ctx.quadraticCurveTo(-22, -80, -37, -65);
  ctx.quadraticCurveTo(-28, -66, -23, -67);
  ctx.quadraticCurveTo(-37, -42, -52, -26);
  ctx.quadraticCurveTo(-25, -14, 0, -18);
  ctx.quadraticCurveTo(25, -14, 52, -26);
  ctx.quadraticCurveTo(35, -44, 23, -67);
  ctx.quadraticCurveTo(30, -65, 37, -65);
  ctx.quadraticCurveTo(23, -82, 12, -101);
  ctx.lineTo(23, -99); ctx.quadraticCurveTo(8, -119, 0, -145); ctx.fill();
  ctx.fillStyle = snow;
  for (let tier = 0; tier < 3; tier++) {
    const yy = -128 + tier * 35;
    const span = 12 + tier * 13;
    ctx.beginPath(); ctx.moveTo(0, yy - 12);
    ctx.quadraticCurveTo(-span * .6, yy + 10, -span, yy + 20);
    ctx.quadraticCurveTo(-span * .4, yy + 25, 0, yy + 15);
    ctx.quadraticCurveTo(span * .35, yy + 23, span, yy + 20);
    ctx.quadraticCurveTo(span * .6, yy + 10, 0, yy - 12); ctx.fill();
  }
  ctx.restore();
}

function mountains(ctx: CanvasRenderingContext2D, scroll: number, trail: Trail) {
  const night = trail.id === 'night';
  for (let layer = 0; layer < 2; layer++) {
    const shift = mod(scroll * (.055 + layer * .035), 850);
    ctx.fillStyle = layer ? trail.mountain : night ? '#344A6B' : '#B6D1DC';
    if (trail.id === 'forest' && !layer) ctx.fillStyle = '#D5B7C4';
    for (let repeat = -1; repeat < 2; repeat++) {
      const xx = repeat * 850 - shift;
      const base = 370 + layer * 35;
      ctx.beginPath(); ctx.moveTo(xx - 60, base);
      ctx.bezierCurveTo(xx + 5, 300, xx + 60, 272, xx + 130, 204 + layer * 35);
      ctx.quadraticCurveTo(xx + 149, 185 + layer * 35, xx + 165, 212 + layer * 35);
      ctx.bezierCurveTo(xx + 225, 286, xx + 260, 279, xx + 315, 334);
      ctx.bezierCurveTo(xx + 375, 260, xx + 434, 223, xx + 490, 165 + layer * 52);
      ctx.quadraticCurveTo(xx + 506, 145 + layer * 52, xx + 527, 173 + layer * 52);
      ctx.bezierCurveTo(xx + 620, 285, xx + 670, 267, xx + 730, 328);
      ctx.quadraticCurveTo(xx + 800, 285, xx + 870, base);
      ctx.lineTo(xx + 870, 460); ctx.lineTo(xx - 60, 460); ctx.closePath(); ctx.fill();
      ctx.fillStyle = night ? '#819DAF' : '#EEF6F6';
      ctx.beginPath(); ctx.moveTo(xx + 96, 242 + layer * 35);
      ctx.lineTo(xx + 130, 204 + layer * 35); ctx.quadraticCurveTo(xx + 149, 185 + layer * 35, xx + 165, 212 + layer * 35);
      ctx.lineTo(xx + 200, 253 + layer * 35); ctx.lineTo(xx + 164, 233 + layer * 35);
      ctx.lineTo(xx + 150, 245 + layer * 35); ctx.lineTo(xx + 139, 226 + layer * 35); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(xx + 446, 215 + layer * 52);
      ctx.lineTo(xx + 490, 165 + layer * 52); ctx.quadraticCurveTo(xx + 506, 145 + layer * 52, xx + 527, 173 + layer * 52);
      ctx.lineTo(xx + 566, 220 + layer * 52); ctx.lineTo(xx + 523, 197 + layer * 52);
      ctx.lineTo(xx + 506, 213 + layer * 52); ctx.lineTo(xx + 491, 193 + layer * 52); ctx.closePath(); ctx.fill();
      ctx.fillStyle = layer ? trail.mountain : night ? '#344A6B' : trail.id === 'forest' ? '#D5B7C4' : '#B6D1DC';
    }
  }
}

function sky(ctx: CanvasRenderingContext2D, trail: Trail, scroll: number, time: number, reduced: boolean) {
  const night = trail.id === 'night';
  const wash = ctx.createLinearGradient(0, 0, 0, 440);
  wash.addColorStop(0, trail.sky);
  wash.addColorStop(1, night ? '#6C91A6' : trail.id === 'forest' ? '#F9E2CB' : '#ECF7FA');
  ctx.fillStyle = wash; ctx.fillRect(0, 0, W, H);
  ellipse(ctx, 657, 147, night ? 27 : 35, night ? 27 : 35, night ? '#FFF2CD' : '#FFF8DA');
  if (night) {
    ellipse(ctx, 670, 137, 25, 25, trail.sky);
    for (let i = 0; i < 44; i++) {
      const x = mod(i * 179.3 + 23, W);
      const y = 29 + mod(i * 61.7, 231);
      ellipse(ctx, x, y, i % 7 === 0 ? 1.8 : .9, i % 7 === 0 ? 1.8 : .9, '#E0F3ED');
    }
    ctx.save(); ctx.globalAlpha = .21;
    for (let band = 0; band < 3; band++) {
      ctx.strokeStyle = band === 1 ? '#BDCEEF' : '#8CE2CC';
      ctx.lineWidth = 14 + band * 7; ctx.beginPath();
      for (let x = -30; x <= 830; x += 14) {
        const y = 116 + band * 20 + Math.sin(x / 145 + (reduced ? 0 : time * .06)) * 39;
        if (x === -30) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.save(); ctx.globalAlpha = .65;
    for (let i = 0; i < 4; i++) {
      const x = mod(i * 269 - scroll * .025, 1080) - 140;
      const y = 100 + i % 2 * 63;
      ellipse(ctx, x, y, 62, 9, '#FFFFFF');
      ellipse(ctx, x - 15, y - 9, 33, 12, '#FFFFFF');
      ellipse(ctx, x + 23, y - 5, 35, 11, '#FFFFFF');
    }
    ctx.restore();
  }
  mountains(ctx, scroll, trail);
  for (let i = 0; i < 19; i++) {
    const x = mod(i * 83 - scroll * .29, 1020) - 100;
    pine(ctx, x, 383 + Math.sin(i * 2.1) * 18, .35 + mod(i * .13, .3), trail.pine, night ? '#94BBC8' : '#DAEAF0');
  }
}

function cabin(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, time: number, reduced: boolean) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ellipse(ctx, 8, 7, 100, 13, '#BCD1D8');
  ctx.fillStyle = '#A46E48'; ctx.fillRect(-69, -94, 138, 94);
  ctx.fillStyle = '#77543C'; ctx.beginPath(); ctx.moveTo(-79, -90); ctx.lineTo(0, -154); ctx.lineTo(79, -90); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 7; i++) line(ctx, -67, -82 + i * 13, 67, -82 + i * 13, '#855A3D', 2);
  ctx.fillStyle = '#6E5142'; ctx.fillRect(34, -161, 17, 43);
  ctx.fillStyle = '#F7FCFF'; ctx.fillRect(30, -165, 25, 8);
  ctx.beginPath(); ctx.moveTo(-88, -93); ctx.lineTo(-4, -166); ctx.quadraticCurveTo(0, -169, 6, -164);
  ctx.lineTo(88, -94); ctx.quadraticCurveTo(70, -85, 60, -100); ctx.lineTo(1, -147);
  ctx.lineTo(-62, -94); ctx.quadraticCurveTo(-77, -82, -88, -93); ctx.fill();
  ctx.fillStyle = '#4C4238'; ctx.fillRect(-19, -64, 38, 64);
  ctx.fillStyle = '#F8CF73'; ctx.fillRect(-14, -57, 28, 57);
  ctx.fillStyle = '#E7AB57'; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-45, 10); ctx.lineTo(58, 10); ctx.lineTo(14, 0); ctx.fill();
  for (const xx of [-49, 44]) {
    ctx.fillStyle = '#4C4238'; ctx.fillRect(xx - 13, -69, 27, 31);
    ctx.fillStyle = '#FFE3A1'; ctx.fillRect(xx - 10, -66, 21, 25);
    line(ctx, xx, -66, xx, -41, '#A7784D', 3);
    line(ctx, xx - 10, -53, xx + 11, -53, '#A7784D', 3);
    line(ctx, xx - 16, -36, xx + 17, -36, '#F7FCFF', 6);
  }
  if (!reduced) for (let i = 0; i < 4; i++) {
    const p = mod(time * .22 + i / 4, 1);
    ctx.globalAlpha = (1 - p) * .3;
    ellipse(ctx, 43 + Math.sin(p * 5) * 12, -174 - p * 65, 8 + p * 12, 5 + p * 8, '#FFFFFF');
  }
  ctx.restore();
}

function snowGround(ctx: CanvasRenderingContext2D, state: SkiState, cameraX: number, cameraY: number, trail: Trail) {
  ctx.beginPath(); ctx.moveTo(-10, H + 10);
  for (let x = -10; x <= W + 10; x += 8) ctx.lineTo(x, terrainY(x + cameraX, state.trail) - cameraY);
  ctx.lineTo(W + 10, H + 10); ctx.closePath();
  const wash = ctx.createLinearGradient(0, 390, 0, 600);
  wash.addColorStop(0, trail.snow); wash.addColorStop(1, trail.id === 'night' ? '#BDD7E5' : '#DBEBEF');
  ctx.fillStyle = wash; ctx.fill();
  ctx.strokeStyle = trail.snow; ctx.lineWidth = 5; ctx.stroke();
  for (let row = 0; row < 3; row++) {
    ctx.strokeStyle = row === 0 ? '#C3DCE5' : '#CBDDE4';
    ctx.globalAlpha = .55 - row * .12; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 12) {
      const y = terrainY(x + cameraX, state.trail) - cameraY + 29 + row * 49 + Math.sin((x + cameraX) / 170 + row) * 8;
      if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 31; i++) {
    const worldX = Math.floor(cameraX / 37) * 37 + i * 37;
    const x = worldX - cameraX;
    const y = terrainY(worldX, state.trail) - cameraY + 18 + mod(worldX * 1.71, 155);
    line(ctx, x, y, x + 3 + mod(i * 3, 6), y - 1, '#C1D7DF', 1);
  }
}

function fallbackNaiwa(ctx: CanvasRenderingContext2D, time: number, skis: boolean) {
  ctx.lineWidth = 1.8; ctx.strokeStyle = '#85602B';
  const body = ctx.createLinearGradient(-10, -65, 16, -13);
  body.addColorStop(0, '#FFF08A'); body.addColorStop(.65, '#F2C244'); body.addColorStop(1, '#CE9226');
  ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(0, -68);
  ctx.bezierCurveTo(18, -70, 23, -58, 13, -52); ctx.bezierCurveTo(14, -42, 29, -30, 18, -18);
  ctx.bezierCurveTo(4, -6, -22, -13, -19, -30); ctx.bezierCurveTo(-17, -47, -7, -66, 0, -68);
  ctx.fill(); ctx.stroke();
  ellipse(ctx, 8, -31, 12, 16, '#F9E7BF');
  ellipse(ctx, 10, -61, 5, 5, '#98B983'); ellipse(ctx, 12, -61, 2, 3, '#24312A');
  line(ctx, 10, -52, 17, -53, '#6E4B2F', 1.5);
  line(ctx, -8, -16, -8, -3, '#8B652E', 5); line(ctx, 9, -15, 13, -3, '#8B652E', 5);
  line(ctx, -10, -2, -2, -2, '#60472C', 4); line(ctx, 11, -2, 19, -2, '#60472C', 4);
  line(ctx, -9, -43, -25, -39 + Math.sin(time * 9) * 2, '#B74740', 6);
  if (skis) line(ctx, -35, 2, 36, 0, '#3C5962', 3);
}

function drawNaiwa(ctx: CanvasRenderingContext2D, assets: SkiAssets | null, action: NaiwaAction, time: number) {
  const clip = assets?.naiwa[action];
  if (clip) sprite(ctx, clip, time, .36);
  else {
    ctx.save();
    if (action === 'tuck') ctx.scale(1.3, .52);
    fallbackNaiwa(ctx, time, action !== 'ride' && action !== 'idle');
    ctx.restore();
  }
}

function fallbackDoubao(ctx: CanvasRenderingContext2D, time: number) {
  const swing = Math.sin(time * 14) * 11;
  ctx.lineCap = 'round';
  line(ctx, -3, -29, -8 + swing, -4, '#F1EBDD', 8);
  line(ctx, 3, -29, 7 - swing, -3, '#E9E0CC', 8);
  ellipse(ctx, 0, -56, 12, 15, '#3C302B');
  ellipse(ctx, 4, -55, 8, 10, '#F5CDB1'); ellipse(ctx, 8, -57, 1.5, 2, '#322B2A');
  ctx.fillStyle = '#292D30'; ctx.beginPath(); ctx.moveTo(-9, -43); ctx.lineTo(7, -43);
  ctx.lineTo(10, -26); ctx.quadraticCurveTo(0, -22, -11, -27); ctx.closePath(); ctx.fill();
  line(ctx, -7, -40, -13 - swing * .2, -28, '#F5CDB1', 4);
  line(ctx, 7, -40, 13 + swing * .2, -32, '#F5CDB1', 4);
  line(ctx, -8 + swing, -3, -3 + swing, -3, '#4E5359', 4);
  line(ctx, 7 - swing, -2, 13 - swing, -2, '#4E5359', 4);
}

function partner(ctx: CanvasRenderingContext2D, assets: SkiAssets | null, type: Partner, time: number) {
  const clip = assets?.niulai[type];
  if (clip) sprite(ctx, clip, time, type === 'slide' ? .32 : .245);
  else {
    const slide = type === 'slide';
    ellipse(ctx, 0, slide ? -18 : -31, slide ? 34 : 22, slide ? 16 : 28, '#F4AD39');
    ellipse(ctx, slide ? 27 : 4, slide ? -36 : -65, 16, 18, '#FCD660');
    ellipse(ctx, slide ? 32 : 7, slide ? -31 : -59, 12, 8, '#F9E6BD');
    ellipse(ctx, slide ? 31 : 10, slide ? -41 : -71, 2, 2, '#473827');
    for (const side of [-1, 1]) line(ctx, side * 13, -15, side * 17 + Math.sin(time * 12 + side) * 3, -3, '#CA8B3E', 7);
  }
}

function feature(ctx: CanvasRenderingContext2D, f: Feature, state: SkiState, assets: SkiAssets | null, cameraX: number, cameraY: number) {
  if (f.used && f.kind !== 'gap' && f.kind !== 'ramp' && f.kind !== 'ice') return;
  const x = f.x + f.width / 2 - cameraX;
  const y = f.y - cameraY;
  if (x + f.width < -100 || x - f.width > W + 100) return;
  ctx.save(); ctx.translate(x, y);
  if (f.kind === 'coin') {
    const width = 6 + Math.abs(Math.cos(state.time * 3.5 + f.id)) * 4;
    ellipse(ctx, 0, 2, width + 2, 12, '#B87D2B'); ellipse(ctx, 0, 0, width, 11, '#F7CD67');
    ellipse(ctx, -1, -1, Math.max(2, width - 3), 7, '#FCE7A5');
    line(ctx, 0, -4, 0, 4, '#C18B36', 2);
  } else if (f.kind === 'rock') {
    ellipse(ctx, 0, 3, f.width * .6, 5, '#BED1D9');
    ctx.fillStyle = '#6D8793'; ctx.beginPath(); ctx.moveTo(-f.width / 2, 0);
    ctx.bezierCurveTo(-f.width * .6, -18, -f.width * .24, -38, 4, -34);
    ctx.bezierCurveTo(f.width * .4, -36, f.width * .55, -18, f.width / 2, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#94AAB3'; ctx.beginPath(); ctx.moveTo(-f.width * .4, -13); ctx.lineTo(-5, -30);
    ctx.lineTo(9, -25); ctx.lineTo(4, -7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#F8FCFC'; ctx.beginPath(); ctx.moveTo(-f.width * .4, -22); ctx.quadraticCurveTo(-5, -44, f.width * .37, -24);
    ctx.quadraticCurveTo(6, -18, 0, -24); ctx.quadraticCurveTo(-9, -18, -f.width * .4, -22); ctx.fill();
  } else if (f.kind === 'branch') {
    line(ctx, f.width / 2 - 5, 1, f.width / 2 + 2, -110, '#6E6051', 12);
    line(ctx, -f.width / 2, -57, f.width / 2, -62, '#74604A', 11);
    line(ctx, -f.width / 2 + 2, -65, f.width / 2, -70, '#EFF9FA', 7);
    line(ctx, -14, -58, -28, -81, '#74604A', 5);
    pine(ctx, f.width / 2 + 3, -93, .46, '#3D6166', '#E7F1F2');
    ctx.fillStyle = '#B65040'; ctx.fillRect(-f.width / 2 + 8, -57, 7, 17);
  } else if (f.kind === 'ramp') {
    ctx.fillStyle = '#D1E5EA'; ctx.beginPath(); ctx.moveTo(-f.width / 2, 0);
    ctx.quadraticCurveTo(3, -6, f.width / 2, -27); ctx.lineTo(f.width / 2, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#FAFEFF'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-f.width / 2, 0);
    ctx.quadraticCurveTo(3, -6, f.width / 2, -27); ctx.stroke();
    line(ctx, f.width / 2 + 4, 0, f.width / 2 + 4, -48, '#778D91', 2);
    ctx.fillStyle = '#BB5C44'; ctx.beginPath(); ctx.moveTo(f.width / 2 + 4, -48); ctx.lineTo(f.width / 2 + 23, -43); ctx.lineTo(f.width / 2 + 4, -36); ctx.fill();
  } else if (f.kind === 'ice' || f.kind === 'gap') {
    const gap = f.kind === 'gap';
    ctx.fillStyle = gap ? '#7199AE' : '#9FD4E2';
    ctx.beginPath();
    for (let xx = -f.width / 2; xx <= f.width / 2; xx += 5) {
      const yy = terrainY(f.x + f.width / 2 + xx, state.trail) - f.y;
      if (xx === -f.width / 2) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.lineTo(f.width / 2, gap ? 72 : 6); ctx.quadraticCurveTo(0, gap ? 113 : 12, -f.width / 2, gap ? 64 : 6); ctx.closePath(); ctx.fill();
    if (gap) {
      ctx.fillStyle = '#D2E8EE'; ctx.beginPath(); ctx.moveTo(-f.width / 2, 65);
      ctx.quadraticCurveTo(0, 111, f.width / 2, 73); ctx.lineTo(f.width / 2, 88); ctx.quadraticCurveTo(0, 122, -f.width / 2, 80); ctx.fill();
      for (let i = 0; i < 5; i++) {
        const xx = -f.width / 2 + 8 + i * f.width / 5;
        const yy = terrainY(x + cameraX + xx, state.trail) - f.y;
        ctx.fillStyle = '#DCF2FA'; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 3, yy + 19 + i % 2 * 9); ctx.lineTo(xx + 9, yy); ctx.fill();
      }
    } else for (let i = 0; i < 4; i++) line(ctx, -f.width * .35 + i * f.width / 5, 2, -f.width * .25 + i * f.width / 5, -3, '#EAFBFF', 2);
  } else {
    ellipse(ctx, 0, 3, 40, 7, '#C6DDE2');
    partner(ctx, assets, f.kind, state.time);
    ctx.font = '600 12px "PingFang SC", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#315863';
    ctx.fillText(f.kind === 'slide' ? '滑行接力' : '冲撞接力', 0, -91);
  }
  ctx.restore();
}

function drawChaser(ctx: CanvasRenderingContext2D, assets: SkiAssets | null, x: number, y: number, time: number, phase: number, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ellipse(ctx, 0, 2, 17, 3, '#9ABAC7');
  if (assets?.doubao) sprite(ctx, assets.doubao, time, .36, phase);
  else fallbackDoubao(ctx, time + phase);
  ctx.restore();
}

function snowDust(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, speed: number, reduced: boolean) {
  if (reduced) return;
  const count = speed > 330 ? 18 : 10;
  for (let i = 0; i < count; i++) {
    const p = mod(time * 1.8 + i / count, 1);
    ctx.globalAlpha = (1 - p) * .65;
    ellipse(ctx, x - 16 - p * (45 + speed * .09), y - p * (9 + i % 4 * 5), 1 + p * 4, 1 + p * 2, '#FFFFFF');
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx: CanvasRenderingContext2D, state: SkiState, assets: SkiAssets | null, x: number, y: number, reduced: boolean) {
  const p = state.player;
  const caught = state.over ? clamp(state.caughtTime / 1.2) : 0;
  const action: NaiwaAction = p.crashTime > 0 || state.over ? 'crash' : p.partner ? 'ride'
    : p.tucked ? 'tuck' : !p.grounded ? p.flipping ? 'flip' : 'jump' : p.speed > 330 ? 'boost' : 'glide';
  if (p.partner && caught < .8) {
    const lift = p.partner === 'slide' ? 22 : 42;
    ctx.save(); ctx.translate(x + (p.partner === 'charge' ? 15 : 0), y + lift);
    ctx.rotate(p.grounded ? terrainAngle(p.x, state.trail) : p.angle * .2);
    partner(ctx, assets, p.partner, state.time); ctx.restore();
    if (p.shield) {
      ctx.strokeStyle = '#D6A648'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.arc(x, y - 25, 48, -.7, .7); ctx.stroke();
    }
  }
  ctx.save();
  const pivot = p.crashTime > 0 || p.tucked || state.over ? 18 : 32;
  ctx.translate(x - caught * 13, y - pivot + caught * 15);
  ctx.rotate(p.angle + caught * 1.3);
  ctx.scale(1 - caught * .8, 1 - caught * .8);
  ctx.translate(0, pivot);
  ctx.globalAlpha = 1 - clamp((caught - .7) / .3);
  if (p.crashTime > 0 || state.over) ctx.scale(1.2, .58);
  else if (p.tucked && p.partner) ctx.scale(1.15, .55);
  else if (p.squash > 0 && !reduced) ctx.scale(1 + Math.min(.13, p.squash * .12), 1 - Math.min(.13, p.squash * .12));
  drawNaiwa(ctx, assets, action, state.time);
  ctx.restore();
}

function caughtSwarm(ctx: CanvasRenderingContext2D, state: SkiState, assets: SkiAssets | null, x: number, y: number, reduced: boolean) {
  const progress = clamp(state.caughtTime / 1.1);
  for (let i = 0; i < 6; i++) {
    const target = (i - 2.5) * 13;
    const xx = x + target - (1 - progress) * (110 + i * 20);
    const yy = y + 5 + i % 2 * 7 - (reduced ? 0 : Math.sin(progress * Math.PI) * 10);
    drawChaser(ctx, assets, xx, yy, state.time + state.caughtTime, i * 1.3);
  }
  if (!reduced) for (let i = 0; i < 14; i++) {
    const p = clamp(state.caughtTime / 1.7);
    const angle = i * 2.4;
    ctx.globalAlpha = Math.sin(p * Math.PI) * .75;
    ellipse(ctx, x + Math.cos(angle) * (20 + p * 60), y - 20 + Math.sin(angle) * p * 35, 2 + i % 3, 2 + i % 3, '#FFFFFF');
  }
  ctx.globalAlpha = 1;
}

export function renderGame(ctx: CanvasRenderingContext2D, state: SkiState, assets: SkiAssets | null, options: RenderOptions): void {
  const trail = TRAILS.find(item => item.id === state.trail) || TRAILS[0];
  const menu = options.phase === 'home' || options.phase === 'select';
  const cameraX = menu ? 0 : state.player.x - 240;
  const cameraY = menu ? 0 : state.cameraY;
  const time = state.time;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.imageSmoothingEnabled = true;
  sky(ctx, trail, cameraX, time, options.reducedMotion);
  snowGround(ctx, state, cameraX, cameraY, trail);
  if (menu) {
    pine(ctx, 74, 434, 1.16, trail.pine, trail.snow);
    pine(ctx, 729, 462, 1.48, trail.pine, trail.snow);
    cabin(ctx, 177, 444, 1.05, time, options.reducedMotion);
    ctx.save(); ctx.translate(635, 461); ctx.scale(1.38, 1.38);
    ellipse(ctx, 0, 2, 24, 4, '#A7C5D0'); drawNaiwa(ctx, assets, 'idle', time); ctx.restore();
    line(ctx, 682, 462, 687, 392, '#6B6050', 3);
    line(ctx, 690, 461, 694, 392, '#6B6050', 3);
    line(ctx, 675, 466, 709, 464, '#B5503F', 4);
  } else {
    const cabinX = 65 - cameraX;
    if (cabinX > -160 && cabinX < W + 160) cabin(ctx, cabinX, terrainY(65, state.trail) - cameraY, .72, time, options.reducedMotion);
    for (let i = 0; i < 5; i++) {
      const worldX = Math.floor((cameraX - 200) / 263) * 263 + i * 263;
      const x = worldX - cameraX;
      const ground = terrainY(worldX, state.trail) - cameraY;
      if (Math.abs(x - 240) > 110) pine(ctx, x, ground - 12, .65 + mod(worldX * .017, .4), trail.pine, trail.snow);
    }
    for (const f of state.features) feature(ctx, f, state, assets, cameraX, cameraY);
    for (let i = 0; i < Math.min(state.chasers.length, 12); i++) {
      const chaser = state.chasers[i];
      const x = chaser.x - cameraX;
      if (x < -80 || x > W + 80) continue;
      const y = terrainY(chaser.x, state.trail) - cameraY;
      if (i % 3 === 0 && x > -40) {
        ctx.save(); ctx.globalAlpha = .58;
        drawChaser(ctx, assets, x - 24, y - 10, time, chaser.phase + 3, .85); ctx.restore();
      }
      snowDust(ctx, x, y, time + chaser.phase, 220, options.reducedMotion);
      drawChaser(ctx, assets, x, y, time, chaser.phase);
    }
    const p = state.player;
    const x = p.x - cameraX;
    const y = p.y - cameraY;
    const ground = terrainY(p.x, state.trail) - cameraY;
    const height = Math.max(0, ground - y);
    ctx.save(); ctx.globalAlpha = clamp(1 - height / 250, .12, .6);
    ellipse(ctx, x + 2, ground + 3, Math.max(8, 26 - height * .04), 4, '#7298A9'); ctx.restore();
    if (p.grounded) snowDust(ctx, x, ground, time, p.speed, options.reducedMotion);
    drawPlayer(ctx, state, assets, x, y, options.reducedMotion);
    if (state.over) caughtSwarm(ctx, state, assets, x, ground, options.reducedMotion);
    if (!options.reducedMotion) for (let i = 0; i < Math.min(state.particles.length, 90); i++) {
      const particle = state.particles[i];
      ctx.globalAlpha = clamp(particle.life * 2);
      ellipse(ctx, particle.x - cameraX, particle.y - cameraY, 2.3, 2.3, particle.color);
    }
    ctx.globalAlpha = 1;
    if (p.x < 620) {
      const signX = 470 - cameraX;
      const signY = terrainY(470, state.trail) - cameraY;
      line(ctx, signX, signY, signX, signY - 68, '#80735C', 5);
      ctx.fillStyle = '#F0E5CE'; ctx.fillRect(signX - 41, signY - 72, 82, 28);
      ctx.font = '600 13px "PingFang SC", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#37545D';
      ctx.fillText('向雪谷出发', signX, signY - 53);
    }
  }
  if (!options.reducedMotion) for (let i = 0; i < 26; i++) {
    const x = mod(i * 89.7 - time * (7 + i % 4), W);
    const y = mod(i * 57.1 + time * (9 + i % 5), H);
    ctx.globalAlpha = .2 + i % 3 * .12;
    ellipse(ctx, x, y, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1, '#FFFFFF');
  }
  ctx.restore();
}
