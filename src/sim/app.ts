import type { AppService, AppState, World } from './types';

/** Seconds a manually installed server takes before it can serve (Stage 4 pain point). */
export const MANUAL_INSTALL_SECONDS = 8;
/** Monolith crashes this many seconds after a restart while the notify bug is live under load. */
const CRASH_AFTER = 5;
const CRASH_RPS = 800;

export function svc(app: AppState, name: string): AppService | undefined {
  return app.services[name];
}

export function capacity(s: AppService): number {
  return s.up ? s.replicas * s.capacityRps : 0;
}

export function restartService(app: AppState, name: string): boolean {
  const s = app.services[name];
  if (!s) return false;
  s.up = true;
  s.restartTimer = CRASH_AFTER;
  // In the split architecture the notify team can ship a hotfix and restart only notify.
  if (app.arch === 'msa' && name === 'notify') app.notifyBug = false;
  return true;
}

export function scaleService(app: AppState, name: string, replicas: number): boolean {
  const s = app.services[name];
  if (!s) return false;
  const pending = s.installing.length;
  const target = Math.max(1, Math.min(10, replicas));
  if (target <= s.replicas) {
    s.replicas = target;
    s.installing = [];
    return true;
  }
  const toAdd = target - s.replicas - pending;
  for (let i = 0; i < toAdd; i++) s.installing.push(MANUAL_INSTALL_SECONDS + i * MANUAL_INSTALL_SECONDS);
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
