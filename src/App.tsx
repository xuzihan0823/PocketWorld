import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MusicDisc } from './types/interactable';
import type { GameId } from './types/game';
import type { WorldFeatureAdapters } from './types/world';
import { PRESET_MUSIC_DISCS, generateDiscColorsFromName, roomAudio } from './scene/audioEngine';
import { RACK_FULL_MESSAGE, RACK_SLOT_COUNT, validateMusicImport } from './scene/orbital/media/record-motion';
import { OrbitalScene } from './scene/orbital/OrbitalScene';
import { useLibrary } from './scene/orbital/library/useLibrary';
import { LibrarySurface } from './scene/orbital/library/LibrarySurface';
import { useWorldController } from './scene/orbital/useWorldController';
import { WardrobeSurface } from './scene/orbital/wardrobe/WardrobeSurface';
import { readOutfit } from './scene/orbital/wardrobe/outfit';
import { DustPrompt } from './scene/orbital/OrbitalDustPrompt';
import type { PromptEntry } from './scene/orbital/dustPromptEngine';
import { readInitialViewMode, type SpacecraftViewMode } from './scene/orbital/spacecraftFlight';
import wordmark from '../assets/brand/pocketworld-wordmark.webp';
import './scene/orbital/orbital.css';

const BACK_HINT = { label: '返回', keys: ['Esc'] };
const PAGE_TURN_HINT = { label: '翻页', keys: ['←', '→'] };
const CHANGE_VIEW_HINT = { label: '切换视角', keys: ['V'] };
const FOCUS_GUIDES: Record<string, readonly PromptEntry[] | undefined> = {
  journal: [{ label: '点击书页书写' }, PAGE_TURN_HINT, { label: '自动保存' }, BACK_HINT],
  schedule: [PAGE_TURN_HINT, { label: '撕下这页', keys: ['X'] }, CHANGE_VIEW_HINT, BACK_HINT],
  'schedule-glass': [{ label: '浏览', keys: ['←', '→'] }, CHANGE_VIEW_HINT, BACK_HINT],
  clock: [{ label: '设定闹钟或倒计时' }, { label: '试听经典版与特供版铃声' }, BACK_HINT],
};
const FOCUSED_OBJECT_GUIDE = [{ label: '操作物品继续探索' }, { label: '双指轻触退回' }, BACK_HINT];
const ORBIT_GUIDE = [
  { label: '长按加速绕地', keys: ['Space'] },
  { label: '点击飞船或按键进入舱室', keys: ['E'] },
];

