// Regression tests for the network / power / stage 0–4 fixes (cluster net-stages0-4).
import { describe, expect, it } from 'vitest';
import { getStage } from '../src/content/stages';
import { cabledWorld, networkedWorld } from '../src/content/worlds';
import { connectCable, decompose, mount, setFeeds, setUps } from '../src/sim/actions';
import { scaleService, tickApp } from '../src/sim/app';
import { runCommand } from '../src/sim/commands';
import {
  applyAction,
  applyCommand,
  isCleared,
  recordEvents,
  scoreRun,
  startStage,
  tickRun,
  visibleObjectives,
  type StageRun,
} from '../src/sim/engine';
import { applyDhcp, duplicateIps, ping, powered } from '../src/sim/network';
import { INCIDENT_GAP, type SolutionStep } from '../src/sim/scenario';
import type { StageId, World } from '../src/sim/types';

const SERVERS = ['web', 'db', 'spare'];
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const text = (lines: string[]) => lines.map(strip).join('\n');
const RED = '\x1b[31m';

type Step = { cmd: string; host: string } | { action: (w: World) => void } | { events: string[] };

/** How a player completes each objective in stages 0–4. */
const AUTOPLAY: Record<number, Record<string, Step[]>> = {
  0: {
    visit: [{ events: ['room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc'] }],
    dashboard: [{ events: ['open:dashboard'] }],
    mentor: [{ events: ['open:mentor'] }],
    quiz: [{ events: ['quiz:correct'] }],
  },
  1: {
    mount: [{ action: (w) => SERVERS.forEach((id) => mount(w, id)) }],
    power: [{ action: (w) => SERVERS.forEach((id) => setFeeds(w, id, ['A'])) }],
    cable: [{ action: (w) => SERVERS.forEach((id, i) => connectCable(w, `${id}:eth0`, `sw1:p${i + 1}`)) }],
  },
  2: {
    terminal: [{ events: ['open:terminal'] }],
    dhcp: [{ cmd: 'dhcp on', host: 'ops' }],
    ping: [{ cmd: 'ping web', host: 'ops' }],
  },
  3: {
    start: [{ cmd: 'server start', host: 'web' }],
    curl: [{ cmd: 'curl http://web/enroll', host: 'ops' }],
  },
  4: { watch: [{ cmd: 'svc list', host: 'ops' }] },
};

function apply(run: StageRun, step: Step | SolutionStep, errors?: string[]): StageRun {
  if ('cmd' in step) {
    const res = applyCommand(run, step.cmd, step.host);
    const bad = res.lines.filter((l) => l.startsWith(RED));
    if (bad.length && errors) errors.push(`${step.host}$ ${step.cmd} → ${bad.map(strip).join(' | ')}`);
    return res.run;
  }
  if ('action' in step) return applyAction(run, step.action).run;
  return recordEvents(run, step.events).run;
}

function doObjectives(run: StageRun): StageRun {
  const def = getStage(run.stage);
  for (const o of visibleObjectives(def, run)) {
    if (o.id in run.objectivesDone) continue;
    for (const s of AUTOPLAY[run.stage]?.[o.id] ?? []) run = apply(run, s);
  }
  return run;
}

/**
 * Play a stage (objectives done as soon as they appear, other incidents fixed `react` s after they fire)
 * until `target` is active. Returns the run at that moment.
 */
function playTo(stage: StageId, target: string, react = 2): StageRun {
  const def = getStage(stage);
  let run = startStage(stage);
  const fixed = new Set<string>();
  for (let t = 0; t < 300; t++) {
    run = doObjectives(run);
    run = tickRun(run).run;
    if (run.scenarios.find((s) => s.id === target)?.state === 'active') return run;
    for (const rt of run.scenarios) {
      if (rt.state !== 'active' || fixed.has(rt.id) || run.ctx.stageTime < (rt.activatedAt ?? 0) + react) continue;
      for (const s of def.scenarios.find((x) => x.id === rt.id)!.solutionSteps) run = apply(run, s);
      fixed.add(rt.id);
    }
  }
  throw new Error(`${target} never fired`);
}

function ticks(run: StageRun, n: number): StageRun {
  for (let i = 0; i < n; i++) run = tickRun(run).run;
  return run;
}

const state = (run: StageRun, id: string) => run.scenarios.find((s) => s.id === id)!.state;
const cmd = (run: StageRun, line: string, host = 'ops') => applyCommand(run, line, host);

// ---------------------------------------------------------------------------------------------

