import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MusicDisc } from './types/interactable';
import type { GameId } from './types/game';
import type { WorldAction, WorldFeatureAdapters } from './types/world';
import { PRESET_MUSIC_DISCS, generateDiscColorsFromName, roomAudio } from './scene/audioEngine';
import { OrbitalScene } from './scene/orbital/OrbitalScene';
import { useLibrary } from './scene/orbital/library/useLibrary';
import { LibrarySurface } from './scene/orbital/library/LibrarySurface';
import { useWorldController } from './scene/orbital/useWorldController';
import { DustPrompt } from './scene/orbital/OrbitalDustPrompt';
import { readInitialViewMode, type SpacecraftViewMode } from './scene/orbital/spacecraftFlight';
import {
  initialOutfit,
  nextOutfit,
  outfitErrorNotice,
  outfitLoadingNotice,
  outfitSwitchedNotice,
  rememberOutfit,
  type ResidentOutfit,
} from './scene/orbital/wardrobe/outfit';
import './scene/orbital/orbital.css';

export const App: React.FC<{ adapters?: WorldFeatureAdapters }> = ({ adapters }) => {
  const baseWorld = useWorldController(adapters);
  const audio = useSyncExternalStore(roomAudio.subscribe, roomAudio.getSnapshot);
  const [viewMode, setViewMode] = useState<SpacecraftViewMode>(() =>
    readInitialViewMode(typeof window !== 'undefined' ? window.location.search : '', baseWorld.reducedMotion),
  );
  const [outfit, setOutfit] = useState<ResidentOutfit>(() =>
    initialOutfit(typeof window !== 'undefined' ? window.location.search : ''),
  );
  const outfitRef = useRef(outfit);
  outfitRef.current = outfit;
  const pendingOutfitSwitch = useRef<ResidentOutfit | null>(null);
  const [boosting, setBoosting] = useState(false);
  const [discs, setDiscs] = useState<MusicDisc[]>(PRESET_MUSIC_DISCS);
  const [activeGame, setActiveGame] = useState<GameId | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const ownedUrls = useRef<string[]>([]);
  const initialized = useRef(false);
  const inputDepth = useRef(0);
  const hintTimer = useRef<number>();
  const onFeatureError = useCallback((message: string) => {
    setAnnouncement(message);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setAnnouncement(''), 5500);
  }, []);
  const onOutfitLoading = useCallback((next: ResidentOutfit) => {
    if (pendingOutfitSwitch.current === next) onFeatureError(outfitLoadingNotice(next));
  }, [onFeatureError]);
  const onOutfitReady = useCallback((ready: ResidentOutfit) => {
    if (pendingOutfitSwitch.current === ready) {
      pendingOutfitSwitch.current = null;
      onFeatureError(outfitSwitchedNotice(ready));
    }
  }, [onFeatureError]);
  const onOutfitError = useCallback((failed: ResidentOutfit, fallback: ResidentOutfit) => {
    pendingOutfitSwitch.current = null;
    outfitRef.current = fallback;
    setOutfit(fallback);
    rememberOutfit(fallback);
    onFeatureError(outfitErrorNotice(failed));
  }, [onFeatureError]);
  const library = useLibrary({ sceneId: baseWorld.sceneId, reducedMotion: baseWorld.reducedMotion, onAction: baseWorld.onAction, onReturn: baseWorld.onReturn, error: onFeatureError });
  const dispatchAction = useCallback((action: WorldAction) => {
    if (action.sceneId === 'habitat' && action.objectId === 'wardrobe' && action.kind === 'toggle') {
      const next = nextOutfit(outfitRef.current);
      outfitRef.current = next;
      pendingOutfitSwitch.current = next;
      setOutfit(next);
      rememberOutfit(next);
      void baseWorld.onAction(action);
      return;
    }
    return library.dispatch(action);
  }, [baseWorld.onAction, library.dispatch]);
  const world = { ...baseWorld, library, outfit, onAction: dispatchAction, onReturn: () => { if (library.flow.current.phase !== 'idle') library.back(); else baseWorld.onReturn(); } };
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
    if (initialized.current) return;
    initialized.current = true;
    const dev = new URLSearchParams(window.location.search).get('dev');
    if (dev === 'mario' || dev === 'shooter') {
      setViewMode('cabin');
      setActiveGame(dev);
      void world.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' });
    }
  }, [world.onAction]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editable = event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable);
      if (editable) return;
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

  const onImportMusic = useCallback(() => { void roomAudio.unlock(); fileInput.current?.click(); }, []);
  const importFiles = useCallback((files: FileList | null) => {
    if (world.focusedObject !== 'music-player' || library.flow.current.phase !== 'idle') return;
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)) { onFeatureError('请放入一个音频文件。'); return; }
    if (file.size > 100 * 1024 * 1024) { onFeatureError('这张唱片太大了，请选择 100 MB 以内的音频。'); return; }
    const title = file.name.replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(file);
    ownedUrls.current.push(url);
    const disc: MusicDisc = { id: `local-${Date.now()}-${ownedUrls.current.length}`, title, artist: '私人唱片收藏', audioUrl: url, discThemeColor: generateDiscColorsFromName(title), isUserUploaded: true };
    setDiscs(current => [disc, ...current]);
    roomAudio.prepareMusic(disc);
    onFeatureError(`《${title}》已放进唱片架`);
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
  const focusGuide = world.focusedObject === 'journal' ? '点击书页书写 · ← / → 翻页 · 自动保存 · Esc 返回'
    : world.focusedObject === 'schedule' ? '← / → 翻页 · X 撕下这页 · V 切换视角 · Esc 返回'
    : world.focusedObject === 'schedule-glass' ? '左右键浏览 · V 切换视角 · Esc 返回'
    : world.focusedObject === 'clock' ? '设定闹钟或倒计时 · 可试听经典版与特供版铃声 · Esc 返回' : '';
  const orbitGuide = viewMode === 'approach' ? '宇宙很大。这里，刚刚好。'
    : viewMode === 'orbit' ? (boosting ? '推进加速中 · 绕地巡航与时间加速' : '长按空格加速绕地 · 按 E 或点击飞船进入舱室')
    : '';
  const status = viewMode !== 'cabin'
    ? orbitGuide
    : (announcement || world.error || audio.error || focusGuide || world.hover?.hint || (world.focusedObject ? '操作物品继续探索 · Esc / 双指轻触退回' : ''));
  const showFlightControls = !world.focusedObject && !activeGame && library.flow.current.phase === 'idle' && (viewMode === 'orbit' || viewMode === 'approach' || viewMode === 'cabin');
  return <main className={`orbital-app${draggingFile ? ' is-importing' : ''}${world.focusedObject ? ' is-focused' : ''}${viewMode !== 'cabin' ? ' is-orbit' : ''}`} aria-label="PocketWorld 轨道居住舱"
    onDragEnter={event => { if (viewMode !== 'cabin' || world.focusedObject !== 'music-player' || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); inputDepth.current += 1; setDraggingFile(true); }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={event => { event.preventDefault(); inputDepth.current = Math.max(0, inputDepth.current - 1); if (!inputDepth.current) setDraggingFile(false); }}
    onDrop={event => { event.preventDefault(); inputDepth.current = 0; setDraggingFile(false); importFiles(event.dataTransfer.files); }}>
    <OrbitalScene {...world} viewMode={viewMode} boosting={boosting} onViewModeChange={setViewMode} onEnterCabin={enterCabin}
      books={books} adapters={adapters} onImportMusic={onImportMusic} discs={discs} activeDisc={audio.disc} isMusicPlaying={audio.isPlaying} isMuted={audio.isMuted}
      onSelectDisc={onSelectDisc} onToggleMusic={onToggleMusic} onToggleMute={onToggleMute} activeGame={activeGame} onGameChange={setActiveGame} onFeatureError={onFeatureError}
      onOutfitLoading={onOutfitLoading} onOutfitReady={onOutfitReady} onOutfitError={onOutfitError} />
    <LibrarySurface library={library} />
    <header className="orbital-header">
      <div className="orbital-wordmark"><span className="orbital-emblem" aria-hidden="true" /><span>pocketworld<span className="orbital-wordmark-dot">.</span></span></div>
      <p className="orbital-edition">A LITTLE SPACE TO BE YOURSELF</p>
    </header>
    <DustPrompt text={status} reducedMotion={world.reducedMotion} />
    {showFlightControls && <nav className="orbital-flight-bar" aria-label="飞船巡航控制">
      {viewMode === 'cabin' ? (
        <button type="button" className="orbital-flight-pill" onClick={leaveCabin}>出舱巡航 · F</button>
      ) : (
        <>
          <button
            type="button"
            className={`orbital-flight-pill${boosting ? ' is-boosting' : ''}`}
            onPointerDown={event => { event.preventDefault(); activateBoost(true); }}
            onPointerUp={() => activateBoost(false)}
            onPointerLeave={() => activateBoost(false)}
            onPointerCancel={() => activateBoost(false)}
            aria-pressed={boosting}
          >{boosting ? '加速巡航中' : '长按加速 · Space'}</button>
          <button type="button" className="orbital-flight-pill is-primary" onClick={enterCabin}>进入舱室 · E</button>
        </>
      )}
    </nav>}
    {audio.isPlaying && <aside className="orbital-now-playing"><span className="orbital-record-dot" /><div><small>NOW PLAYING</small><p>{audio.disc.title}</p></div></aside>}
    {draggingFile && <div className="orbital-drop-message"><span className="orbital-drop-disc" /><p>让这段音乐，留在这里。</p><small>松手制作一张自己的唱片</small></div>}
    <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac" hidden onChange={event => importFiles(event.target.files)} />
    <span className="sr-only">键盘：舱外视角长按空格或 Shift 加速绕地飞行与时间流逝，E 或回车进入舱室；舱内 F 返回舱外视角，WASD 行走，E、Q、R 依次与身边最近的物品互动，M 静音，Esc 返回。</span>
  </main>;
};
