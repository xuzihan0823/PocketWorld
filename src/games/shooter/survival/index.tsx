import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as PointerInput } from 'react';
import type { GameCartridgeProps } from '../../../types/game';
import { ShooterAudio } from '../audio';
import { advance, chooseUpgrade, createRun, dash, DURATION, H, W, UPGRADES, switchVariant, upgradeRank, rerollUpgrades } from './engine';
import { SPECIALS, PROFESSIONS, CLASS_LINKS, classLinkActive } from './professions';
import { TRAITS, synergies } from './traits';
import { WEAPONS } from './weapons';
import type { WeaponId } from './weapons';
import { armamentOf, variantsFor } from './arsenal';
import type { VariantId } from './arsenal';
import WeaponGlyph from './WeaponGlyph';
import UpgradeIcon from './UpgradeIcon';
import type { Run, UpgradeId, Vec } from './engine';
import { render } from './render';
import { drawMinimap, MINIMAP_SIZE } from './minimap';
import poster from '../../../../assets/games/shooter/standby-poster.jpg';
import portraits from '../../../../assets/games/shooter/role-portraits.jpg';
import './style.css';

type Screen = 'playing' | 'paused' | 'upgrade' | 'victory' | 'defeat' | 'history' | 'armory';
type RecordEntry = { score: number; victory: boolean; date: string; time?: number; level?: number };
const HIGH = 'pocketworld:shooter:highscore', HISTORY = 'pocketworld:shooter:history';
function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } }
function records(): RecordEntry[] {
  try { const data: unknown = JSON.parse(read(HISTORY) ?? '[]'); return Array.isArray(data) ? data.filter((e): e is RecordEntry => typeof e === 'object' && e !== null && Number.isFinite(e.score) && e.score >= 0 && typeof e.victory === 'boolean' && typeof e.date === 'string').slice(0, 10) : []; } catch { return []; }
}
const timeText = (t: number): string => `${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
const snapshot = (r: Run) => ({ hp: r.hp, maxHp: r.maxHp, time: r.time, level: r.level, xp: r.xp, need: r.need, kills: r.kills, score: r.score, dashCd: r.dashCd, weapon: r.weapon, variant: r.variant, weaponNotice:r.weaponNotice, profession: r.profession, wave: r.wave, rerolls: r.rerolls, specials: { ...r.specials }, enchants: { ...r.enchants[r.weapon] }, upgrades: { ...r.upgrades } });

export default function ShooterGame({ width = W, height = H, isActive = true, isMuted = false, onScoreChange, onGameOver, onExit }: GameCartridgeProps): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const game = useRef<Run>(createRun()), audio = useRef<ShooterAudio>(new ShooterAudio());
  const screenRef = useRef<Screen>('armory'), keys = useRef(new Set<string>()), joystick = useRef<Vec>({ x: 0, y: 0 });
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const props = useRef({ isActive, isMuted, onScoreChange, onGameOver, onExit }); props.current = { isActive, isMuted, onScoreChange, onGameOver, onExit };
  const storedBest = Number(read(HIGH));
  const best = useRef(Number.isFinite(storedBest) ? Math.max(0, storedBest) : 0), scoreSent = useRef(-1), ended = useRef(false), initialBest = useRef(best.current);
  const [screen, setScreen] = useState<Screen>('armory'), [hud, setHud] = useState(() => snapshot(game.current));
  const [bestScore, setBestScore] = useState(best.current), [history, setHistory] = useState(records);
  const [quiet, setQuiet] = useState(false), quietRef = useRef(false);
  const [selectedWeapon, setSelectedWeapon] = useState<WeaponId>('pistol'), selectedRef = useRef<WeaponId>('pistol');
  const [selectedVariant,setSelectedVariant]=useState<VariantId>('hex'), variantRef=useRef<VariantId>('hex');
  const pixelRatio=typeof window==='undefined'?1:Math.min(2,window.devicePixelRatio||1);
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);

  const clearPointer = useCallback(() => {
    joystick.current = { x: 0, y: 0 }; setStick(null);
    const id = pointer.current?.id; pointer.current = null;
    if (id !== undefined && canvas.current?.hasPointerCapture(id)) canvas.current.releasePointerCapture(id);
  }, []);
  const clearInput = useCallback(() => { keys.current.clear(); clearPointer(); }, [clearPointer]);
  const view = useCallback((s: Screen) => {
    clearInput(); screenRef.current = s; setScreen(s);
    audio.current.configure(s === 'playing' && props.current.isActive, props.current.isMuted || quietRef.current);
  }, [clearInput]);
  const publish = useCallback(() => {
    const r = game.current;
    if (r.score > best.current) { best.current = r.score; save(HIGH, String(r.score)); setBestScore(r.score); }
    if (scoreSent.current !== r.score) { scoreSent.current = r.score; props.current.onScoreChange?.(r.score, best.current); }
  }, []);
  const start = useCallback(() => {
    if (!props.current.isActive) return;
    game.current = createRun(Math.random, selectedRef.current,variantRef.current); ended.current = false; scoreSent.current = -1; initialBest.current = best.current;
    setHud(snapshot(game.current)); audio.current.startTrack(); view('playing'); publish(); audio.current.unlock();
  }, [publish, view]);
  const pause = useCallback(() => {
    if (!props.current.isActive) return;
    if (screenRef.current === 'playing') view('paused');
    else if (screenRef.current === 'paused') { view('playing'); audio.current.unlock(); }
  }, [view]);
  const move = useCallback((): Vec => ({
    x: Number(keys.current.has('d') || keys.current.has('arrowright')) - Number(keys.current.has('a') || keys.current.has('arrowleft')) + joystick.current.x,
    y: Number(keys.current.has('s') || keys.current.has('arrowdown')) - Number(keys.current.has('w') || keys.current.has('arrowup')) + joystick.current.y,
  }), []);
  const doDash = useCallback(() => { if (props.current.isActive && screenRef.current === 'playing') { dash(game.current, move()); audio.current.unlock(); } }, [move]);
  const choose = useCallback((id: UpgradeId) => {
    if (props.current.isActive && screenRef.current === 'upgrade' && chooseUpgrade(game.current, id)) { setHud(snapshot(game.current)); view('playing'); audio.current.unlock(); }
  }, [view]);
  const reroll = useCallback(() => { if (props.current.isActive && rerollUpgrades(game.current)) setHud(snapshot(game.current)); }, []);
  const selectProfession = useCallback((id: WeaponId) => {
    if (!props.current.isActive || screenRef.current !== 'armory') return;
    selectedRef.current = id; setSelectedWeapon(id); game.current = createRun(Math.random,id);
    variantRef.current=game.current.variant; setSelectedVariant(game.current.variant);
  }, []);
  const equipVariant=useCallback((id?:VariantId)=>{
    if(!props.current.isActive)return;
    if(screenRef.current==='playing'){if(switchVariant(game.current,id))setHud(snapshot(game.current));}
    else if(id&&screenRef.current==='armory'&&armamentOf(id).family===selectedRef.current){variantRef.current=id;setSelectedVariant(id);game.current.variant=id;}
  },[]);
  const home = useCallback(() => { if (props.current.isActive) { game.current = createRun(Math.random, selectedRef.current,variantRef.current); view('armory'); } }, [view]);
  const finish = useCallback(() => {
    if (ended.current) return; ended.current = true;
    const r = game.current; publish();
    const victory = r.phase === 'victory';
    const list = [{ score: r.score, victory, date: new Date().toISOString(), time: r.time, level: r.level }, ...records()].slice(0, 10);
    save(HISTORY, JSON.stringify(list)); setHistory(list); setHud(snapshot(r)); view(victory ? 'victory' : 'defeat');
    props.current.onGameOver?.({ score: r.score, highScore: best.current, victory });
  }, [publish, view]);

  useEffect(() => {
    if (!isActive) { clearInput(); if (screenRef.current === 'playing') view('paused'); }
    audio.current.configure(isActive && screenRef.current === 'playing', isMuted || quiet);
  }, [isActive, isMuted, quiet, clearInput, view]);
  useEffect(() => () => audio.current.dispose(), []);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const radar = minimap.current?.getContext('2d');
    if (radar) drawMinimap(radar, game.current);
    render(ctx, game.current, screen === 'history' || screen === 'armory');
    if (!isActive || screen !== 'playing') return;
    let frame = 0, previous = performance.now(), uiTime = 0, live = true;
    const loop = (now: number): void => {
      if (!live || !props.current.isActive) return;
      const dt = Math.min(.05, (now - previous) / 1000); previous = now;
      if (screenRef.current === 'playing') {
        const r = game.current; advance(r, dt, move());
        const events = new Set(r.sounds.splice(0));
        for (const event of ['launch', 'blast', 'hit', 'critical', 'switch', 'dash', 'wave', 'impact', 'destroy', 'pickup'] as const) {
          if (events.has(event)) audio.current.play(event, r.variant);
        }
        audio.current.tick();
        render(ctx, r);
        if (r.phase === 'upgrade') { setHud(snapshot(r)); publish(); view('upgrade'); return; }
        if (r.phase === 'victory' || r.phase === 'defeat') { finish(); return; }
        if (now - uiTime > 100) {
          uiTime = now;
          if (radar) drawMinimap(radar, r);
          setHud(snapshot(r));
          publish();
        }
      } else return;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { live = false; cancelAnimationFrame(frame); };
  }, [screen, isActive, width, height, selectedVariant, selectedWeapon, finish, move, publish, view]);
  useEffect(() => {
    if (!isActive) return;
    const handled = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'escape', 'p', 'enter', '1', '2', '3']);
    const buttonActivation = (e: KeyboardEvent, k: string): boolean => (k === 'enter' || k === ' ') && e.target instanceof HTMLElement && e.target.tagName === 'BUTTON';
    const down = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase(); if (!handled.has(k) || !props.current.isActive) return;
      // Let focused buttons activate normally, including the outer display controls.
      if (buttonActivation(e, k)) return;
      e.preventDefault(); e.stopPropagation();
      if (screenRef.current === 'playing') keys.current.add(k);
      if (e.repeat) return;
      if (k === 'escape' && screenRef.current === 'armory') props.current.onExit();
      else if (k === 'escape' && screenRef.current === 'history') home();
      else if (k === 'escape' || k === 'p') pause();
      else if (screenRef.current === 'armory' && k === 'enter') start();
      else if (screenRef.current === 'playing' && k === ' ') doDash();
      else if (screenRef.current === 'playing' && (k === 'q' || k === 'r')) equipVariant();
      else if (screenRef.current === 'playing' && k === 'e') { const list=variantsFor(game.current.profession);equipVariant(list[(list.findIndex(a=>a.id===game.current.variant)+2)%3].id); }
      else if (screenRef.current === 'playing' && ['1','2','3'].includes(k)) equipVariant(variantsFor(game.current.profession)[Number(k)-1].id);
      else if (screenRef.current === 'upgrade' && k === 'r') reroll();
      else if (screenRef.current === 'upgrade' && ['1', '2', '3'].includes(k)) { const u = game.current.choices[Number(k) - 1]; if (u) choose(u.id); }
    };
    const up = (e: KeyboardEvent): void => { const k = e.key.toLowerCase(); if (handled.has(k)) { keys.current.delete(k); if (buttonActivation(e, k)) return; e.preventDefault(); e.stopPropagation(); } };
    const blur = (): void => { clearInput(); if (screenRef.current === 'playing') view('paused'); };
    const visibility = (): void => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); clearInput(); };
  }, [isActive, clearInput, view, choose, doDash, pause, equipVariant, start, reroll, home]);

  const point = (e: PointerInput<HTMLCanvasElement>): Vec => { const box = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - box.left) / box.width * W, y: (e.clientY - box.top) / box.height * H }; };
  const pointerDown = (e: PointerInput<HTMLCanvasElement>): void => {
    if (!isActive || screen !== 'playing' || pointer.current || e.button !== 0) return;
    e.preventDefault(); const p = point(e); pointer.current = { id: e.pointerId, ...p }; e.currentTarget.setPointerCapture(e.pointerId); setStick({ ...p, dx: 0, dy: 0 }); audio.current.unlock();
  };
  const pointerMove = (e: PointerInput<HTMLCanvasElement>): void => {
    const origin = pointer.current; if (!origin || origin.id !== e.pointerId) return;
    const p = point(e), dx = p.x - origin.x, dy = p.y - origin.y, d = Math.max(36, Math.hypot(dx, dy));
    joystick.current = { x: dx / d, y: dy / d }; setStick({ x: origin.x, y: origin.y, dx: dx / d * 26, dy: dy / d * 26 });
  };
  const pointerEnd = (e: PointerInput<HTMLCanvasElement>): void => { if (pointer.current?.id === e.pointerId) clearPointer(); };
  const toggleSound = (): void => { const next = !quiet; quietRef.current = next; setQuiet(next); audio.current.configure(screenRef.current === 'playing' && isActive, isMuted || next); if (!next) audio.current.unlock(); };
  const activeSkills = UPGRADES.filter(u => hud.upgrades[u.id] > 0);
  const profession = PROFESSIONS[hud.profession];
  const portraitPosition = (WEAPONS.findIndex(w => w.id === hud.profession) * 25) + '%';
  const link = CLASS_LINKS[hud.profession];
  const linked = classLinkActive(hud.profession, hud.specials);
  const combinations = synergies(hud.enchants);
  if (linked) combinations.push(link.name);
  const linkCards = SPECIALS.filter(card => link.cards.includes(card.id));
  const ownedLinkCards = linkCards.filter(card => hud.specials[card.id] > 0).length;
  const missingLinkCard = ownedLinkCards === 1 ? linkCards.find(card => hud.specials[card.id] === 0) : undefined;
  const canCompleteLink = game.current.choices.some(card => card.id === missingLinkCard?.id);
  return <div ref={container} className="sprout-cartridge" data-game-screen={screen} style={{ '--class-color': profession.color, '--portrait-position': portraitPosition, aspectRatio: `${width}/${height}`, '--poster': `url("${poster}")`, '--portraits': `url("${portraits}")` } as CSSProperties} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <canvas ref={canvas} width={Math.round(width*pixelRatio)} height={Math.round(height*pixelRatio)} aria-label="团团魔法录游戏场景，WASD 移动，空格冲刺" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} />
    {screen !== 'history' && screen !== 'armory' && <>
      <div className="sg-hud">
        <div className="sg-vitals" data-low={hud.hp <= hud.maxHp * .3}>
          <span className="sg-hud-portrait" aria-hidden="true" />
          <div className="sg-hud-life">
            <div className="sg-hud-name"><strong>{profession.shortName}</strong><b>Lv.{hud.level}</b></div>
            <div className="sg-health" role="progressbar" aria-label="生命" aria-valuemin={0} aria-valuemax={hud.maxHp} aria-valuenow={Math.ceil(hud.hp)}>
              <i style={{ width: (hud.hp / hud.maxHp * 100) + '%' }} />
              <span><span aria-hidden="true">♥</span> {Math.ceil(hud.hp)}/{hud.maxHp}</span>
            </div>
          </div>
        </div>
        <div className="sg-clock">
          <span className="sg-clock-moon" aria-hidden="true" />
          <div><strong>{timeText(Math.max(0, DURATION - hud.time))}</strong>
            <span>第 {hud.wave} 波 <span className="sg-clock-score">· {hud.score.toLocaleString()} 分</span></span>
          </div>
        </div>
        <div className="sg-hud-tools">
          <canvas ref={minimap} className="sg-minimap" width={MINIMAP_SIZE} height={MINIMAP_SIZE} role="img"
            aria-label="小地图：中央浅金菱形是自己，灰粉圆点是敌人，双环是首领" />
          <button className="sg-hud-pause" onClick={pause} disabled={!isActive || screen !== 'playing'} aria-label="暂停游戏" title="暂停 · Esc / P">
            <span className="sg-pause-mark" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="sg-weapon-bar">
        <nav className="sg-variant-bar" aria-label="切换本职业武器">
          {variantsFor(hud.profession).map((armament, index) => <button key={armament.id}
            aria-label={(index + 1) + ' · ' + armament.name} aria-pressed={hud.variant === armament.id}
            disabled={!isActive || screen !== 'playing'} onClick={event => {
              if (event.detail > 0) event.currentTarget.blur();
              equipVariant(armament.id);
            }}
            title={armament.name + '：' + armament.description}>
            <kbd>{index + 1}</kbd><WeaponGlyph id={armament.family} variant={armament.id} /><span>{armament.name}</span>
          </button>)}
        </nav>
      </div>
      {screen === 'playing' && hud.weaponNotice > 0 && <div key={hud.variant} className="sg-weapon-notice"
        style={{ opacity: Math.min(1, hud.weaponNotice * 3) }} role="status">{armamentOf(hud.variant).name}</div>}
      <div className="sg-bottom">
        <div className="sg-xp" role="progressbar" aria-label={'等级 ' + hud.level + ' 经验'} aria-valuemin={0} aria-valuemax={hud.need} aria-valuenow={hud.xp}>
          <i style={{ width: Math.min(100, hud.xp / hud.need * 100) + '%' }} />
        </div>
      </div>
      <button className="sg-dash" onClick={doDash} data-cooling={hud.dashCd > 0}
        disabled={screen !== 'playing' || !isActive || hud.dashCd > 0}
        aria-label={hud.dashCd > 0 ? '冲刺冷却中' : '冲刺'} title="冲刺 · 空格">
        <b aria-hidden="true">{hud.dashCd > 0 ? hud.dashCd.toFixed(1) : '↗'}</b><span>冲刺</span>
      </button>
    </>}
    {stick && screen === 'playing' && <div className="sg-stick" style={{ left: `${stick.x / 8}%`, top: `${stick.y / 6}%` }}><i style={{ transform: `translate(${stick.dx / 8}cqw, ${stick.dy / 8}cqw)` }} /></div>}
    {screen === 'armory' && <section className="sg-armory" aria-label="选择角色与开局武器">
      <header className="sg-selection-heading"><div><span className="sg-eyebrow">团团魔法录 · 月夜出征</span><h1>选择你的团团<span>✦</span></h1></div><button className="sg-icon-button" onClick={toggleSound} aria-label={quiet || isMuted ? '开启游戏声音' : '关闭游戏声音'} disabled={!isActive || isMuted}>{quiet || isMuted ? '♫ ×' : '♫'}</button></header>
      <div className="sg-weapon-cards" role="group" aria-label="选择角色">{WEAPONS.map((w, i) => <button key={w.id} onClick={() => selectProfession(w.id)} aria-label={PROFESSIONS[w.id].name} aria-pressed={selectedWeapon === w.id} className={selectedWeapon === w.id ? 'selected' : ''} style={{ '--weapon': w.color, '--portrait-position': (i * 25) + '%' } as CSSProperties} disabled={!isActive}><span className="sg-role-art" aria-hidden="true" /><span className="sg-role-number">0{i + 1}</span><strong>{PROFESSIONS[w.id].shortName}</strong><span className="sg-role-chosen" aria-hidden="true">{selectedWeapon === w.id ? '✦ 已选择' : '选择角色'}</span></button>)}</div>
      <div className="sg-profession-detail"><strong>{PROFESSIONS[selectedWeapon].name}</strong><p>{PROFESSIONS[selectedWeapon].passive.replace('职业天赋：', '')}</p></div>
      <div className="sg-loadout"><div className="sg-section-label">开局武器 <span>冒险中可随时切换</span></div><div className="sg-flow-cards" role="group" aria-label="选择开局武器流派">{variantsFor(selectedWeapon).map(a => <button key={a.id} onClick={() => equipVariant(a.id)} className={selectedVariant === a.id ? 'selected' : ''} aria-pressed={selectedVariant === a.id} disabled={!isActive}><WeaponGlyph id={a.family} variant={a.id} /><strong>{a.name}</strong></button>)}</div><p className="sg-weapon-description">{armamentOf(selectedVariant).brief}</p></div>
      <footer className="sg-selection-footer"><div><div className="sg-selection-links"><button onClick={() => isActive && view('history')} disabled={!isActive}>冒险手记</button><span>最高 {bestScore.toLocaleString()}</span><button onClick={() => { if (isActive) { clearInput(); audio.current.dispose(); props.current.onExit(); } }} disabled={!isActive}>离开电脑 ↗</button></div><p>WASD / 拖动移动 · 空格冲刺 · P 暂停</p></div><button className="sg-primary sg-start" onClick={start} disabled={!isActive}>出发冒险 <span>↗</span></button></footer>
    </section>}
    {screen === 'upgrade' && <section className="sg-levelup" aria-labelledby="sg-levelup-title">
      <header className="sg-levelup-header">
        <h2 id="sg-levelup-title"><span className="sg-awaken-star" aria-hidden="true">✦</span>月下觉醒</h2>
      </header>
      <div className="sg-levelup-cards" role="group" aria-label="选择一项秘术">
        {game.current.choices.map((card, index) => {
          const completesLink = card.id === missingLinkCard?.id;
          return <button key={card.id} className="sg-levelup-card" data-completes-link={completesLink}
            style={{ '--skill': card.color } as CSSProperties} onClick={() => choose(card.id)} disabled={!isActive}>
            <span className="sg-card-illustration"><UpgradeIcon id={card.id} /></span>
            <span className="sg-card-copy">
              <strong>{card.name}</strong>
              <span className="sg-levelup-description">{card.description}</span>
              {completesLink && <span className="sg-completes-link">激活「{link.name}」</span>}
              <span className="sg-card-bottom">Lv. {upgradeRank(game.current, card) + 1}<kbd>{index + 1}</kbd></span>
            </span>
          </button>;
        })}
      </div>
      <footer className="sg-levelup-footer">
        <div className="sg-link-details" data-linked={linked}>
          <strong>{link.name} {ownedLinkCards}/{linkCards.length}</strong>
          <span>{linked || canCompleteLink ? link.effect : linkCards.map(card => card.name).join(" ＋ ")}</span>
        </div>
        <button className="sg-reroll" onClick={reroll} disabled={!isActive || hud.rerolls <= 0}><kbd>R</kbd> 重抽 · {hud.rerolls}</button>
      </footer>
    </section>}
    {screen === 'paused' && <div className="sg-overlay"><div className="sg-modal sg-pause"><h2>已暂停</h2><p>{PROFESSIONS[hud.profession].name} · {armamentOf(hud.variant).name}<br />击退 {hud.kills} · {hud.score.toLocaleString()} 分</p><button className="sg-sound-toggle" onClick={toggleSound} disabled={!isActive || isMuted}>{quiet || isMuted ? '声音已关' : '声音已开'}</button><div className="sg-build">{activeSkills.map(u => <span key={u.id}>{u.icon} {u.name} {hud.upgrades[u.id]}</span>)}{SPECIALS.filter(s => s.weapon === hud.weapon && hud.specials[s.id] > 0).map(s => <span key={s.id}>{s.icon} {s.name} {hud.specials[s.id]}</span>)}{TRAITS.filter(t => hud.enchants[t.id] > 0).map(t => <span key={t.id}>{t.icon} {t.name} {hud.enchants[t.id]}</span>)}</div>{combinations.length > 0 && <p>{combinations.join(' · ')}</p>}<button className="sg-primary" onClick={pause} disabled={!isActive}>继续冒险 ↗</button><button className="sg-text-button" onClick={home} disabled={!isActive}>重新选择角色</button></div></div>}
    {(screen === 'victory' || screen === 'defeat') && <div className="sg-overlay"><div className="sg-modal"><div className="sg-modal-icon">{screen === 'victory' ? '✦' : '❀'}</div><h2>{screen === 'victory' ? '小小英雄，守护成功！' : '今天的团团，也很勇敢'}</h2><p>{screen === 'victory' ? '十分钟的星光，点亮了整座棉花岛。' : '带上这次的经验，下一次会走得更远。'}</p><div className="sg-result"><div><b>{hud.score.toLocaleString()}</b><span>{hud.score > initialBest.current ? '✦ 新的最高分' : '冒险得分'}</span></div><div><b>{timeText(hud.time)}</b><span>守护时间</span></div><div><b>{hud.kills}</b><span>击退魔物</span></div></div><button className="sg-primary" onClick={start} disabled={!isActive}>再冒险一次 ↗</button><button className="sg-text-button" onClick={home} disabled={!isActive}>重新选择角色</button></div></div>}
    {screen === 'history' && <div className="sg-overlay"><div className="sg-modal sg-history"><h2>团团的冒险手记</h2><p>最近十次冒险，保存在这台设备上。</p><div className="sg-history-list">{history.length ? history.map((entry, i) => <div key={`${entry.date}-${i}`}><span>{String(i + 1).padStart(2, '0')}　{entry.victory ? '守护成功' : '勇敢尝试'}</span><span>{typeof entry.time === 'number' ? timeText(entry.time) : '旧版记录'}</span><b>{entry.score.toLocaleString()} 分</b></div>) : <div className="sg-empty">还没有手记，去收集第一颗星星吧。✦</div>}</div><button className="sg-primary" onClick={home} disabled={!isActive}>返回角色选择</button></div></div>}
  </div>;
}
