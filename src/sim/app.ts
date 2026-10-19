import type { AppService, AppState, World } from './types';
import { own } from './util';

/** Seconds a manually installed server takes before it can serve (Stage 4 pain point). */
export const MANUAL_INSTALL_SECONDS = 8;
/** Monolith crashes this many seconds after a restart while the notify bug is live under load. */
const CRASH_AFTER = 5;
const CRASH_RPS = 800;

export function svc(app: AppState, name: string): AppService | undefined {
  return own(app.services, name);
}

export function capacity(s: AppService): number {
  return s.up ? s.replicas * s.capacityRps : 0;
}

export function restartService(app: AppState, name: string): boolean {
  const s = own(app.services, name);
  if (!s) return false;
  s.up = true;
  s.restartTimer = CRASH_AFTER;
  // In the split architecture the notify team can ship a hotfix and restart only notify.
  if (app.arch === 'msa' && name === 'notify') app.notifyBug = false;
  return true;
}

/**
 * Set the number of servers a service should have. Lowering it removes servers (or cancels installs
 * that haven't finished); raising it queues manual installs one after another.
 */
export function scaleService(app: AppState, name: string, replicas: number): boolean {
  const s = own(app.services, name);
  if (!s) return false;
  const target = Math.max(1, Math.min(10, replicas));
  if (target <= s.replicas) {
    s.replicas = target;
    s.installing = [];
    return true;
  }
  const want = target - s.replicas; // installs still needed to reach the target
  s.installing.sort((a, b) => a - b);
  if (want <= s.installing.length) {
    s.installing = s.installing.slice(0, want); // cancel the extra installs, keep the ones finishing soonest
    return true;
  }
  // One person installs one server at a time: each new install starts after the last pending one.
  let last = s.installing.length ? s.installing[s.installing.length - 1] : 0;
  while (s.installing.length < want) {
    last += MANUAL_INSTALL_SECONDS;
    s.installing.push(last);
  }
  return true;
}

export function tickApp(w: World, dt: number): void {
  const app = w.app;
  if (!app) return;
  for (const s of Object.values(app.services)) {
    if (s.installing.length) {
      s.installing = s.installing.map((x) => x - dt);
      const done = s.installing.filter((x) => x <= 0).length;
      s.installing = s.installing.filter((x) => x > 0);
      s.replicas += done;
    }
    const buggy = app.notifyBug && (s.name === 'monolith' || s.name === 'notify');
    if (buggy && s.up && w.traffic.rps >= CRASH_RPS) {
      s.restartTimer -= dt;
      if (s.restartTimer <= 0) {
        s.up = false;
        s.crashLoop = true;
      }
    }
  }
}