describe('C2 · the router is the real gateway', () => {
  it('the router itself reaches the internet and is reachable from it', () => {
    const w = networkedWorld();
    expect(ping(w, 'r1', 'google.com').ok).toBe(true);
    expect(ping(w, 'internet', '10.0.1.1').ok).toBe(true);
    const out = text(runCommand('ip addr', w, 'r1', 2).lines);
    expect(out).not.toContain('(없음)');
  });

  it('re-addressing the router is refused, and gateways must be an address the router owns', () => {
    const w = networkedWorld();
    const res = runCommand('ip set static 10.0.1.254', w, 'r1', 2);
    expect(res.lines[0]).toContain(RED);
    expect(res.world.devices.r1.l3!.ip).toBe('10.0.1.1');
    // A host pointing at an address no device owns can't get out.
    w.devices.web.l3 = { mode: 'static', ip: '10.0.1.10', mask: 24, gw: '10.0.1.254' };
    expect(ping(w, 'internet', 'web').ok).toBe(false);
  });

  it('DHCP hands out the router address as gateway', () => {
    const w = cabledWorld();
    w.net!.dhcpServer = true;
    applyDhcp(w);
    expect(w.devices.db.l3!.gw).toBe('10.0.1.1');
  });
});

describe('C3 / C37 · addresses outside the router network are unreachable', () => {
  it('an off-subnet static host is cut off, with a warning when it is set', () => {
    const w = networkedWorld();
    const res = runCommand('ip set static 192.168.7.30', w, 'spare', 2);
    expect(text(res.lines)).toContain('10.0.1.0/24');
    const w2 = res.world;
    expect(ping(w2, 'ops', '192.168.7.30').ok).toBe(false);
    expect(ping(w2, 'internet', '192.168.7.30').ok).toBe(false);
    expect(ping(w2, 'spare', 'google.com').ok).toBe(false);
    // Everyone else is unaffected.
    expect(ping(w2, 'ops', 'web').ok).toBe(true);
    expect(ping(w2, 'internet', 'web').ok).toBe(true);
  });

  it('switching the admin PC to DHCP does not strand it without an address', () => {
    let run = startStage(2);
    run = cmd(run, 'dhcp on').run;
    run = cmd(run, 'ip set dhcp').run;
    run = ticks(run, 2);
    expect(run.world.devices.ops.l3).toMatchObject({ ip: '10.0.1.5', gw: '10.0.1.1' });
    expect(text(cmd(run, 'ping web').lines)).toContain('0% packet loss');
  });

  it('s2-gateway: asking DHCP again on web is an accepted fix, and the mentor may not say it', () => {
    let run = playTo(2, 's2-gateway');
    run = cmd(run, 'ip set dhcp', 'web').run;
    run = ticks(run, 2);
    expect(state(run, 's2-gateway')).toBe('resolved');
    const sc = getStage(2).scenarios.find((s) => s.id === 's2-gateway')!;
    expect(sc.bannedPhrases).toContain('ip set dhcp');
  });

  it('turning DHCP off keeps the leases hosts already have', () => {
    let run = startStage(3);
    run = cmd(run, 'dhcp off').run;
    run = ticks(run, 3);
    expect(run.world.devices.web.l3!.ip).toBe('10.0.1.10');
    expect(ping(run.world, 'ops', 'web').ok).toBe(true);
    // A host asking for a new lease while the desk is closed gets nothing.
    run = cmd(run, 'ip set dhcp', 'spare').run;
    run = ticks(run, 2);
    expect(run.world.devices.spare.l3!.ip).toBeNull();
  });
});

