import { useEffect, useRef, useState } from 'react';
import type { JournalEntry, WorldSceneProps } from '../../types/world';
import { ObjectHandle } from './ObjectHandle';
import { JOURNAL_POSITION, JOURNAL_SCALE, JOURNAL_YAW } from './journalLayout';
import { BoundJournal } from './journal/BoundJournal';
import { BOOK } from './journal/bookModel';
import { createBookControl } from './journal/bookControl';
import { JournalEditor } from './journal/JournalEditor';
import { emptyJournal, journalPages, loadLocalJournal, saveLocalJournal } from './journal/journalStorage';

export function FeatureSurfaces(world: WorldSceneProps) {
  const opened = world.focusedObject === 'journal' && !!world.objects.journal?.open;
  const adapter = world.adapters?.journal;
  const { onFeatureError, onGesture } = world;
  const book = useRef(createBookControl());
  const [entry, setEntry] = useState<JournalEntry>();
  const [leafCount, setLeafCount] = useState(BOOK.leaves);
  const [saveState, setSaveState] = useState('');
  const saved = useRef<Promise<void>>(Promise.resolve());
  const unsaved = useRef<{ adapter: typeof adapter; entry: JournalEntry }>();

  useEffect(() => {
    if (!opened) {
      setEntry(undefined);
      return;
    }
    const abort = new AbortController();
    setSaveState('');
    void (async () => {
      try {
        await saved.current;
        if (abort.signal.aborted) return;
        const pending = unsaved.current;
        const loaded = pending && pending.adapter === adapter ? pending.entry :
          adapter ? await adapter.load(abort.signal) : loadLocalJournal(localStorage);
        if (!abort.signal.aborted) {
          const next = loaded && typeof loaded.text === 'string' ? loaded : emptyJournal();
          setLeafCount(count => Math.max(count, Math.ceil(journalPages(next).length / 2) + 1));
          setEntry(next);
        }
      } catch {
        if (!abort.signal.aborted) onFeatureError('日记暂时无法读取，请重新打开再试。');
      }
    })();
    return () => abort.abort();
  }, [opened, adapter, onFeatureError]);

  useEffect(() => {
    const textures = book.current.textures;
    return () => { textures.forEach(texture => texture.dispose()); textures.clear(); };
  }, []);

  const save = (next: JournalEntry) => {
    const usedLeaves = Math.ceil((next.pages?.length ?? 1) / 2);
    if (usedLeaves >= leafCount) setLeafCount(usedLeaves + 1);
    const revision = { adapter, entry: next };
    unsaved.current = revision;
    const complete = () => {
      if (unsaved.current !== revision) return;
      unsaved.current = undefined;
      setSaveState('已记下');
    };
    const failed = () => {
      if (unsaved.current !== revision) return;
      setSaveState('尚未保存');
      onFeatureError('内容暂时无法保存。可以继续编辑，下一次修改会重试。');
    };
    if (adapter) {
      setSaveState('正在记录');
      saved.current = saved.current.then(() => {
        if (unsaved.current === revision) return adapter.save(next, new AbortController().signal);
      }).then(complete, failed);
    } else {
      try { saveLocalJournal(localStorage, next); complete(); }
      catch { failed(); }
    }
  };

  const editor = opened && entry && (world.transition.phase === 'active' || world.transition.phase === 'error');

  return <group position={JOURNAL_POSITION} rotation-y={JOURNAL_YAW} scale={JOURNAL_SCALE}>
    <ObjectHandle id="journal" action="write" hint="翻开日记 · 写下今天"
      world={opened ? { ...world, onApproach: () => false } : world}>
      <BoundJournal opened={opened} reducedMotion={world.reducedMotion} control={book} leafCount={leafCount} />
    </ObjectHandle>
    {editor && <JournalEditor book={book} leafCount={leafCount} entry={entry} saveState={saveState} onChange={save} onGesture={onGesture} />}
  </group>;
}
