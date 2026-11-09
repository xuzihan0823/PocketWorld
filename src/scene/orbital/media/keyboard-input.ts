export type KeyboardKey = { code: string; label: string; units: number; x: number; z: number; width: number; depth: number; accent: boolean };
type KeySpec = readonly [code: string, label: string, units?: number];
const letters = (text: string): KeySpec[] => [...text].map(letter => [`Key${letter}`, letter]);
const rows: KeySpec[][] = [
  [['Escape', 'Esc'], ...Array.from({ length: 12 }, (_, i): KeySpec => [`F${i + 1}`, `F${i + 1}`]), ['Delete', 'Del', 2]],
  [['Backquote', '`'], ...[...'1234567890'].map((n): KeySpec => [`Digit${n}`, n]), ['Minus', '-'], ['Equal', '='], ['Backspace', '⌫', 2]],
  [['Tab', 'Tab', 1.5], ...letters('QWERTYUIOP'), ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5]],
  [['CapsLock', 'Caps', 1.75], ...letters('ASDFGHJKL'), ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', 2.25]],
  [['ShiftLeft', 'Shift', 2.25], ...letters('ZXCVBNM'), ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', 1.75], ['ArrowUp', '↑']],
  [['ControlLeft', 'Ctrl', 1.25], ['MetaLeft', 'Win'], ['AltLeft', 'Alt', 1.25], ['Space', 'SPACE', 6.25], ['AltRight', 'Alt', 1.25], ['ControlRight', 'Ctrl'], ['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']],
];
const accentKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
export const KEYBOARD_KEYS: KeyboardKey[] = rows.flatMap((row, index) => {
  let cursor = -15 * .048 / 2;
  return row.map(([code, label, units = 1]) => {
    const key = { code, label, units, x: cursor + units * .048 / 2, z: -.145 + index * .052, width: units * .048 - .005, depth: index === 0 ? .032 : .044, accent: accentKeys.has(code) };
    cursor += units * .048; return key;
  });
});
const available = new Set(KEYBOARD_KEYS.map(key => key.code));
const aliases: Record<string, string> = { MetaRight: 'MetaLeft', NumpadEnter: 'Enter', NumpadAdd: 'Equal', NumpadSubtract: 'Minus', NumpadMultiply: 'Digit8', NumpadDivide: 'Slash', NumpadDecimal: 'Period' };
const fallback: Record<string, string> = { ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Control: 'ControlLeft', Shift: 'ShiftLeft', Alt: 'AltLeft', Meta: 'MetaLeft' };
function visualCode(code: string, key: string): string | null {
  const raw = code || (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : fallback[key] ?? key);
  const mapped = aliases[raw] ?? (/^Numpad\d$/.test(raw) ? `Digit${raw.slice(-1)}` : raw);
  return available.has(mapped) ? mapped : null;
}

/** Only currently held physical codes and a short visual tap pulse; no text/history. */
export class KeyboardPressState {
  private held = new Map<string, string>();
  private counts = new Map<string, number>();
  private taps = new Map<string, number>();
  press(code: string, key = '', now = performance.now()): void {
    const mapped = visualCode(code, key), source = code || key.toLowerCase();
    if (!mapped || this.held.has(source)) return;
    this.held.set(source, mapped); this.counts.set(mapped, (this.counts.get(mapped) ?? 0) + 1); this.taps.set(mapped, now + 80);
  }
  release(code: string, key = ''): void {
    const source = code || key.toLowerCase(), mapped = this.held.get(source);
    if (!mapped) return;
    this.held.delete(source); const count = (this.counts.get(mapped) ?? 1) - 1;
    if (count) this.counts.set(mapped, count); else this.counts.delete(mapped);
    // Browsers can swallow letter keyups in system shortcuts.
    if (code === 'MetaLeft' || code === 'MetaRight') this.clear();
  }
  active(code: string, now = performance.now()): boolean { return (this.counts.get(code) ?? 0) > 0 || (this.taps.get(code) ?? 0) > now; }
  clear(): void { this.held.clear(); this.counts.clear(); this.taps.clear(); }
}

export function bindKeyboardFeedback(input: KeyboardPressState, target: EventTarget, visibility: EventTarget & { hidden: boolean }): () => void {
  const down = (event: Event): void => { const e = event as KeyboardEvent; input.press(e.code, e.key); };
  const up = (event: Event): void => { const e = event as KeyboardEvent; input.release(e.code, e.key); };
  const clear = (): void => input.clear();
  const hide = (): void => { if (visibility.hidden) clear(); };
  // Visual-only capture observes keys even when the cartridge stops propagation.
  target.addEventListener('keydown', down, true); target.addEventListener('keyup', up, true);
  target.addEventListener('blur', clear); target.addEventListener('pagehide', clear); visibility.addEventListener('visibilitychange', hide);
  return () => {
    target.removeEventListener('keydown', down, { capture: true }); target.removeEventListener('keyup', up, { capture: true });
    target.removeEventListener('blur', clear); target.removeEventListener('pagehide', clear); visibility.removeEventListener('visibilitychange', hide); clear();
  };
}

const shared = new KeyboardPressState();
let users = 0, unbind: (() => void) | undefined;
export function subscribePhysicalKeyboard(): { state: KeyboardPressState; dispose: () => void } {
  if (++users === 1) unbind = bindKeyboardFeedback(shared, window, document);
  let disposed = false;
  return { state: shared, dispose: () => { if (disposed) return; disposed = true; if (--users === 0) { unbind?.(); unbind = undefined; } } };
}
