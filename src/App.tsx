import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MusicDisc } from './types/interactable';
import type { GameId } from './types/game';
import type { BookContent, WorldFeatureAdapters } from './types/world';
import { PRESET_MUSIC_DISCS, generateDiscColorsFromName, roomAudio } from './scene/audioEngine';
import { OrbitalScene } from './scene/orbital/OrbitalScene';
import { PRESET_BOOKS, loadLocalBooks, storeLocalBooks } from './scene/orbital/library';
import { useWorldController } from './scene/orbital/useWorldController';
import './scene/orbital/orbital.css';

export const App: React.FC<{ adapters?: WorldFeatureAdapters }> = ({ adapters }) => {
  const world = useWorldController(adapters);
  const audio = useSyncExternalStore(roomAudio.subscribe, roomAudio.getSnapshot);
  const [discs, setDiscs] = useState<MusicDisc[]>(PRESET_MUSIC_DISCS);
  const [localBooks, setLocalBooks] = useState(loadLocalBooks);
  const books = [...PRESET_BOOKS, ...localBooks];
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
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const dev = new URLSearchParams(window.location.search).get('dev');
    if (dev === 'mario' || dev === 'shooter') {
      setActiveGame(dev);
      void world.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' });
    }
  }, [world.onAction]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable);
      if (event.code === 'Escape') {
        if (activeGame && world.focusedObject === 'computer') return;
        event.preventDefault();
        (document.activeElement as HTMLElement)?.blur?.();
        world.onReturn();
      }
      if (editable || activeGame) return;
      if (event.code === 'KeyM') { event.preventDefault(); roomAudio.setMuted(!roomAudio.getSnapshot().isMuted); }
      const shortcuts: Record<string, { objectId: string; kind: 'write' | 'plan' | 'read' | 'sleep' | 'inspect' }> = {
        KeyJ: { objectId: 'journal', kind: 'write' }, KeyO: { objectId: 'schedule', kind: 'plan' }, KeyR: { objectId: 'book-01', kind: 'read' }, KeyB: { objectId: 'bed', kind: 'sleep' }, KeyC: { objectId: 'computer', kind: 'inspect' }, KeyL: { objectId: 'music-player', kind: 'inspect' },
      };
      if (shortcuts[event.code] && !event.repeat && !(event.code === 'KeyB' && world.sceneId !== 'habitat')) {
        event.preventDefault();
        void world.onAction({ sceneId: world.sceneId, ...shortcuts[event.code] });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [world.onReturn, world.onAction, world.sceneId, world.focusedObject, activeGame]);
  useEffect(() => () => {
    window.clearTimeout(hintTimer.current);
    roomAudio.stopMusic();
    ownedUrls.current.forEach(url => URL.revokeObjectURL(url));
    ownedUrls.current = [];
  }, []);

  const onAddBook = useCallback((title: string, author: string, text: string): BookContent | null => {
    const pages = text.trim().split(/\n\s*\n/).map(page => page.trim()).filter(Boolean);
    if (!title.trim() || !pages.length) { onFeatureError('请填写书名和正文。'); return null; }
    if (title.trim().length > 80 || author.trim().length > 60 || text.length > 10000) { onFeatureError('书籍内容超过长度限制。'); return null; }
    if (localBooks.length >= 30) { onFeatureError('书柜最多收录 30 本自己的书。'); return null; }
    try {
      const book: BookContent = { id: `visitor-${crypto.randomUUID()}`, title: title.trim(), author: author.trim() || '访客', pages };
      storeLocalBooks([...localBooks, book]);
      setLocalBooks(current => [...current, book]);
      return book;
    } catch { onFeatureError('书籍未能保存，请检查浏览器存储空间。'); return null; }
  }, [localBooks, onFeatureError]);
  const onImportMusic = useCallback(() => { void roomAudio.unlock(); fileInput.current?.click(); }, []);
  const importFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name)) { onFeatureError('请放入一个音频文件。'); return; }
    if (file.size > 100 * 1024 * 1024) { onFeatureError('这张唱片太大了，请选择 100 MB 以内的音频。'); return; }
    const title = file.name.replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(file);
    ownedUrls.current.push(url);
    const disc: MusicDisc = { id: `local-${Date.now()}-${ownedUrls.current.length}`, title, artist: '私人唱片收藏', audioUrl: url, discThemeColor: generateDiscColorsFromName(title), isUserUploaded: true };
    setDiscs(current => [disc, ...current]);
    void roomAudio.startMusic(disc);
    void world.onAction({ sceneId: world.sceneId, objectId: 'music-player', kind: 'inspect' });
    onFeatureError(`《${title}》已放进唱片架`);
    if (fileInput.current) fileInput.current.value = '';
  }, [world.onAction, world.sceneId, onFeatureError]);
  const onSelectDisc = useCallback((disc: MusicDisc) => { void roomAudio.startMusic(disc); }, []);
  const onToggleMusic = useCallback(() => {
    const current = roomAudio.getSnapshot();
    if (current.isPlaying) roomAudio.pauseMusic();
    else if (current.status === 'paused') void roomAudio.resumeMusic();
    else void roomAudio.startMusic(current.disc);
  }, []);
  const onToggleMute = useCallback(() => { roomAudio.setMuted(!roomAudio.getSnapshot().isMuted); }, []);
  const scheduleGuide = world.focusedObject === 'schedule' ? '上拖纸页贴出 · V 切换视角 · Esc 返回'
    : world.focusedObject === 'schedule-glass' ? '左右键浏览 · V 切换视角 · Esc 返回' : '';
  const status = announcement || world.error || audio.error || scheduleGuide || world.hover?.hint || (world.focusedObject ? '操作物品继续探索 · Esc / 双指轻触退回' : '触碰物品，留一会儿');
  const travelling = world.transition.action?.kind === 'travel' && !['active', 'idle', 'error'].includes(world.transition.phase);
  return <main className={`orbital-app${draggingFile ? ' is-importing' : ''}${world.focusedObject ? ' is-focused' : ''}`} aria-label="PocketWorld 轨道居住舱"
    onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); inputDepth.current += 1; setDraggingFile(true); }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={event => { event.preventDefault(); inputDepth.current = Math.max(0, inputDepth.current - 1); if (!inputDepth.current) setDraggingFile(false); }}
    onDrop={event => { event.preventDefault(); inputDepth.current = 0; setDraggingFile(false); importFiles(event.dataTransfer.files); }}>
    <OrbitalScene {...world} books={books} onAddBook={onAddBook} adapters={adapters} onImportMusic={onImportMusic} discs={discs} activeDisc={audio.disc} isMusicPlaying={audio.isPlaying} isMuted={audio.isMuted}
      onSelectDisc={onSelectDisc} onToggleMusic={onToggleMusic} onToggleMute={onToggleMute} activeGame={activeGame} onGameChange={setActiveGame} onFeatureError={onFeatureError} />
    <header className="orbital-header">
      <div className="orbital-wordmark"><span className="orbital-emblem" aria-hidden="true" /><span>pocketworld<span className="orbital-wordmark-dot">.</span></span></div>
      <p className="orbital-edition">A LITTLE SPACE TO BE YOURSELF</p>
      <div className="orbital-coordinate"><span>EARTH ORBIT</span><strong>{world.sceneId === 'habitat' ? 'HABITAT / 01' : 'OBSERVATORY / 02'}</strong><i>旋转居住环 · 地球轨道</i></div>
    </header>
    <div className="orbital-caption" aria-hidden="true"><h1>{world.sceneId === 'habitat' ? '宇宙很大。\n这里，刚刚好。' : '在星光里，\n慢慢读一页。'}</h1></div>
    <footer className="orbital-footer">
      <div className="orbital-location"><span className="orbital-live-dot" /><span>{travelling ? '前往下一间舱室' : world.sceneId === 'habitat' ? '生活舱' : '观景阅览舱'}</span><span className="orbital-location-rule" /><span>ORBITAL HOME</span></div>
      <p className="orbital-status" role="status" aria-live="polite">{status}</p>
      <p className="orbital-guide">拖动环绕 · 捏合缩放 · 点地面走动<span>WASD 行走 / Space 跳跃 / E 互动</span></p>
    </footer>
    {audio.isPlaying && <aside className="orbital-now-playing"><span className="orbital-record-dot" /><div><small>NOW PLAYING</small><p>{audio.disc.title}</p></div></aside>}
    {draggingFile && <div className="orbital-drop-message"><span className="orbital-drop-disc" /><p>让这段音乐，留在这里。</p><small>松手制作一张自己的唱片</small></div>}
    <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac" hidden onChange={event => importFiles(event.target.files)} />
    <span className="sr-only">键盘：J 日记，O 日程，V 切换日程书与玻璃，向上拖动纸张贴出安排，R 阅读，B 休息，C 电脑，L 音乐，M 静音，Esc 返回。触屏在物品上拖动，双指轻触返回。</span>
  </main>;
};