export const App: React.FC<{ adapters?: WorldFeatureAdapters }> = ({ adapters }) => {
  const baseWorld = useWorldController(adapters);
  const audio = useSyncExternalStore(roomAudio.subscribe, roomAudio.getSnapshot);
  const [viewMode, setViewMode] = useState<SpacecraftViewMode>(() =>
    readInitialViewMode(typeof window !== 'undefined' ? window.location.search : '', baseWorld.reducedMotion),
  );
  const [boosting, setBoosting] = useState(false);
  const [discs, setDiscs] = useState<MusicDisc[]>(PRESET_MUSIC_DISCS);
  const discCountRef = useRef(discs.length);
  discCountRef.current = discs.length;
  const isRackFull = discs.length >= RACK_SLOT_COUNT;
  const [activeGame, setActiveGame] = useState<GameId | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const ownedUrls = useRef<string[]>([]);
  const enteredFromUrl = useRef(false);
  const inputDepth = useRef(0);
  const hintTimer = useRef<number>();
  const onFeatureError = useCallback((message: string) => {
    setAnnouncement(message);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setAnnouncement(''), 5500);
  }, []);
  const library = useLibrary({ sceneId: baseWorld.sceneId, reducedMotion: baseWorld.reducedMotion, onAction: baseWorld.onAction, onReturn: baseWorld.onReturn, error: onFeatureError });
  const world = { ...baseWorld, library, onAction: library.dispatch, onReturn: () => { if (library.flow.current.phase !== 'idle') library.back(); else baseWorld.onReturn(); } };
  const books = library.data.books.map(book => ({ id: book.id, title: book.title, author: book.author, pages: [book.text] }));
  const enterCabin = useCallback(() => {
    void roomAudio.unlock();
    setBoosting(false);
    setViewMode(current => (current === 'orbit' || current === 'approach' ? 'entering-cabin' : current));
  }, []);
  const leaveCabin = useCallback(() => {
    if (world.focusedObject || activeGame || library.flow.current.phase !== 'idle') return;
    void roomAudio.unlock();
    setBoosting(false);
    world.onHover(null);
    setViewMode(current => (current === 'cabin' ? 'leaving-cabin' : current));
  }, [world.focusedObject, world.onHover, activeGame, library.flow]);
  const activateBoost = useCallback((active: boolean) => {
    if (active) {
      void roomAudio.unlock();
      setViewMode(current => (current === 'approach' ? 'orbit' : current));
    }
    setBoosting(active);
  }, []);
  useEffect(() => {
    if (enteredFromUrl.current || new URLSearchParams(window.location.search).get('game') !== 'ski') return;
    // Wait for the final StrictMode mount before starting the computer transaction.
    const timer = window.setTimeout(() => {
      enteredFromUrl.current = true;
      setActiveGame('mario');
      void world.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [world.onAction]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editable = event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable);
      if (editable || (event.target instanceof HTMLElement && event.target.closest?.('.cat-interaction[open]'))) return;
      if (viewMode === 'approach' || viewMode === 'orbit') {
        if (event.code === 'Space' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
          event.preventDefault();
          activateBoost(true);
          return;
        }
        if (event.code === 'KeyE' || event.code === 'Enter') {
          event.preventDefault();
          enterCabin();
          return;
        }
        if (event.code === 'KeyM') {
          event.preventDefault();
          roomAudio.setMuted(!roomAudio.getSnapshot().isMuted);
          return;
        }
        return;
      }
      if (viewMode === 'entering-cabin' || viewMode === 'leaving-cabin') return;
      if (event.code === 'Escape') {
        if (activeGame && world.focusedObject === 'computer') return;
        event.preventDefault();
        (document.activeElement as HTMLElement)?.blur?.();
        world.onReturn();
      }
      if (activeGame || library.flow.current.phase !== 'idle') return;
      if (event.code === 'KeyM') { event.preventDefault(); roomAudio.setMuted(!roomAudio.getSnapshot().isMuted); }
      if (event.code === 'KeyF' && !world.focusedObject) { event.preventDefault(); leaveCabin(); }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') setBoosting(false);
    };
    const clearBoost = () => setBoosting(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clearBoost);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clearBoost);
    };
  }, [viewMode, world.onReturn, world.onAction, world.sceneId, world.focusedObject, activeGame, activateBoost, enterCabin, leaveCabin, library.flow]);
  useEffect(() => () => {
    window.clearTimeout(hintTimer.current);
    roomAudio.stopMusic();
    ownedUrls.current.forEach(url => URL.revokeObjectURL(url));
    ownedUrls.current = [];
  }, []);

  const onImportMusic = useCallback(() => {
    if (discCountRef.current >= RACK_SLOT_COUNT) {
      onFeatureError(RACK_FULL_MESSAGE);
      return;
    }
    void roomAudio.unlock();
    fileInput.current?.click();
  }, [onFeatureError]);
  const importFiles = useCallback((files: FileList | null) => {
    if (world.focusedObject !== 'music-player' || library.flow.current.phase !== 'idle') return;
    const file = files?.[0];
    if (!file) return;
    const error = validateMusicImport(file, discCountRef.current);
    if (error) {
      onFeatureError(error);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    const title = file.name.replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(file);
    ownedUrls.current.push(url);
    const nextCount = discCountRef.current + 1;
    discCountRef.current = nextCount;
    const disc: MusicDisc = { id: `local-${Date.now()}-${ownedUrls.current.length}`, title, artist: '私人唱片收藏', audioUrl: url, discThemeColor: generateDiscColorsFromName(title), isUserUploaded: true };
    setDiscs(current => (current.length >= RACK_SLOT_COUNT ? current : [disc, ...current]));
    roomAudio.prepareMusic(disc);
    onFeatureError(`《${title}》已放进唱片架（${nextCount}/${RACK_SLOT_COUNT}）`);
    if (fileInput.current) fileInput.current.value = '';
  }, [world.focusedObject, library.flow, onFeatureError]);
  const onSelectDisc = useCallback((disc: MusicDisc) => { void roomAudio.startMusic(disc); }, []);
  const onToggleMusic = useCallback(() => {
    const current = roomAudio.getSnapshot();
    if (current.isPlaying) roomAudio.pauseMusic();
    else if (current.status === 'paused') void roomAudio.resumeMusic();
    else void roomAudio.startMusic(current.disc);
  }, []);
  const onToggleMute = useCallback(() => { roomAudio.setMuted(!roomAudio.getSnapshot().isMuted); }, []);
  const focusGuide = world.focusedObject && FOCUS_GUIDES[world.focusedObject];
  const orbitGuide = viewMode === 'approach' ? '宇宙很大。这里，刚刚好。'
    : viewMode === 'orbit' ? (boosting ? '推进加速中 · 绕地巡航与时间加速' : ORBIT_GUIDE)
    : '';
  const status = viewMode !== 'cabin'
    ? orbitGuide
    : (announcement || world.error || audio.error || focusGuide || world.hover?.hint || (world.focusedObject ? FOCUSED_OBJECT_GUIDE : ''));
  const showFlightControls = !world.focusedObject && !activeGame && library.flow.current.phase === 'idle' && (viewMode === 'orbit' || viewMode === 'approach' || viewMode === 'cabin');
  return <main className={`orbital-app${draggingFile ? ' is-importing' : ''}${world.focusedObject ? ' is-focused' : ''}${viewMode !== 'cabin' ? ' is-orbit' : ''}`} aria-label="PocketWorld 轨道居住舱"
    onDragEnter={event => { if (viewMode !== 'cabin' || world.focusedObject !== 'music-player' || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); inputDepth.current += 1; setDraggingFile(true); }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={event => { event.preventDefault(); inputDepth.current = Math.max(0, inputDepth.current - 1); if (!inputDepth.current) setDraggingFile(false); }}
    onDrop={event => { event.preventDefault(); inputDepth.current = 0; setDraggingFile(false); importFiles(event.dataTransfer.files); }}>
    <OrbitalScene {...world} viewMode={viewMode} boosting={boosting} onViewModeChange={setViewMode} onEnterCabin={enterCabin}
      onLeaveCabin={showFlightControls && viewMode === 'cabin' ? leaveCabin : undefined}
      books={books} adapters={adapters} onImportMusic={onImportMusic} discs={discs} activeDisc={audio.disc} isMusicPlaying={audio.isPlaying} isMuted={audio.isMuted}
      onSelectDisc={onSelectDisc} onToggleMusic={onToggleMusic} onToggleMute={onToggleMute} activeGame={activeGame} onGameChange={setActiveGame} onFeatureError={onFeatureError} />
    {viewMode === 'cabin' && world.focusedObject === 'wardrobe' && <WardrobeSurface
      current={readOutfit(world.objects.wardrobe?.itemId)} transition={world.transition} error={world.error}
      onChoose={itemId => world.onAction({ sceneId: 'habitat', objectId: 'wardrobe', kind: 'select', payload: { itemId } })}
      onCancel={world.onReturn} />}
    <LibrarySurface library={library} />
    <header className="orbital-header">
      <div className="orbital-wordmark"><span className="orbital-emblem" aria-hidden="true" /><img src={wordmark} alt="pocketworld" width={800} height={171} /></div>
    </header>
    {world.focusedObject !== 'wardrobe' && <DustPrompt text={status} reducedMotion={world.reducedMotion} />}
    {showFlightControls && viewMode !== 'cabin' && <nav className="orbital-flight-bar" aria-label="飞船巡航控制">
      <button
        type="button"
        className={`orbital-flight-pill${boosting ? ' is-boosting' : ''}`}
        onPointerDown={event => { event.preventDefault(); activateBoost(true); }}
        onPointerUp={() => activateBoost(false)}
        onPointerLeave={() => activateBoost(false)}
        onPointerCancel={() => activateBoost(false)}
        aria-pressed={boosting}
        aria-keyshortcuts="Space"
      >{boosting ? '加速巡航中' : '长按加速'}<kbd className="orbital-keycap" aria-hidden="true">Space</kbd></button>
      <button type="button" className="orbital-flight-pill" aria-keyshortcuts="E Enter" onClick={enterCabin}>
        进入舱室<kbd className="orbital-keycap" aria-hidden="true">E</kbd>
      </button>
    </nav>}
    {audio.isPlaying && <aside className="orbital-now-playing"><span className="orbital-record-dot" /><div><small>NOW PLAYING</small><p>{audio.disc.title}</p></div></aside>}
    {draggingFile && <div className="orbital-drop-message"><span className="orbital-drop-disc" />{isRackFull
      ? <><p>唱片架已满（{discs.length}/{RACK_SLOT_COUNT}）</p><small>所有 {RACK_SLOT_COUNT} 个卡槽均已放入唱片</small></>
      : <><p>让这段音乐，留在这里。</p><small>松手制作一张自己的唱片（还可放 {RACK_SLOT_COUNT - discs.length} 张）</small></>}</div>}
    <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac" hidden onChange={event => importFiles(event.target.files)} />
    <span className="sr-only">键盘：舱外视角长按空格或 Shift 加速绕地飞行与时间流逝，E 或回车进入舱室；舱内 F 返回舱外视角，WASD 行走，R 快速上下楼，E、Q、T 依次与身边最近的物品互动，M 静音，Esc 返回。</span>
  </main>;
};
