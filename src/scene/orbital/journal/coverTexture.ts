import * as THREE from 'three';

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function clothTexture(title = false, color = '#45534a') {
  return canvasTexture(768, 1080, ctx => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, 768, 1080);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff09';
    for (let x = 0; x < 768; x += 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1080); ctx.stroke(); }
    ctx.strokeStyle = '#0000000b';
    for (let y = 0; y < 1080; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(768, y); ctx.stroke(); }
    if (title) {
      ctx.strokeStyle = '#d0c19a99'; ctx.lineWidth = 2;
      ctx.strokeRect(88, 95, 592, 890);
      ctx.fillStyle = '#dfd0a7'; ctx.textAlign = 'center';
      ctx.font = '62px SimSun, serif'; ctx.fillText('日  记', 384, 430, 520);
      ctx.font = '23px Georgia, serif'; ctx.fillText('M O M E N T S', 384, 493);
      ctx.beginPath(); ctx.moveTo(332, 548); ctx.lineTo(436, 548); ctx.stroke();
    }
  });
}
