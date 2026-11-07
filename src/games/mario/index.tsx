import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GameCartridgeProps } from '../../types/game';
import { createRun, frontGap, stepRun } from './engine';
import { loadAssets, type SkiAssets } from './assets';
import { renderGame } from './renderer';
import { emptyInput, TRAILS, type GamePhase, type SkiInput, type TrailId } from './model';
import { SkiSound } from './sound';
import './ski.css';

const HIGH_KEY = 'pocketworld:mario:highscore';
function storedHigh() {
  try { const value = Number(localStorage.getItem(HIGH_KEY)); return Number.isFinite(value) ? Math.max(0, value) : 0; }
  catch { return 0; }
}
function snapshot(state: ReturnType<typeof createRun>) {
  return { score: state.score, distance: Math.floor(state.distance), coins: state.coins, flips: state.flips,
    combo: state.combo, gap: Math.max(0, Math.round(frontGap(state) / 10)), message: state.messageTime > 0 ? state.message : '',
    partner: state.player.partner, left: Math.ceil(state.player.partnerLeft / 10), crashed: state.player.crashTime > 0 };
}

export default function MarioGame({ isActive = true, isMuted = false, onExit, onScoreChange, onGameOver }: GameCartridgeProps) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef(createRun('valley'));
  const input = useRef<SkiInput>(emptyInput());
  const held = useRef(new Set<string>());
  const sound = useRef<SkiSound | null>(null);
  const latest = useRef({ onExit, onScoreChange, onGameOver, isActive });
  latest.current = { onExit, onScoreChange, onGameOver, isActive };
  const [phase, setPhase] = useState<GamePhase>('home');
  const phaseRef = useRef(phase);
  const [assets, setAssets] = useState<SkiAssets | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetError, setAssetError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState(1);
  const [compact, setCompact] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [localMuted, setLocalMuted] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [high, setHigh] = useState(storedHigh);
  const highRef = useRef(high);
  const startingHigh = useRef(high);
  const reported = useRef(false);
  const revealed = useRef(false);
  const [showResults, setShowResults] = useState(false);
  const [hud, setHud] = useState(() => snapshot(run.current));
  const menu = useRef<HTMLDivElement>(null);
  const muted = isMuted || localMuted;

  const clearInput = useCallback(() => { held.current.clear(); input.current = emptyInput(); }, []);
  const go = useCallback((next: GamePhase) => {
    clearInput(); phaseRef.current = next; setPhase(next);
    if (next === 'home' || next === 'select') sound.current?.stop();
  }, [clearInput]);
  const pause = useCallback(() => { if (phaseRef.current === 'playing') go('paused'); }, [go]);
  const publish = useCallback(() => {
    const score = run.current.score;
    const best = Math.max(highRef.current, score);
    if (best !== highRef.current) {
      highRef.current = best; setHigh(best);
      try { localStorage.setItem(HIGH_KEY, String(best)); } catch { /* Session records still work without storage. */ }
    }
    setHud(snapshot(run.current));
    latest.current.onScoreChange?.(score, best);
  }, []);
  const start = (trail: TrailId) => {
    if (loading || !latest.current.isActive) return;
    sound.current?.stop(); sound.current?.setPaused(false); sound.current?.unlock();
    run.current = createRun(trail); reported.current = false; startingHigh.current = highRef.current;
    revealed.current = false; setShowResults(false);
    publish(); go('playing'); container.current?.focus();
  };
  const resume = () => {
    if (!isActive || hidden) return;
    sound.current?.setPaused(false); sound.current?.unlock(); go('playing'); container.current?.focus();
  };

  useEffect(() => {
    const audio = new SkiSound(); sound.current = audio;
    return () => { audio.dispose(); sound.current = null; };
  }, []);
  useEffect(() => { sound.current?.setMuted(muted); }, [muted]);
  useEffect(() => { sound.current?.setPaused(!isActive || hidden || phase === 'paused'); }, [isActive, hidden, phase]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAssets(attempt > 0).then(value => {
      if (cancelled) return;
      setAssets(value); setAssetError(Boolean(value.errors.length)); setLoading(false);
    }).catch(() => { if (!cancelled) { setAssetError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => {
    const resize = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setScale(Math.min(width / 800, height / 600)); setCompact(width < 550);
    });
    if (container.current) resize.observe(container.current);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    const visibility = () => { setHidden(document.hidden); if (document.hidden) pause(); };
    const blur = () => { clearInput(); pause(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', blur); };
  }, [pause, clearInput]);
  useEffect(() => { if (!isActive) { pause(); clearInput(); } }, [isActive, pause, clearInput]);
  useEffect(() => {
    if (phase !== 'playing') menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [phase, loading, showResults]);

  useEffect(() => {
    if (!isActive || hidden) return;
    const jumpKeys = ['Space', 'KeyW', 'ArrowUp'];
    const keys = [...jumpKeys, 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'];
    const sync = () => {
      input.current.jump = jumpKeys.some(key => held.current.has(key)) || held.current.has('touch-jump');
      input.current.tuck = held.current.has('KeyS') || held.current.has('ArrowDown') || held.current.has('touch-tuck');
      input.current.tilt = Number(held.current.has('KeyD') || held.current.has('ArrowRight')) - Number(held.current.has('KeyA') || held.current.has('ArrowLeft'));
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) pause();
        return;
      }
      if (phaseRef.current !== 'playing' || !keys.includes(event.code)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat && jumpKeys.includes(event.code) && !input.current.jump) input.current.jumpPressed = true;
      held.current.add(event.code); sync();
    };
    const keyup = (event: KeyboardEvent) => {
      if (!keys.includes(event.code)) return;
      if (phaseRef.current === 'playing') { event.preventDefault(); event.stopImmediatePropagation(); }
      held.current.delete(event.code); sync();
    };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup, true);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); clearInput(); };
  }, [isActive, hidden, clearInput, pause]);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const draw = () => renderGame(context, run.current, assets, { phase, reducedMotion: reduced });
    draw();
    if (!isActive || hidden || phase === 'paused' || phase === 'select' || loading) return;
    let frame = 0, previous = 0, accumulator = 0, sinceHud = 0;
    const animate = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      if (phaseRef.current === 'playing') {
        accumulator += dt;
        while (accumulator >= 1 / 120) {
          stepRun(run.current, input.current, 1 / 120, reduced);
          input.current.jumpPressed = false;
          accumulator -= 1 / 120;
          for (const event of run.current.events) {
            if (event === 'flip' || event === 'crash' || event === 'caught') sound.current?.play('laugh');
            if (event === 'mount') sound.current?.play('mount');
          }
          if (run.current.over) {
            publish();
            if (!reported.current) {
              reported.current = true;
              latest.current.onGameOver?.({ score: run.current.score, highScore: highRef.current, victory: false });
            }
            go('over'); break;
          }
        }
        sinceHud += dt;
        if (sinceHud >= 0.1) { publish(); sinceHud = 0; }
      } else if (phase === 'home') run.current.time += dt;
      else if (phase === 'over') {
        run.current.caughtTime = Math.min(2, run.current.caughtTime + dt); run.current.time += dt;
        if (run.current.caughtTime >= 1.3 && !revealed.current) { revealed.current = true; setShowResults(true); }
      }
      draw();
      if (phaseRef.current === phase && !(phase === 'over' && run.current.caughtTime >= 2)) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [phase, isActive, hidden, assets, reduced, loading, publish, go]);

  const touch = (kind: 'jump' | 'tuck', down: boolean) => {
    if (phaseRef.current !== 'playing' || !isActive) return;
    const key = `touch-${kind}`;
    if (down) {
      if (kind === 'jump' && !input.current.jump) input.current.jumpPressed = true;
      held.current.add(key);
    } else held.current.delete(key);
    input.current.jump = ['touch-jump', 'Space', 'KeyW', 'ArrowUp'].some(value => held.current.has(value));
    input.current.tuck = ['touch-tuck', 'KeyS', 'ArrowDown'].some(value => held.current.has(value));
  };
  const returnHome = () => { run.current = createRun('valley'); go('home'); };
  const trail = TRAILS.find(value => value.id === run.current.trail)!;

  return <div ref={container} className={`ski-game${compact ? ' ski-compact' : ''}`} tabIndex={-1} aria-label="雪线逃脱滑雪游戏" onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
    <div className="ski-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
      <canvas ref={canvas} width={800} height={600} aria-label="奶娃在雪道滑行，后方豆包群正在追赶" />
      {phase === 'home' && <div className="ski-settings">
        <button type="button" disabled={isMuted} aria-pressed={muted} onClick={() => setLocalMuted(value => !value)}>{muted ? '声音已关' : '声音已开'}</button>
        <button type="button" aria-pressed={reduced} onClick={() => setReduced(value => !value)}>{reduced ? '轻柔动态' : '完整动态'}</button>
      </div>}
      {phase === 'home' && <div className="ski-home" ref={menu}>
        <h1>雪线逃脱</h1>
        <p className="ski-tagline">奶娃，快跑。豆包追来啦！</p>
        <p className="ski-record">本地纪录 <strong>{high.toLocaleString()}</strong></p>
        <div className="ski-home-actions"><button className="ski-primary" disabled={loading || !isActive} onClick={() => { sound.current?.unlock(); go('select'); }}>{loading ? '正在准备雪板…' : '开始游戏'}</button>
          <button className="ski-quiet" onClick={() => { sound.current?.stop(); latest.current.onExit(); }}>退出到电脑</button></div>
        <p className="ski-home-help">按住跳跃，腾空翻转<br />松手摆正，稳稳落地</p>
      </div>}
      {phase === 'select' && <div className="ski-select ski-menu-surface" ref={menu}>
        <h2>今天，滑向哪里？</h2><p>三条雪道，无尽冒险。</p>
        <div className="ski-trails">{TRAILS.map((item, index) => <button key={item.id} disabled={!isActive} className={`ski-trail ski-trail-${item.id}`} onClick={() => start(item.id)}>
          <span className="ski-trail-landscape" aria-hidden="true"><svg viewBox="0 0 150 110"><path d="M0 103 48 25 74 63 106 13 150 96V110H0Z" fill={item.mountain}/><path d="m48 25 18 28-17-7-13 12Zm58-12 22 39-20-8-12 8-7-11Z" fill={item.snow}/><path d="M0 98Q56 68 150 91V110H0Z" fill={item.snow}/></svg></span>
          <span><strong>{item.name}</strong><small>{item.subtitle}</small></span><span className="ski-route-level">{['悠闲', '进阶', '挑战'][index]}</span>
        </button>)}</div>
        <button className="ski-quiet" onClick={returnHome}>返回首页</button>
      </div>}
      {(phase === 'playing' || phase === 'paused') && <>
        <div className="ski-hud"><div className="ski-score"><strong>{hud.score.toLocaleString()}</strong><span>{hud.distance} 米 <b>·</b> {hud.coins} 金币</span></div>
          <div className={`ski-chase${hud.gap < 10 ? ' is-danger' : ''}`}><span>{hud.gap < 10 ? '豆包追上来了！' : '豆包在后方'}</span><strong>{hud.gap} 米</strong><div className="ski-gap-track"><i style={{ width: `${Math.min(100, hud.gap / 40 * 100)}%` }} /></div></div>
          <button className="ski-pause-button" disabled={phase === 'paused'} onClick={pause} aria-label="暂停游戏"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg><span>暂停</span></button>
        </div>
        <div className="ski-run-info"><span>{trail.name}</span>{hud.partner && <strong>牛来 · {hud.partner === 'slide' ? '贴地滑行' : '冲撞护航'} {hud.left} 米</strong>}{hud.combo > 1 && <strong>技巧 ×{hud.combo}</strong>}</div>
        <p className="ski-action-message" aria-live="polite">{hud.crashed ? '轻按跳跃，帮奶娃站起来！' : hud.message}</p>
      </>}
      {phase === 'playing' && <div className="ski-controls">
        <button className="ski-touch ski-tuck" onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); touch('tuck', true); }} onPointerUp={() => touch('tuck', false)} onPointerCancel={() => touch('tuck', false)} onLostPointerCapture={() => touch('tuck', false)}>收身 <small>S</small></button>
        <p>{hud.distance < 180 ? <>轻按跳跃 · 长按翻转<br />松手落地，别倒栽葱</> : <>A / D 空中微调<br />W / 空格 跳跃 · S 收身</>}</p>
        <button className="ski-touch ski-jump" onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); touch('jump', true); }} onPointerUp={() => touch('jump', false)} onPointerCancel={() => touch('jump', false)} onLostPointerCapture={() => touch('jump', false)}>{hud.crashed ? '快起身' : '跳跃'} <small>W / 空格</small></button>
      </div>}
      {phase === 'paused' && <div className="ski-shade"><div className="ski-pause ski-menu-surface" ref={menu} role="dialog" aria-label="游戏暂停" aria-modal="true"><h2>在雪地歇一会儿</h2><p>{isActive && !hidden ? '雪道和豆包，都在等你。' : '回到游戏后，点击继续。'}</p><button className="ski-primary" disabled={!isActive || hidden} onClick={resume}>继续游戏</button><button className="ski-quiet" onClick={returnHome}>返回首页</button></div></div>}
      {phase === 'over' && showResults && <div className="ski-results ski-menu-surface" ref={menu} role="dialog" aria-label="本局结算" aria-modal="true"><h2>被豆包抱走啦！</h2><p>{hud.score > startingHigh.current ? '新纪录！这一趟，滑得漂亮。' : '抖抖身上的雪，再滑一趟。'}</p><strong className="ski-final-score">{hud.score.toLocaleString()} <span>分</span></strong><dl><div><dt>滑行距离</dt><dd>{hud.distance} 米</dd></div><div><dt>收集金币</dt><dd>{hud.coins} 枚</dd></div><div><dt>落地翻转</dt><dd>{hud.flips} 次</dd></div></dl><button className="ski-primary" disabled={!isActive} onClick={() => start(run.current.trail)}>再滑一次</button><button className="ski-quiet" onClick={returnHome}>返回首页</button></div>}
      {assetError && (phase === 'home' || phase === 'select') && <div className="ski-load-note" role="status">部分角色未载入，已启用备用绘制。<button onClick={() => setAttempt(value => value + 1)} disabled={loading}>重试加载</button></div>}
    </div>
  </div>;
}
