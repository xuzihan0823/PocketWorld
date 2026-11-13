import { CanvasTexture, SRGBColorSpace } from 'three';
import type { JournalPage } from '../../../types/world';
import { JOURNAL_WEATHER } from './weather';
import { journalTextLayout } from './textLayout';

export interface JournalSelection { start: number; end: number; caret: boolean; point?: { x: number; y: number } }

export function journalPageTexture(page: JournalPage, index: number, date: string, left: boolean, scroll = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 636;
  canvas.height = 856;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  paintJournalPage(texture, page, index, date, left, scroll);
  return texture;
}

export function paintJournalPage(texture: CanvasTexture, page: JournalPage, index: number, date: string, left: boolean, scroll = 0, selection?: JournalSelection) {
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.fillStyle = '#f5f0e1';
  ctx.fillRect(0, 0, 318, 428);
  const gutter = ctx.createLinearGradient(left ? 318 : 0, 0, left ? 304 : 14, 0);
  gutter.addColorStop(0, '#d7cfbc');
  gutter.addColorStop(1, '#f5f0e1');
  ctx.fillStyle = gutter;
  ctx.fillRect(left ? 304 : 0, 0, 14, 428);
  const inset = left ? 24 : 32;
  ctx.font = '12px SimSun, serif';
  ctx.fillStyle = '#82745c';
  ctx.fillText('天气', inset, 43);
  JOURNAL_WEATHER.forEach((weather, i) => {
    ctx.save();
    ctx.translate(inset + 32 + i * 27, 29);
    ctx.scale(20 / 24, 20 / 24);
    ctx.strokeStyle = '#82745c';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (weather.id === 'sunny') { ctx.beginPath(); ctx.arc(12, 12, 4, 0, Math.PI * 2); ctx.stroke(); }
    weather.paths.forEach(path => ctx.stroke(new Path2D(path)));
    if (page.weather === weather.id) {
      ctx.strokeStyle = '#8e5b46';
      ctx.lineWidth = 2.2;
      ctx.stroke(new Path2D('m3 13 5 5L21 4'));
    }
    ctx.restore();
  });
  ctx.font = '10px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.fillText(page.date ?? date, left ? 286 : 294, 42);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#c8b998';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(inset, 65); ctx.lineTo(inset + 262, 65); ctx.stroke();
  ctx.strokeStyle = '#bb80743b';
  ctx.beginPath(); ctx.moveTo(left ? 294 : 24, 76); ctx.lineTo(left ? 294 : 24, 386); ctx.stroke();
  ctx.save();
  ctx.beginPath(); ctx.rect(inset, 81, 262, 295); ctx.clip();
  ctx.strokeStyle = '#a899746e';
  for (let y = 108 - scroll % 28; y < 376; y += 28) {
    ctx.beginPath(); ctx.moveTo(inset, y); ctx.lineTo(inset + 262, y); ctx.stroke();
  }
  ctx.fillStyle = '#45483e';
  ctx.font = '16px SimSun, serif';
  const layout = journalTextLayout(page.text, value => ctx.measureText(value).width, inset);
  for (const glyph of layout.glyphs) {
    if (selection && selection.start !== selection.end && glyph.offset + glyph.text.length > selection.start && glyph.offset < selection.end) {
      ctx.fillStyle = '#c7d4bf'; ctx.fillRect(glyph.x, glyph.y - 20 - scroll, glyph.width, 28);
    }
    ctx.fillStyle = '#45483e'; ctx.fillText(glyph.text, glyph.x, glyph.y - scroll);
  }
  if (selection && selection.caret && selection.start === selection.end) {
    const caret = selection.point ?? layout.carets[Math.min(selection.start, page.text.length)];
    ctx.fillStyle = '#7c513d'; ctx.fillRect(caret.x, caret.y - 18 - scroll, 1, 22);
  }
  if (!page.text && !selection) {
    ctx.save(); ctx.translate(inset, 83); ctx.scale(0.75, 0.75); ctx.strokeStyle = '#9b8c70'; ctx.lineWidth = 1.4;
    ctx.stroke(new Path2D('m15 4 5 5M4 20l2-6L17 3a2.1 2.1 0 0 1 3 3L9 17l-5 3Zm2-6 3 3M4 20l1-3')); ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = '#82745c';
  ctx.font = '12px Georgia, serif';
  ctx.textAlign = left ? 'left' : 'right';
  ctx.fillText(String(index + 1).padStart(2, '0'), left ? 36 : 282, 405);
  ctx.font = '22px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText(left ? '‹' : '›', left ? 12 : 305, 406);
  texture.needsUpdate = true;
  return layout;
}
