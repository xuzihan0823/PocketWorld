import { useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { WorldModelProps } from '../../../types/world';
import { ObjectHandle } from '../ObjectHandle';
import { BoundJournal } from '../journal/BoundJournal';
import { createBookControl } from '../journal/bookControl';
import { BOOK } from '../journal/bookModel';
import { SCHEDULE_POSITION, SCHEDULE_SCALE, SCHEDULE_SPREAD, SCHEDULE_YAW } from './bookLayout';

export function ScheduleBook({ world, children }: { world: WorldModelProps; children: ReactNode }) {
  const opened = !!(world.objects.schedule?.open || world.objects.schedule?.active);
  const book = useRef(createBookControl());
  const previousOpened = useRef(opened);
  const [pageReady, setPageReady] = useState(false);
  book.current.spread = SCHEDULE_SPREAD;
  useFrame(() => {
    if (previousOpened.current !== opened) {
      previousOpened.current = opened;
      setPageReady(false);
      return;
    }
    const ready = opened && book.current.ready && book.current.cursor === SCHEDULE_SPREAD;
    if (ready !== pageReady) setPageReady(ready);
  });
  return <group name="Schedule_Binding" position={SCHEDULE_POSITION} rotation-y={SCHEDULE_YAW} scale={SCHEDULE_SCALE}>
    <ObjectHandle id="schedule" action="plan" hint="展开日程 · 安排计划" world={world}>
      <BoundJournal opened={opened} control={book} reducedMotion={world.reducedMotion} leafCount={BOOK.leaves}
        coverColor="#7b9184" coverLabel="日  程" coverSubtitle="D A Y S" openAsStack openingDuration={1.15} />
    </ObjectHandle>
    {opened && pageReady && children}
  </group>;
}
