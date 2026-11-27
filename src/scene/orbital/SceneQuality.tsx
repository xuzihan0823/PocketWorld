import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { createQualityState, resetQualitySamples, sampleQuality, type QualityLevel } from './adaptiveQuality';

export function AdaptiveQuality({ paused, pausedRef, onChange }: { paused: boolean; pausedRef?: { current: unknown }; onChange: (level: QualityLevel) => void }) {
  const state = useMemo(createQualityState, []);
  useEffect(() => {
    const reset = () => resetQualitySamples(state);
    document.addEventListener('visibilitychange', reset);
    return () => document.removeEventListener('visibilitychange', reset);
  }, [state]);
  useFrame((_, delta) => {
    const level = sampleQuality(state, delta, !paused && !pausedRef?.current && !document.hidden && !useProgress.getState().active);
    if (level !== null) onChange(level);
  });
  return null;
}
