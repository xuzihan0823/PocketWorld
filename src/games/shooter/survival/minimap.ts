import { WORLD } from './engine';
import type { Run } from './engine';

export const MINIMAP_SIZE = 160;
const center = MINIMAP_SIZE / 2;
const radius = center - 5;
const scale = radius / 800;

export function drawMinimap(context: CanvasRenderingContext2D, run: Pick<Run, 'player' | 'enemies'>): void {
  const { player, enemies } = run;
  context.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();

  // The radar stays centered on the player and shows the actual arena limits at its edges.
  context.fillStyle = '#11182650';
  context.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  const left = center - player.x * scale;
  const top = center - player.y * scale;
  context.fillStyle = '#838ba220';
  context.fillRect(left, top, WORLD * scale, WORLD * scale);
  context.strokeStyle = '#9aa6b672';
  context.lineWidth = 1.6;
  context.strokeRect(left, top, WORLD * scale, WORLD * scale);

  context.strokeStyle = '#a2a8c329';
  context.lineWidth = 1;
  for (const range of [radius / 2, radius - 1]) {
    context.beginPath();
    context.arc(center, center, range, 0, Math.PI * 2);
    context.stroke();
  }

  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const dx = (enemy.x - player.x) * scale;
    const dy = (enemy.y - player.y) * scale;
    const boss = enemy.kind === 3;
    const edge = radius - (boss ? 8 : 3);
    if (dx * dx + dy * dy > edge * edge) continue;
    const x = center + dx;
    const y = center + dy;
    context.fillStyle = boss ? '#deb4e4' : '#d795a7';
    context.beginPath();
    context.arc(x, y, boss ? 4.7 : 3, 0, Math.PI * 2);
    context.fill();
    if (boss) {
      context.strokeStyle = '#edc9ec';
      context.beginPath();
      context.arc(x, y, 7.4, 0, Math.PI * 2);
      context.stroke();
    }
  }

  context.fillStyle = '#f3e9cb';
  context.strokeStyle = '#272239';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(center, center - 7);
  context.lineTo(center + 6, center);
  context.lineTo(center, center + 7);
  context.lineTo(center - 6, center);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}
