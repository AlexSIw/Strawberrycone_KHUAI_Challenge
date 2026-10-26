// How a player completes each day's missions, and how a test plays a whole day.
// (Not a test file itself: vitest only collects tests/**/*.test.ts.)
import { SERVERS } from '../src/content/topology';
import { getStage } from '../src/content/stages';
import { applyDesired, connectCable, decompose, mount, setFeeds, writeDockerfile } from '../src/sim/actions';
import {
  ackAlarm,
  applyAction,
  applyCommand,
  isCleared,
  recordEvents,
  scenarioOf,
  startStage,
  tickRun,
  visibleObjectives,
  type StageRun,
} from '../src/sim/engine';
import type { SolutionStep } from '../src/sim/scenario';
import type { IosMode, StageId, World } from '../src/sim/types';

export type Step =
  | { cmd: string; host: string }
  /** IOS keystrokes on a network device, starting at its `>` prompt (as after ssh / the console) */
  | { ios: string[]; host: string }
  | { action: Parameters<typeof applyAction>[1]; events?: string[] }
  | { events: string[] };

export const RED = '\x1b[31m';

/** The three servers D-5 installs. */
const D5 = ['web', 'web2', 'db'];

/** How a player completes each mission, per day. Each day's owner fills in its own entry. */
export const AUTOPLAY: Record<number, Record<string, Step[]>> = {
  // D-5 (WP5): mini-games are world actions, the NOC looks are events. Each window is opened first
  // (`open:…`), as a player does, so the first-time guides tick in order.
  0: {
    tour: [{ events: ['room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc'] }],
    quiz: [{ events: ['open:quiz', 'quiz:correct'] }],
    mount: [{ events: ['open:rack'] }, ...D5.map((id) => ({ action: (w: World) => mount(w, id), events: ['rack:mount'] }))],
    power: [
      { events: ['open:power'] },
      { action: (w) => D5.forEach((id) => setFeeds(w, id, ['A'])), events: ['power:feed'] },
      { action: (w) => D5.forEach((id) => setFeeds(w, id, ['A', 'B'])), events: ['power:feed'] },
    ],
    cable: [
      { events: ['open:cable'] },
      ...D5.map((id) => ({ action: (w: World) => connectCable(w, `${id}:eth0`, `TOR-01:${SERVERS[id][5]}`), events: ['cable:connect'] })),
    ],
    leds: [{ events: ['open:noc'] }, { events: ['noc:nms'] }, { events: ['noc:device:TOR-01'] }],
    fms: [{ events: ['noc:fms'] }],
  },
  // D-4 (WP5): IOS from the `>` prompt, as after `ssh TOR-01`. Each device is reached from the 관리 PC first.
  1: {
    ssh: [{ events: ['open:terminal'] }, { cmd: 'ssh TOR-01', host: 'ops' }],
    vlan: [{ ios: ['enable', 'configure terminal', 'vlan 10', 'name WEB', 'exit', 'vlan 20', 'name DB', 'end'], host: 'TOR-01' }],
    ports: [
      {
        ios: ['enable', 'configure terminal', 'interface gi1/0/1', 'switchport access vlan 10', 'interface gi1/0/2', 'switchport access vlan 10', 'interface gi1/0/3', 'switchport access vlan 20', 'end'],
        host: 'TOR-01',
      },
    ],
    gateway: [
      { cmd: 'ssh CORE-01', host: 'ops' },
      {
        ios: [
          'enable',
          'configure terminal',
          'interface vlan 10',
          'ip address 10.10.10.2 255.255.255.0',
          'standby 1 ip 10.10.10.1',
          'no shutdown',
          'interface vlan 20',
          'ip address 10.10.20.2 255.255.255.0',
          'standby 1 ip 10.10.20.1',
          'no shutdown',
          'end',
        ],
        host: 'CORE-01',
      },
    ],
    dns: [
      { cmd: 'ssh ns1', host: 'ops' },
      { cmd: 'dns add web 10.10.10.11', host: 'ns1' },
      { cmd: 'dns add db 10.10.20.11', host: 'ns1' },
    ],
    dhcp: [
      { cmd: 'ssh dhcp01', host: 'ops' },
      { cmd: 'dhcp pool list', host: 'dhcp01' },
    ],
    wr: [
      { ios: ['enable', 'write memory'], host: 'TOR-01' },
      { cmd: 'ssh CORE-01', host: 'ops' },
      { ios: ['enable', 'write memory'], host: 'CORE-01' },
    ],
  },
  // D-3 (WP5)
  2: {
    start: [
      { cmd: 'ssh web', host: 'ops' },
      { cmd: 'server start', host: 'web' },
    ],
    port: [
      { cmd: 'server status', host: 'web' },
      { cmd: 'server set port 80', host: 'web' },
    ],
    l4: [
      { cmd: 'ssh L4-01', host: 'ops' },
      { cmd: 'lb pool add web 80', host: 'L4-01' },
      { cmd: 'lb health set path /health', host: 'L4-01' },
    ],
    curl: [
      { cmd: 'curl http://web/enroll', host: 'ops' },
      { cmd: 'curl http://sugang/enroll', host: 'ops' },
    ],
    sms: [{ events: ['noc:sms'] }],
    msa: [{ events: ['open:board'] }, { action: decompose, events: ['board:decompose'] }],
  },
  // D-2 (WP6): containers on APP-01 / DB-02; the bundle itself is the load-test incident's fix.
  // The rows follow the missions' first-time guides (steps), ssh and exit included.
  3: {
    log: [
      { cmd: 'ssh srv-new', host: 'ops' },
      { cmd: 'deploy log', host: 'srv-new' },
    ],
    recipe: [{ action: (w) => writeDockerfile(w, 'enroll'), events: ['board:dockerfile'] }],
    image: [
      { cmd: 'exit', host: 'srv-new' },
      { cmd: 'docker build -t enroll:1.0 .', host: 'ops' },
      { cmd: 'docker push enroll:1.0', host: 'ops' },
    ],
    run: [
      { cmd: 'ssh srv-new', host: 'ops' },
      { cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' },
    ],
    volume: [
      { cmd: 'ssh srv-db', host: 'ops' },
      { cmd: 'docker ps', host: 'srv-db' },
      { cmd: 'docker rm -f db', host: 'srv-db' },
      { cmd: 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8', host: 'srv-db' },
    ],
    lacp: [
      { ios: ['enable', 'show etherchannel summary', 'write memory'], host: 'TOR-01' },
      { ios: ['enable', 'write memory'], host: 'CORE-01' },
    ],
  },
  // D-1 (WP6): the cluster, CORE-02 as HSRP standby, the redundancy checklist.
  4: {
    desired: [{ action: (w) => applyDesired(w, 'enroll', 3, 'enroll:v1'), events: ['board:desired'] }],
    observe: [{ cmd: 'pods', host: 'ops' }],
    hsrp: [
      { cmd: 'ssh CORE-02', host: 'ops' },
      {
        ios: [
          'enable',
          'configure terminal',
          'interface vlan 10',
          'ip address 10.10.10.3 255.255.255.0',
          'standby 1 ip 10.10.10.1',
          'standby 1 priority 100',
          'standby 1 preempt',
          'no shutdown',
          'interface vlan 40',
          'ip address 10.10.40.3 255.255.255.0',
          'standby 1 ip 10.10.40.1',
          'standby 1 priority 100',
          'standby 1 preempt',
          'no shutdown',
          'end',
          'write memory',
        ],
        host: 'CORE-02',
      },
    ],
    uncordon: [
      { cmd: 'nodes', host: 'ops' },
      { cmd: 'uncordon n1', host: 'ops' },
      { cmd: 'uncordon n2', host: 'ops' },
    ],
    checklist: [
      { ios: ['enable', 'show standby brief'], host: 'CORE-02' },
      { ios: ['enable', 'show etherchannel summary'], host: 'TOR-01' },
      { events: ['noc:fms'] },
    ],
  },
  // D-Day (WP7): the pre-check, then the clock; the postmortem board is a UI event.
  5: {
    noc: [{ events: ['open:noc', 'noc:nms'] }],
    hsrp: [
      { cmd: 'ssh CORE-01', host: 'ops' },
      { ios: ['show standby brief'], host: 'CORE-01' },
    ],
    l4: [
      { cmd: 'ssh L4-01', host: 'ops' },
      { cmd: 'lb status', host: 'L4-01' },
    ],
    postmortem: [{ events: ['board:postmortem'] }],
  },
};

/** Mission steps may print expected errors (e.g. a refused curl); solution steps must not (errors: non-null). */
export function apply(run: StageRun, step: Step | SolutionStep, errors: string[] | null): StageRun {
  if ('ios' in step) {
    let mode: IosMode | null = { level: 'user' };
    for (const line of step.ios) {
      const res = applyCommand(run, line, step.host, mode);
      const bad = res.lines.filter((l) => l.startsWith(RED));
      if (bad.length && errors) errors.push(`${step.host}> ${line} → ${bad.join(' | ')}`);
      run = res.run;
      mode = res.mode;
    }
    return run;
  }
  if ('cmd' in step) {
    const res = applyCommand(run, step.cmd, step.host);
    const bad = res.lines.filter((l) => l.startsWith(RED));
    if (bad.length && errors) errors.push(`${step.host}$ ${step.cmd} → ${bad.join(' | ')}`);
    return res.run;
  }
  if ('action' in step) return applyAction(run, step.action, 'events' in step ? step.events ?? [] : []).run;
  return recordEvents(run, step.events).run;
}

export interface DayReport {
  run: StageRun;
  cleared: boolean;
  /** Red output from solution steps */
  errors: string[];
  /** Incidents that were already fine when they fired (the inject didn't break anything) */
  notBroken: string[];
  /** Incidents still not resolved 10 s after their solution ran */
  unsolved: string[];
  /** Polled alarms that showed up off a poll boundary */
  offPoll: string[];
}

/**
 * Play a day like a prompt player: do each visible mission's AUTOPLAY steps, ACK each alarm 2 s after it
 * shows up, run the incident's solution 2 s after that.
 */
export function playDay(day: StageId, seed = 1, maxTicks = 900): DayReport {
  const def = getStage(day);
  let run = startStage(day, seed);
  const errors: string[] = [];
  const notBroken: string[] = [];
  const solvedAt = new Map<string, number>();
  const offPoll: string[] = [];
  for (let i = 0; i < maxTicks && !isCleared(run); i++) {
    for (const o of visibleObjectives(def, run)) {
      if (o.id in run.objectivesDone) continue;
      for (const st of AUTOPLAY[day]?.[o.id] ?? []) run = apply(run, st, null);
    }
    const t = tickRun(run);
    run = t.run;
    for (const id of t.activated) {
      if (scenarioOf(def, id).check(run.world, run.ctx, run.health)) notBroken.push(id);
    }
    for (const id of t.raised) {
      const a = run.alarms.find((x) => x.id === id)!;
      if (a.source === 'poll' && a.raisedAt % (def.pollEvery ?? 15) !== 0) offPoll.push(id);
    }
    const now = run.ctx.stageTime;
    for (const a of run.alarms) {
      if (a.ackAt === null && a.clearedAt === null && now >= a.raisedAt + 2) run = ackAlarm(run, a.id);
    }
    for (const a of run.alarms) {
      const r = run.scenarios.find((x) => x.id === a.scenarioId);
      if (!r || r.state !== 'active' || a.ackAt === null || solvedAt.has(r.id) || now < a.ackAt + 2) continue;
      for (const st of scenarioOf(def, r.id).solutionSteps) run = apply(run, st, errors);
      solvedAt.set(r.id, now);
    }
  }
  const unsolved = run.scenarios
    .filter((r) => r.state === 'active' && solvedAt.has(r.id) && run.ctx.stageTime > solvedAt.get(r.id)! + 10)
    .map((r) => r.id);
  return { run, cleared: isCleared(run), errors, notBroken, unsolved, offPoll };
}
