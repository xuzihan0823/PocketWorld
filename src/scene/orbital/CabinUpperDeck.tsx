import React, { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { UPPER_DECK_OFFSET } from './cabinLayout';
import { createCabinGroupFade, type CabinOpacity, type CabinZoomFadePart } from './cabinCutaway';

export const CabinOpacityContext = createContext<React.MutableRefObject<CabinOpacity> | null>(null);

type CabinFadePart = Exclude<keyof CabinOpacity, 'zoomFades'>;

export function CabinFadeGroup({ part, name, position, children }: React.PropsWithChildren<{
  part: CabinFadePart | (() => CabinFadePart);
  name?: string;
  position?: [number, number, number];
}>) {
  const cutaway = useContext(CabinOpacityContext);
  const group = useRef<Group>(null);
  const applied = useRef<number>();
  const fade = useMemo(createCabinGroupFade, []);
  const getPart = () => typeof part === 'function' ? part() : part;
  const opacity = (selectedPart: CabinFadePart) => {
    const state = cutaway?.current;
    return state ? state.interior * (selectedPart === 'interior' ? 1 : state[selectedPart]) : 1;
  };
  useLayoutEffect(() => fade.dispose, [fade]);
  useFrame(() => {
    const root = group.current;
    if (!root) return;
    const selectedPart = getPart();
    const amount = opacity(selectedPart);
    const wholePart = selectedPart !== 'interior'
      && !!cutaway?.current.zoomFades.includes(selectedPart as CabinZoomFadePart);
    const materialOpacity = wholePart ? 1 : amount;
    if (materialOpacity !== applied.current || (materialOpacity > 0 && materialOpacity < 1)) {
      fade.set(root, materialOpacity);
      applied.current = materialOpacity;
    }
    root.userData.cabinZoomPart = wholePart ? selectedPart : undefined;
    root.userData.cabinInteractive = amount >= .5;
  });
  return <group ref={group} name={name} position={position} visible={opacity(getPart()) > 0}>
    {children}
  </group>;
}

export function CabinUpperDeck({ children }: React.PropsWithChildren) {
  return <CabinFadeGroup part="upper" name="Cabin_UpperDeck" position={UPPER_DECK_OFFSET}>{children}</CabinFadeGroup>;
}
