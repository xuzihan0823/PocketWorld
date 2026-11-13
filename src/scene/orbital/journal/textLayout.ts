/// <reference lib="es2022.intl" />

export interface JournalTextStop { x: number; y: number; offset: number }

export interface JournalTextLayout {
  carets: { x: number; y: number }[];
  stops: JournalTextStop[];
  glyphs: { text: string; offset: number; x: number; y: number; width: number }[];
}

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;

export function journalTextLayout(text: string, measure: (text: string) => number, inset: number): JournalTextLayout {
  const carets = [{ x: inset, y: 102 }], glyphs: JournalTextLayout['glyphs'] = [];
  const stops = [{ x: inset, y: 102, offset: 0 }];
  let x = inset, y = 102, offset = 0;
  const characters = graphemes ? Array.from(graphemes.segment(text), item => item.segment) : text;
  for (const character of characters) {
    if (character === '\n' || character === '\r\n') {
      for (let i = 1; i < character.length; i++) carets[offset + i] = { x, y };
      offset += character.length; x = inset; y += 28;
      carets[offset] = { x, y }; stops.push({ x, y, offset });
      continue;
    }
    const width = measure(character) + 0.4;
    if (x + width > inset + 262 && x > inset) {
      // The same text offset is both the end of this row and the start of the next.
      x = inset; y += 28; stops.push({ x, y, offset });
    }
    for (let i = 0; i < character.length; i++) carets[offset + i] = { x, y };
    glyphs.push({ text: character, offset, x, y, width });
    offset += character.length; x += width;
    carets[offset] = { x, y }; stops.push({ x, y, offset });
  }
  return { carets, stops, glyphs };
}

export function journalTextStop(layout: JournalTextLayout, x: number, y: number, scroll: number): JournalTextStop {
  const baseline = 102 + Math.max(0, Math.round((y + scroll - 92) / 28)) * 28;
  let closest = layout.stops[0];
  for (const stop of layout.stops) {
    const rows = Math.abs(stop.y - baseline) - Math.abs(closest.y - baseline);
    if (rows < 0 || (rows === 0 && Math.abs(stop.x - x) < Math.abs(closest.x - x))) closest = stop;
  }
  return closest;
}

export const journalTextHit = (layout: JournalTextLayout, x: number, y: number, scroll: number) => journalTextStop(layout, x, y, scroll).offset;