describe('C4 / C17 · s2-conflict follows what is really on the wire', () => {
  it('switching the copycat off clears the conflict', () => {
    let run = playTo(2, 's2-conflict');
    expect(duplicateIps(run.world)).toEqual(['10.0.1.20']);
    run = applyAction(run, (w) => setFeeds(w, 'spare', [])).run;
    expect(duplicateIps(run.world)).toEqual([]);
    const p = ping(run.world, 'web', 'db');
    expect(p).toMatchObject({ ok: true, loss: 0, targetId: 'db' });
    run = ticks(run, 2);
    expect(state(run, 's2-conflict')).toBe('resolved');
  });

  it('unplugging the copycat also clears it', () => {
    let run = playTo(2, 's2-conflict');
    run = applyAction(run, (w) => { delete w.cables.c_spare; }).run;
    run = ticks(run, 2);
    expect(state(run, 's2-conflict')).toBe('resolved');
  });

  it('moving the DB away instead is not accepted ("db" would reach the spare box)', () => {
    let run = playTo(2, 's2-conflict');
    run = cmd(run, 'ip set static 10.0.1.21', 'db').run;
    run = ticks(run, 3);
    expect(ping(run.world, 'web', 'db').targetId).toBe('spare');
    expect(state(run, 's2-conflict')).toBe('active');
    expect(run.health.notes.join(' ')).toContain('엉뚱한 장비');
  });

  it('switching the real DB off is not a fix either', () => {
    let run = playTo(2, 's2-conflict');
    run = applyAction(run, (w) => setFeeds(w, 'db', [])).run;
    run = ticks(run, 3);
    expect(state(run, 's2-conflict')).toBe('active');
  });

  it('moving the copycat onto web\'s address keeps the incident open and the dashboard shows why', () => {
    let run = playTo(2, 's2-conflict');
    run = cmd(run, 'ip set static 10.0.1.10', 'spare').run;
    run = ticks(run, 3);
    expect(state(run, 's2-conflict')).toBe('active');
    // Not a green dashboard with an open incident: students now see web answer only half the time.
    expect(run.health.availability).toBeLessThan(1);
    expect(run.health.notes.join(' ')).toContain('외부(학생) → web 응답이 들쭉날쭉');
  });

  it('a lone unreachable owner still reports a link timeout, not "no such address"', () => {
    const w = networkedWorld();
    w.cables.c_db.broken = true;
    expect(ping(w, 'web', 'db').failure).toBe('link');
  });
});

describe('C9 · svc scale honours the latest request', () => {
  const msa = () => {
    const w = startStage(4).world;
    decompose(w);
    return w;
  };

  it('lowering the target cancels pending installs', () => {
    const w = msa();
    const app = w.app!;
    scaleService(app, 'course', 5);
    expect(app.services.course.installing).toEqual([8, 16, 24, 32]);
    scaleService(app, 'course', 2);
    expect(app.services.course.installing).toEqual([8]);
    for (let i = 0; i < 40; i++) tickApp(w, 1);
    expect(app.services.course.replicas).toBe(2);
  });

  it('raising the target while installing queues after the last install', () => {
    const w = msa();
    const app = w.app!;
    scaleService(app, 'course', 3);
    for (let i = 0; i < 7; i++) tickApp(w, 1);
    scaleService(app, 'course', 5);
    const q = app.services.course.installing;
    expect(q.length).toBe(4);
    expect([...q].sort((a, b) => a - b)).toEqual(q);
    expect(new Set(q).size).toBe(4);
  });
});

describe('C10 / C32 · UPS and A/B feeds each matter for their own fault', () => {
  it('feed B keeps a device on when PDU A trips; A-only devices go dark', () => {
    const w = cabledWorld();
    setFeeds(w, 'web', ['A']);
    setFeeds(w, 'db', ['A', 'B']);
    w.power!.pduDown = 'A';
    expect(powered(w, 'web')).toBe(false);
    expect(powered(w, 'db')).toBe(true);
  });

  it('in a blackout only the UPS-backed line A carries power', () => {
    const w = cabledWorld();
    setFeeds(w, 'web', ['B']);
    setFeeds(w, 'db', ['A']);
    w.power!.mains = false;
    expect(powered(w, 'web')).toBe(false);
    expect(powered(w, 'db')).toBe(true);
  });

  it('the blackout is solved by the UPS alone when servers are on line A', () => {
    let run = playTo(1, 's1-blackout');
    run = applyAction(run, (w) => setUps(w, true)).run;
    run = ticks(run, 2);
    expect(state(run, 's1-blackout')).toBe('resolved');
    expect(SERVERS.every((id) => run.world.devices[id].feeds.join('') === 'A')).toBe(true);
  });

  it('then a PDU trip takes the single-fed servers down until they are dual-fed', () => {
    let run = playTo(1, 's1-pdu');
    expect(run.world.power!.mains).toBe(true);
    expect(SERVERS.some((id) => !powered(run.world, id))).toBe(true);
    expect(powered(run.world, 'sw1')).toBe(true); // dual-fed from the start
    run = ticks(run, 5);
    expect(state(run, 's1-pdu')).toBe('active');
    run = applyAction(run, (w) => SERVERS.forEach((id) => setFeeds(w, id, ['A', 'B']))).run;
    run = ticks(run, 2);
    expect(state(run, 's1-pdu')).toBe('resolved');
    expect(run.world.power!.pduDown).toBeUndefined();
    expect(isCleared(run)).toBe(true);
  });
});

