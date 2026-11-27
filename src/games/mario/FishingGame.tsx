import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { GameCartridgeProps } from '../../types/game';
import { SAVE_KEY } from './storage';
import { FIGHT_KEYS } from './catalog';
import { FishingView, type FishingAction } from './FishingView';
import { drawFishingBay } from './renderer';
import { createFishingSession, initialView } from './session';

type Session = ReturnType<typeof createFishingSession>;

/** One mounted cartridge session. Every listener belongs to this mount. */
export function FishingGame({ isActive = true, isMuted = false, onScoreChange, onGameOver, onExit }: GameCartridgeProps) {
  const [view, setView] = useState(initialView);
  const [conflict, setConflict] = useState(false);
  const [revision, setRevision] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const settings = useRef({ isActive, isMuted, onScoreChange, onGameOver, onExit });
  const syncHost = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    settings.current = { isActive, isMuted, onScoreChange, onGameOver, onExit };
    syncHost.current?.();
  }, [isActive, isMuted, onScoreChange, onGameOver, onExit]);

  useLayoutEffect(() => {
    let stale = false;
    let mounted = true;
    const session = createFishingSession({
      getStorage: () => window.localStorage,
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: id => window.cancelAnimationFrame(id),
      show: setView,
      draw: scene => { if (canvas.current) drawFishingBay(canvas.current, scene); },
      onScore: (score, best) => settings.current.onScoreChange?.(score, best),
      onFinish: result => settings.current.onGameOver?.(result),
      onExit: () => settings.current.onExit(),
      onSaveConflict: () => {
        if (!mounted) return;
        stale = true;
        session.setActive(false);
        setConflict(true);
      },
    });
    sessionRef.current = session;
    const events = new AbortController();
    const listener = { signal: events.signal };
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let focused = document.hasFocus();
    let pagePresent = true;
    const sync = () => {
      if (focused && pagePresent) session.checkForChanges();
      const active = !stale && settings.current.isActive && focused && pagePresent && !document.hidden;
      if (!active) session.setActive(false);
      session.setMuted(settings.current.isMuted);
      if (active) session.setActive(true);
    };
    syncHost.current = sync;
    window.addEventListener('storage', event => {
      if (event.key === SAVE_KEY || event.key === null) session.checkForChanges();
    }, listener);
    const visibility = () => { focused = document.hasFocus(); sync(); };
    window.addEventListener('focus', () => { focused = true; sync(); }, listener);
    window.addEventListener('blur', () => { focused = false; sync(); }, listener);
    document.addEventListener('visibilitychange', visibility, listener);
    window.addEventListener('pagehide', () => { pagePresent = false; sync(); session.checkpoint(); }, listener);
    window.addEventListener('pageshow', () => { pagePresent = true; visibility(); }, listener);
    motion.addEventListener('change', () => session.setReducedMotion(motion.matches), listener);

    function keys(event: KeyboardEvent) {
      if (!session.active || event.defaultPrevented || event.isComposing) return;
      const down = event.type === 'keydown';
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest('button, select, input, textarea, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"]');
      if (event.code === 'Escape') {
        if (!down) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          const closePopup = root.current?.querySelector<HTMLButtonElement>('[data-shop-popup]:not([hidden]) [data-popup-close]');
          if (closePopup) {
            closePopup.click();
            return;
          }
          const closeCatch = root.current?.querySelector<HTMLButtonElement>('[data-focus=catch-close]');
          if (closeCatch) {
            closeCatch.click();
            return;
          }
          switch (session.screen) {
            case 'career': case 'bait': case 'guide': session.dispatch({ type: 'close-overlay' }, event.isTrusted); break;
            case 'tackle': case 'market': session.dispatch({ type: 'dock' }, event.isTrusted); break;
            case 'dock': case 'journal': session.dispatch({ type: 'boat' }, event.isTrusted); break;
            case 'boat': session.dispatch({ type: 'pause' }, event.isTrusted); break;
            case 'paused': session.dispatch({ type: 'resume' }, event.isTrusted); break;
            case 'settled': session.dispatch({ type: 'home' }, event.isTrusted); break;
          }
        }
      } else if (session.screen === 'boat' && !event.altKey && !event.ctrlKey && !event.metaKey && /^Key[A-Z]$/.test(event.code)) {
        const key = event.code[3];
        const prompt = session.fighting && FIGHT_KEYS.includes(key);
        const tap = !session.fighting && (key === 'F' || key === 'J');
        if ((!tap && !prompt) || (control && (!root.current?.contains(control) || control.tagName !== 'BUTTON'))) return;
        event.preventDefault();
        event.stopPropagation();
        if (down && !event.repeat) session.dispatch(prompt ? { type: 'fight', key } : { type: 'tap' }, event.isTrusted);
      } else if (event.code === 'Space' || event.code.startsWith('Arrow')) {
        if (control) {
          // Preserve native activation/selection in the game, and ignore external controls.
          if (root.current?.contains(control)) event.stopPropagation();
          return;
        }
        const region = target?.closest<HTMLElement>('[data-game-scroll]');
        if (event.code !== 'Space' && region && root.current?.contains(region)) {
          event.preventDefault();
          event.stopPropagation();
          if (down) {
            const x = event.code === 'ArrowRight' ? 40 : event.code === 'ArrowLeft' ? -40 : 0;
            const y = event.code === 'ArrowDown' ? 40 : event.code === 'ArrowUp' ? -40 : 0;
            region.scrollBy(x, y);
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (down && event.code === 'Space' && !event.repeat && session.screen === 'boat') session.dispatch({ type: 'tap' }, event.isTrusted);
      }
    }
    window.addEventListener('keydown', keys, { ...listener, capture: true });
    window.addEventListener('keyup', keys, { ...listener, capture: true });
    session.setReducedMotion(motion.matches);
    sync();
    return () => {
      mounted = false;
      events.abort();
      syncHost.current = null;
      sessionRef.current = null;
      session.dispose();
    };
  }, [revision]);

  const send = useCallback((action: FishingAction, gesture?: boolean) => sessionRef.current?.dispatch(action, gesture), []);
  const setCanvas = useCallback((element: HTMLCanvasElement | null) => { canvas.current = element; }, []);
  const dockImageSettled = useCallback(() => sessionRef.current?.setDockImageReady(), []);
  return (
    <div className="tf-game" ref={root} onClickCapture={event => {
      if (event.target instanceof Element && event.target.closest('[data-ui-sound]')) {
        sessionRef.current?.interfaceSound(event.isTrusted);
      }
    }}>
      {conflict ? <section className="tf-view tf-save-conflict" role="alert">
        <p>另一页已更新钓鱼存档。载入最新进度后即可继续。</p>
        <button type="button" className="tf-button" disabled={!isActive} onClick={() => {
          setConflict(false);
          setRevision(value => value + 1);
        }}>载入最新进度</button>
      </section> : <FishingView snapshot={view.snapshot} scene={view.scene} isActive={view.active} onAction={send} canvasRef={setCanvas} onDockImageSettled={dockImageSettled} />}
    </div>
  );
}

export default FishingGame;
