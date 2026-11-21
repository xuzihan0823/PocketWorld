import React, { createContext, useContext } from 'react';
import { UPPER_DECK_OFFSET } from './cabinLayout';

export const UpperDeckVisibility = createContext(true);

export function CabinUpperDeck({ children }: React.PropsWithChildren) {
  return <group name="Cabin_UpperDeck" position={UPPER_DECK_OFFSET} visible={useContext(UpperDeckVisibility)}>
    {children}
  </group>;
}