describe('C18 / C26 · s1-cable only fires once the servers are powered', () => {
  it('cabling before power does not fire the incident', () => {
    let run = startStage(1);
    run = applyAction(run, (w) => SERVERS.forEach((id) => mount(w, id))).run;
    run = applyAction(run, (w) => SERVERS.forEach((id, i) => connectCable(w, `${id}:eth0`, `sw1:p${i + 1}`))).run;
    run = ticks(run, 5);
    expect(state(run, 's1-cable')).toBe('waiting');
    expect(run.objectivesDone).not.toHaveProperty('cable');
    run = applyAction(run, (w) => SERVERS.forEach((id) => setFeeds(w, id, ['A']))).run;
    expect(run.objectivesDone).toHaveProperty('cable');
    // The incident follows INCIDENT_GAP seconds after the install is finished.
    run = ticks(run, INCIDENT_GAP - 1);
    expect(state(run, 's1-cable')).toBe('waiting');
    run = ticks(run, 1);
    expect(state(run, 's1-cable')).toBe('active');
    // The alert's premise is true: the other servers are green, only db is dark.
    expect(run.health.services).toMatchObject({ web: 'up', spare: 'up', db: 'degraded' });
  });
});

describe('C19 · natural commands give honest answers', () => {
  it('ping in a stage without IP addresses points to the right tool', () => {
    for (const stage of [5, 6] as StageId[]) {
      const run = startStage(stage);
      const out = text(cmd(run, 'ping srv-db').lines.concat(cmd(run, 'ping n1').lines));
      expect(out).not.toContain('이 장비에 IP 주소가 없어요');
      expect(out).toContain('이 단계에서는');
    }
  });

  it('ping still works in stage 4 (which has a network)', () => {
    const run = startStage(4);
    expect(text(cmd(run, 'ping web').lines)).toContain('0% packet loss');
  });

  it('curl localhost on the web server talks to the app on that machine', () => {
    let run = startStage(3);
    run = cmd(run, 'server start', 'web').run;
    run = cmd(run, 'server set port 80', 'web').run;
    expect(text(cmd(run, 'curl http://localhost/enroll', 'web').lines)).toContain('수강신청 페이지');
    expect(text(cmd(run, 'curl http://127.0.0.1/enroll', 'web').lines)).toContain('수강신청 페이지');
  });

  it('ssh accepts an IP address', () => {
    let run = startStage(2);
    run = cmd(run, 'dhcp on').run;
    run = ticks(run, 1);
    const res = cmd(run, 'ssh 10.0.1.20');
    expect(res.host).toBe('db');
  });
});

describe('C22 · s2-dns needs the real DB address', () => {
  for (const guess of ['10.0.1.10', '10.0.1.5', '10.0.1.1', '10.0.1.30']) {
    it(`a wrong guess (${guess}) does not resolve it`, () => {
      let run = playTo(2, 's2-dns');
      const res = cmd(run, `dns add db ${guess}`);
      expect(text(res.lines)).toContain('참고');
      run = ticks(res.run, 3);
      expect(state(run, 's2-dns')).toBe('active');
    });
  }

  it('the real address does', () => {
    let run = playTo(2, 's2-dns');
    run = cmd(run, 'dns add db 10.0.1.20').run;
    run = ticks(run, 2);
    expect(state(run, 's2-dns')).toBe('resolved');
  });

  it('db is registered from the start, so the incident is what removes it (S1/S5)', () => {
    const run = startStage(2);
    expect(run.world.net!.dns.db).toBe('10.0.1.20');
    const at = playTo(2, 's2-dns');
    expect(at.world.net!.dns.db).toBeUndefined();
  });
});

describe('C24 · s2-conflict bans the Korean name of the culprit', () => {
  it('bans 예비 서버 in both spacings', () => {
    const sc = getStage(2).scenarios.find((s) => s.id === 's2-conflict')!;
    expect(sc.bannedPhrases).toEqual(expect.arrayContaining(['spare', '예비 서버', '예비서버']));
  });
});

describe('C28 · ssh goes over the network like ping', () => {
  it('no address yet → no remote login', () => {
    const run = startStage(2);
    const res = cmd(run, 'ssh web');
    expect(res.host).toBe('ops');
    expect(text(res.lines)).toContain('콘솔');
  });

  it('during s2-dns, ssh by name fails like ping and ssh by address works', () => {
    const run = playTo(2, 's2-dns');
    const byName = cmd(run, 'ssh db');
    expect(byName.host).toBe('ops');
    expect(text(byName.lines)).toContain('Could not resolve hostname db');
    expect(cmd(run, 'ssh 10.0.1.20').host).toBe('db');
  });

  it('during s2-conflict the copycat is unreachable by name; the rack console is the way in', () => {
    const run = playTo(2, 's2-conflict');
    const res = cmd(run, 'ssh spare');
    expect(res.host).toBe('ops');
    expect(text(res.lines)).toContain('콘솔');
    expect(getStage(2).interactions.rack2).toEqual({ kind: 'console', host: 'spare' });
  });

  it('stage 3 ssh web still works', () => {
    const run = startStage(3);
    expect(cmd(run, 'ssh web').host).toBe('web');
  });
});

