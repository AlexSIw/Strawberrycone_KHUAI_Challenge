import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { gameStore, useGame } from '../store/game';

/**
 * useState for a window's half-done work: the value lives in the store under `key`, so closing and
 * reopening the window brings it back. Starting or restarting the stage (play()) forgets it.
 * Keep purely momentary UI (hover, a drag in progress, a feedback flash) in plain useState.
 *
 * `initial` is used once, the first time the key is needed this stage, and is saved right away,
 * so a random start (a shuffled order) also stays the same after reopening.
 * Writes made after the stage started again (a timer left over from the old run) are dropped.
 */
export function useStageState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const box = useGame((s) => (Object.hasOwn(s.windowState, key) ? s.windowState[key] : undefined));
  const init = () => (box ? (box.v as T) : typeof initial === 'function' ? (initial as () => T)() : initial);
  /** The starting value for `key`, until the store has it (made again if the key changes) */
  const [seed, setSeed] = useState(() => ({ key, v: init() }));
  let start = seed;
  if (seed.key !== key) {
    start = { key, v: init() };
    setSeed(start);
  }
  /** The stage run this window belongs to */
  const [epoch] = useState(() => gameStore.getState().stageEpoch);

  useEffect(() => {
    const s = gameStore.getState();
    if (s.stageEpoch === epoch && !Object.hasOwn(s.windowState, start.key)) s.setWindowState(start.key, start.v);
  }, [start, epoch]);

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const s = gameStore.getState();
      if (s.stageEpoch !== epoch) return;
      const cur = (Object.hasOwn(s.windowState, start.key) ? s.windowState[start.key].v : start.v) as T;
      s.setWindowState(start.key, typeof next === 'function' ? (next as (prev: T) => T)(cur) : next);
    },
    [start, epoch],
  );

  return [box ? (box.v as T) : start.v, set];
}
