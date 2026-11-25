import { createContext, type ReactNode } from 'react';

/** Only the standalone Vite experiment provides a frame observer. */
export const RoomExperiment = /* @__PURE__ */ createContext<ReactNode>(null);