describe('C38 / S2 / S5 · stage 3 shows each problem only when its incident fires', () => {
  it('after the port fix the dashboard is healthy until the next incident', () => {
    let run = startStage(3);
    expect(run.world.notice).toBeUndefined();
    run = cmd(run, 'server start', 'web').run;
    run = ticks(run, INCIDENT_GAP);
    expect(state(run, 's3-port')).toBe('active');
    run = cmd(run, 'server set port 80', 'web').run;
    run = ticks(run, 2);
    expect(state(run, 's3-port')).toBe('resolved');
    expect(run.health.availability).toBe(1);
    expect(run.health.notes).toEqual([]);
  });

  it('s3-404 posts the notice with the typo', () => {
    const run = playTo(3, 's3-404');
    expect(run.world.notice).toEqual({ url: '/enrol' });
  });

  it('notice commands explain when no notice is up yet', () => {
    const run = startStage(3);
    expect(text(cmd(run, 'notice show').lines)).toContain('아직');
    expect(text(cmd(run, 'notice set /enroll').lines)).toContain('아직');
  });

  for (const stage of [0, 1, 2, 3, 4] as StageId[]) {
    it(`stage ${stage}: perfect play earns 3 stars`, () => {
      const def = getStage(stage);
      let run = startStage(stage);
      const fixed = new Set<string>();
      const errors: string[] = [];
      for (let t = 0; t < 400 && !isCleared(run); t++) {
        run = doObjectives(run);
        run = tickRun(run).run;
        for (const rt of run.scenarios) {
          if (rt.state !== 'active' || fixed.has(rt.id) || run.ctx.stageTime < (rt.activatedAt ?? 0) + 2) continue;
          for (const s of def.scenarios.find((x) => x.id === rt.id)!.solutionSteps) run = apply(run, s, errors);
          fixed.add(rt.id);
        }
      }
      expect(errors).toEqual([]);
      expect(isCleared(run)).toBe(true);
      expect(scoreRun(run).stars).toBe(3);
    });
  }
});

describe('S3 · s3-404 bans catch Korean phrasings of the typo but not the real path', () => {
  const sc = getStage(3).scenarios.find((s) => s.id === 's3-404')!;
  // Same matching as the mentor's guard (worker/src/index.ts): lowercase, collapse spaces, pad, and a
  // leading/trailing space in a phrase means "word edge"; a phrase ending in a digit can't run into more digits.
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ');
  const re = (raw: string) => {
    const p = raw.trim();
    const head = /^\s/.test(raw) ? '(?<![a-z0-9_])' : /^\d/.test(p) ? '(?<![\\d.])' : '';
    const tail = /\s$/.test(raw) ? '(?![a-z0-9_])' : /\d$/.test(p) ? '(?!\\d)' : '';
    return new RegExp(head + esc(p) + tail);
  };
  const leaks = (reply: string) => {
    const r = ` ${norm(reply)} `;
    return sc.bannedPhrases.map(norm).filter((p) => p.trim() !== '').some((p) => re(p).test(r));
  };
  it('blocks the typo with particles and quotes', () => {
    for (const s of ['공지 주소가 /enrol로 되어 있네', '`/enrol` 이랑 비교해봐', "공지 링크가 '/enrol'이네?", '공지 경로가 /enrol.', '공지엔 enrol이라고 적혀 있어']) {
      expect(leaks(s), s).toBe(true);
    }
  });
  it('lets the real path and the hints through', () => {
    expect(leaks('curl 로 /enroll 페이지를 요청해봐')).toBe(false);
    expect(leaks('enroll-app 이 듣는 포트를 봐')).toBe(false);
    for (const h of sc.hints) expect(leaks(h), h).toBe(false);
  });
});

describe('hints never contain their own banned phrases (stages 0–4)', () => {
  for (const stage of [0, 1, 2, 3, 4] as StageId[]) {
    for (const sc of getStage(stage).scenarios) {
      it(sc.id, () => {
        for (const h of sc.hints) {
          for (const p of sc.bannedPhrases) expect(h.toLowerCase().includes(p.toLowerCase()), `${p} in "${h}"`).toBe(false);
        }
      });
    }
  }
});
