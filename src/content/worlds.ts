import { linkUp, ping, powered } from '../sim/network';
import { powerKw } from '../sim/step';
import type { Device, Health, World } from '../sim/types';

const server = (id: string, label: string, rack: string): Device => ({
  id, kind: 'server', label, rack, installed: false, feeds: [], ports: ['eth0'],
});

/** Stage 1 start: network gear in place, servers still in boxes. */
export function physicalWorld(): World {
  return {
    t: 0,
    devices: {
      internet: { id: 'internet', kind: 'internet', label: '학생들 (인터넷)', installed: true, feeds: [], ports: ['wan'] },
      r1: { id: 'r1', kind: 'router', label: '라우터', installed: true, feeds: ['A', 'B'], ports: ['wan', 'lan'] },
      sw1: { id: 'sw1', kind: 'switch', label: '스위치', installed: true, feeds: ['A', 'B'], ports: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'] },
      web: server('web', '웹 서버', 'rack1'),
      db: server('db', 'DB 서버', 'rack1'),
      spare: server('spare', '예비 서버', 'rack2'),
    },
    cables: {
      wan: { id: 'wan', a: 'internet:wan', b: 'r1:wan', broken: false },
      uplink: { id: 'uplink', a: 'r1:lan', b: 'sw1:p0', broken: false },
    },
    power: { mains: true, ups: false },
    traffic: { rps: 0, noticeShare: 0.4 },
    flags: {},
  };
}

/** Stage 2 start: everything mounted, powered and cabled, but no addresses yet. */
export function cabledWorld(): World {
  const w = physicalWorld();
  for (const id of ['web', 'db', 'spare']) {
    w.devices[id].installed = true;
    w.devices[id].feeds = ['A', 'B'];
    w.devices[id].l3 = { mode: 'dhcp', ip: null, mask: 24, gw: null };
  }
  w.devices.r1.l3 = { mode: 'static', ip: '10.0.1.1', mask: 24, gw: null };
  w.devices.ops = { id: 'ops', kind: 'server', label: '관리 PC', installed: true, feeds: ['A', 'B'], ports: ['eth0'], l3: { mode: 'static', ip: '10.0.1.5', mask: 24, gw: '10.0.1.1' } };
  w.cables.c_web = { id: 'c_web', a: 'web:eth0', b: 'sw1:p1', broken: false };
  w.cables.c_db = { id: 'c_db', a: 'db:eth0', b: 'sw1:p2', broken: false };
  w.cables.c_spare = { id: 'c_spare', a: 'spare:eth0', b: 'sw1:p3', broken: false };
  w.cables.c_ops = { id: 'c_ops', a: 'ops:eth0', b: 'sw1:p9', broken: false };
  w.power!.ups = true;
  w.net = {
    dhcpServer: false,
    // ops normally keeps its fixed address; the reservation only matters if someone switches it to DHCP,
    // so the admin PC never ends up with no address at all.
    dhcpLeases: { web: '10.0.1.10', db: '10.0.1.20', spare: '10.0.1.30', ops: '10.0.1.5' },
    dns: { web: '10.0.1.10', db: '10.0.1.20', spare: '10.0.1.30', r1: '10.0.1.1', ops: '10.0.1.5', 'google.com': '8.8.8.8' },
    routerIp: '10.0.1.1',
    mask: 24,
  };
  w.traffic.rps = 50;
  return w;
}

/**
 * Stage 3 start: network healthy, web server installed but not started (on the wrong port, single-threaded).
 * Only a few beta testers are online and no notice has been posted yet, so nothing else is broken
 * until an incident says so. Stages 0 and 4 build on this world and set their own traffic/notice.
 */
export function networkedWorld(): World {
  const w = cabledWorld();
  w.net!.dhcpServer = true;
  for (const id of ['web', 'db', 'spare']) {
    const l3 = w.devices[id].l3!;
    l3.ip = w.net!.dhcpLeases[id];
    l3.gw = w.net!.routerIp;
  }
  w.web = { host: 'web', running: false, port: 8080, threads: 'single', routes: ['/', '/enroll', '/courses'] };
  w.traffic.rps = 20;
  return w;
}

export function emptyHealth(w: World, extra: Partial<Health> = {}): Health {
  return {
    availability: 1,
    latencyMs: 20,
    errorRate: 0,
    rps: w.traffic.rps,
    maxTemp: Math.max(24, ...Object.values(w.cooling?.temps ?? {})),
    powerKw: powerKw(w),
    services: {},
    notes: [],
    ...extra,
  };
}

export const SERVERS = ['web', 'db', 'spare'];

export function serverStatus(w: World, id: string): 'up' | 'degraded' | 'down' {
  if (!powered(w, id)) return 'down';
  return linkUp(w, id, 'eth0') ? 'up' : 'degraded';
}

/** Students → web, and web → db (by name). Used by stages 2 and 3. */
export function networkPath(w: World): { ok: number; notes: string[] } {
  const notes: string[] = [];
  // Each name must lead to the machine itself; another box answering (or answering only half the time) is a failure too.
  const outside = ping(w, 'internet', 'web');
  const rightWeb = outside.ok && outside.targetId === 'web';
  if (!outside.ok) notes.push('외부(학생)에서 web 접속 실패');
  else if (!rightWeb) notes.push('외부(학생) 요청에 엉뚱한 장비가 응답함');
  else if (outside.loss > 0) notes.push('외부(학생) → web 응답이 들쭉날쭉');
  const toDb = ping(w, 'web', 'db');
  const rightDb = toDb.ok && toDb.targetId === 'db';
  if (!toDb.ok) notes.push('web → db 연결 실패');
  else if (!rightDb) notes.push('web → db 요청에 엉뚱한 장비가 응답함');
  else if (toDb.loss > 0) notes.push('web → db 응답이 들쭉날쭉');
  const ok = (rightWeb ? 1 - outside.loss : 0) * (rightDb ? 1 - toDb.loss : 0);
  return { ok, notes };
}
