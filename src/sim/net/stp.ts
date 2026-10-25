// Spanning tree, simplified: per VLAN, root = lowest stpPriority (then device id); BFS tree from the root;
// every non-tree edge gets one end blocked — unless NEITHER end runs STP for that VLAN, which is a
// broadcast storm (real PVST behaviour: one STP speaker on a loop is enough to break it).
// WP1 owns this file.
import type { World } from '../types';

export interface StpView {
  /** Root bridge device id per connected component (first component's root here) */
  root: string | null;
  /** Blocked ports, as 'dev:ifn' */
  blocked: Set<string>;
  /** Port roles for `show spanning-tree`, keyed 'dev:ifn' */
  roles: Record<string, 'Root' | 'Desg' | 'Altn'>;
  storm: boolean;
}

export function stpView(_w: World, _vlan: number): StpView {
  // TODO(WP1)
  return { root: null, blocked: new Set(), roles: {}, storm: false };
}
