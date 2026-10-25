// Direct world changes made by mini-games (the "hands" of the player).
import { setImage } from './k8s';
import type { AppService, World } from './types';
import { own } from './util';

export function mount(w: World, id: string): void {
  const d = own(w.devices, id);
  if (d) d.installed = true;
}

export function setFeeds(w: World, id: string, feeds: ('A' | 'B')[]): void {
  const d = own(w.devices, id);
  if (d) d.feeds = [...feeds].sort() as ('A' | 'B')[];
}

export function setUps(w: World, on: boolean): void {
  if (w.power) w.power.ups = on;
}

/** Plug a new cable between two endpoints, replacing whatever was plugged into either end. */
export function connectCable(w: World, a: string, b: string): string {
  for (const [id, c] of Object.entries(w.cables)) {
    if ([c.a, c.b].includes(a) || [c.a, c.b].includes(b)) delete w.cables[id];
  }
  const id = `c_${a.split(':')[0]}`;
  w.cables[id] = { id, a, b, broken: false };
  return id;
}

/** A brand-new cable: neither cut (broken) nor half-damaged (degraded). */
export function replaceCable(w: World, cableId: string): void {
  const c = own(w.cables, cableId);
  if (c) {
    c.broken = false;
    c.degraded = false;
  }
}

export function repairCrac(w: World): void {
  if (w.cooling) w.cooling.cracOk = true;
}

const svc = (name: string, label: string, share: number, calls: string[], capacityRps: number): AppService => ({
  name, label, up: true, replicas: 1, capacityRps, share, calls, dbAccess: [`${name}-db`], installing: [], crashLoop: false, restartTimer: 5,
});

/** Split the monolith into services by business capability (result of the decomposition puzzle). */
export function decompose(w: World): void {
  if (!w.app) return;
  w.app.arch = 'msa';
  w.app.services = {
    login: svc('login', '로그인', 1, [], 6000),
    course: svc('course', '과목조회', 0.6, [], 3500),
    cart: svc('cart', '장바구니', 0.4, ['course'], 3000),
    enroll: svc('enroll', '수강신청', 1, ['course', 'login'], 6000),
    notify: svc('notify', '알림', 0.5, [], 3000),
  };
  // The notify bug is still in the code; it just can't take everything down anymore.
  w.app.services.notify.restartTimer = 5;
}

export function writeDockerfile(w: World, service: string): void {
  w.flags[`dockerfile:${service}`] = 'ok';
}

/**
 * Desired-state card: set the pod count and, optionally, the image. Leave `image` out to keep
 * whatever version is deployed or being rolled out (changing only the count never touches a rollout).
 */
export function applyDesired(w: World, app: string, replicas: number, image?: string): void {
  const k = w.k8s;
  const dep = own(k?.deployments, app);
  if (!k || !dep) return;
  dep.replicas = replicas;
  if (image !== undefined) setImage(k, app, image);
}
