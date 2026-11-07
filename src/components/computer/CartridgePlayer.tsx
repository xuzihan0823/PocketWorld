import React from 'react';
import { createPortal } from 'react-dom';
import './cartridge-player.css';

export function CartridgePlayer({ children, title, muted, onMute, onExit }: {
  children: React.ReactNode; title: string; muted: boolean; onMute: () => void; onExit: () => void;
}) {
  return createPortal(<section className="cartridge-player" role="dialog" aria-modal="true" aria-label={title} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="cartridge-player-shell">
      <header><strong>{title}</strong><div><button onClick={onMute}>{muted ? '打开声音' : '静音'}</button><button onClick={onExit}>拔出卡带</button></div></header>
      <div className="cartridge-player-screen">{children}</div>
      <footer>W / 空格 跳跃 · 长按翻转 · S 收身 · Esc 暂停</footer>
    </div>
  </section>, document.body);
}
