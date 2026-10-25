// D-2 (컨테이너 · 링크): the container model behaves like real Docker where the lessons depend on it —
// ports have two sides, data lives in a container's writable layer or on a volume, restart keeps data,
// one host port = one program — and the links: two unbundled cables leave one blocked by STP, LACP makes
// one 20G link, and a loop with STP off on both ends storms the VLAN. Ported from tests/v1/docker.test.ts.
import { describe, expect, it } from 'vitest';
import { getStage } from '../src/content/stages';
import { writeDockerfile } from '../src/sim/actions';
import { appDb, dbRows, ENROLL_DOCKERFILE } from '../src/sim/commands/docker';
import { applyAction, applyCommand, scenarioOf, startStage, tickRun, type StageRun } from '../src/sim/engine';
import {
  campusDelivery,
  lbView,
  logicalLinks,
  poState,
  resolve,
  stpView,
  studentDelivery,
  utilization,
} from '../src/sim/network';
import { initRuntime } from '../src/sim/scenario';
import type { World } from '../src/sim/types';
import { apply, AUTOPLAY, RED } from './autoplay';

const D2 = 3;
// eslint-disable-next-line no-control-regex
const plain = (lines: string[]) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');

const state = (run: StageRun, id: string) => run.scenarios.find((s) => s.id === id)!.state;
const isGreen = (run: StageRun) => run.health.availability === 1 && run.health.notes.length === 0;

function sh(run: StageRun, line: string, host: string) {
  const r = applyCommand(run, line, host);
  return { run: r.run, text: plain(r.lines), failed: r.lines.some((l) => l.startsWith(RED)) };
}

function ios(run: StageRun, host: string, lines: string[]) {
  let mode = { level: 'user' as const } as Parameters<typeof applyCommand>[3];
  const out: string[] = [];
  for (const line of lines) {
    const r = applyCommand(run, line, host, mode);
    run = r.run;
    mode = r.mode;
    out.push(...r.lines);
  }
  return { run, text: plain(out) };
}

function ticks(run: StageRun, n: number): StageRun {
  for (let i = 0; i < n; i++) run = tickRun(run).run;
  return run;
}

/** Do these missions the AUTOPLAY way. */
function missions(...ids: string[]): StageRun {
  let run = startStage(D2);
  for (const id of ids) for (const st of AUTOPLAY[D2][id]) run = apply(run, st, null);
  return run;
}

/** Run only this incident from now on: it fires on the next tick. */
function only(run: StageRun, id: string): StageRun {
  run = { ...run, scenarios: initRuntime([{ id, trigger: { type: 'stageStart', delay: run.ctx.stageTime + 1, overlap: true } }]) };
  for (let i = 0; i < 5 && run.scenarios[0].state === 'waiting'; i++) run = tickRun(run).run;
  expect(run.scenarios[0].state, id).toBe('active');
  return run;
}

function solve(run: StageRun, id: string): StageRun {
  const errors: string[] = [];
  for (const st of scenarioOf(getStage(D2), id).solutionSteps) run = apply(run, st, errors);
  expect(errors).toEqual([]);
  return run;
}

/** The deploy log is read, the board is done and the image is built and pushed. */
const readyToRun = () => missions('log', 'recipe', 'image');
/** Every docker mission done: the app runs on APP-01, the DB is on a volume. */
const dockerDone = () => missions('log', 'recipe', 'image', 'run', 'volume');

const torLinks = (w: World) => logicalLinks(w).filter((l) => l.key.includes('TOR-01:Te') || l.key.includes('TOR-01:Po'));

describe('D-2 starting world', () => {
  it('has the second TOR-01 → CORE-01 cable, unbundled, so spanning tree blocks it', () => {
    const run = startStage(D2);
    const w = run.world;
    expect(w.cables['tor1-up2']).toBeDefined();
    expect(w.devices['TOR-01'].nd!.ifs.Po1).toBeUndefined();
    expect(w.devices['CORE-01'].nd!.ifs.Po1).toBeUndefined();
    expect(stpView(w, 10).blocked.has('TOR-01:Te1/1/2')).toBe(true);
    // Both cables are up, but only one carries traffic.
    expect(torLinks(w).filter((l) => l.key.startsWith('CORE-01') && l.up).map((l) => l.capMbps)).toEqual([10000, 10000]);
    expect(w.devices['TOR-01'].nd!.dirty).toBe(false);
  });

  it('starts with no k8s, the L4 pointed at APP-01:80 (/health), and a DB without a volume', () => {
    const w = startStage(D2).world;
    expect(w.k8s).toBeUndefined();
    expect(w.net!.lb!.members.map((m) => `${m.host}:${m.port}`)).toEqual(['srv-new:80']);
    expect(w.net!.lb!.health).toEqual({ proto: 'http', port: 80, path: '/health' });
    expect(appDb(w)!.volume).toBeNull();
    expect(dbRows(w, appDb(w)!)).toBe(1520);
  });

  it('later days keep the bundle (only D-2 and earlier lose it)', () => {
    for (const d of [4, 5] as const) expect(poState(startStage(d).world, 'TOR-01', 1).members.map((m) => m.flag)).toEqual(['P', 'P']);
    expect(startStage(2).world.devices['TOR-01'].nd!.ifs.Po1).toBeUndefined();
  });
});

describe('docker run: both sides of -p', () => {
  it('-p 80:80 is not reachable (the app listens on 8000): the L4 sees it DOWN and d2-port fires', () => {
    let run = readyToRun();
    const r = sh(run, 'docker run -p 80:80 enroll:1.0', 'srv-new');
    expect(r.failed).toBe(false);
    // The run only says what was connected; spotting the wrong inner port is the incident's job.
    expect(r.text).toContain('(바깥 80번 → 컨테이너 안 80번)');
    expect(r.text).not.toMatch(/주의|없어요/);
    run = ticks(r.run, 6);
    expect(lbView(run.world).members[0].healthy).toBe(false);
    expect(sh(run, 'curl http://sugang/enroll', 'ops').text).toContain('503');
    expect(state(run, 'd2-port:0')).toBe('active');
    expect(run.objectivesDone).not.toHaveProperty('run');
    run = ticks(solve(run, 'd2-port:0'), 2);
    expect(state(run, 'd2-port:0')).toBe('resolved');
    expect(run.objectivesDone).toHaveProperty('run');
  });

  it.each(['--publish 80:8000', '--publish=80:8000', '-p=80:8000', '-dp 80:8000', '-d -p 0.0.0.0:80:8000/tcp', '-p80:8000', '-itdp 80:8000', '-e DEBUG=1 -p 80:8000'])('accepts %s', (opt) => {
    let run = readyToRun();
    const r = sh(run, `docker run ${opt} enroll:1.0`, 'srv-new');
    expect(r.failed, r.text).toBe(false);
    expect(r.text).not.toContain('포트 연결 없이');
    run = ticks(r.run, 6);
    expect(run.world.docker!.containers.find((c) => c.host === 'srv-new')!.ports).toEqual([80, 8000]);
    expect(state(run, 'd2-port:0')).toBe('waiting');
    expect(run.objectivesDone).toHaveProperty('run');
    expect(sh(run, 'curl http://sugang/enroll', 'ops').text).toContain('수강신청 페이지');
  });

  it('rejects unknown options and docker options written after the image', () => {
    const run = readyToRun();
    for (const line of ['docker run --publsh 80:8000 enroll:1.0', 'docker run enroll:1.0 -p 80:8000', 'docker run -p 127.0.0.1:80:8000 enroll:1.0', 'docker run -p 80 enroll:1.0']) {
      const r = sh(run, line, 'srv-new');
      expect(r.failed, line).toBe(true);
      expect(r.run.world.docker!.containers.some((c) => c.host === 'srv-new'), line).toBe(false);
    }
  });

  it('a working published container resolves d2-port even with a leftover unpublished one', () => {
    let run = readyToRun();
    run = ticks(sh(run, 'docker run enroll:1.0', 'srv-new').run, 3);
    expect(state(run, 'd2-port:0')).toBe('active');
    const r = sh(run, 'docker run -p 80:8000 --name e2 enroll:1.0', 'srv-new');
    expect(r.failed, r.text).toBe(false);
    run = ticks(r.run, 3);
    expect(state(run, 'd2-port:0')).toBe('resolved');
  });

  it('a correct container next to a stray one never fires d2-port', () => {
    let run = readyToRun();
    run = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-new').run;
    run = ticks(sh(run, 'docker run --name e2 enroll:1.0', 'srv-new').run, 3);
    expect(state(run, 'd2-port:0')).toBe('waiting');
  });

  it('refuses a second container on a host port that is already taken', () => {
    let run = readyToRun();
    run = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-new').run;
    const r = sh(run, 'docker run -p 80:8000 --name e2 enroll:1.0', 'srv-new');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('port is already allocated');
    expect(r.run.world.docker!.containers.filter((c) => c.host === 'srv-new')).toHaveLength(1);
  });

  it('the failed hand install is in APP-01’s deploy log, and its Python differs from WEB-01’s', () => {
    const run = startStage(D2);
    const log = sh(run, 'deploy log', 'srv-new');
    expect(log.text).toContain('3.9.18');
    expect(log.run.ctx.events).toContain('deploy_log_failed');
    expect(sh(run, 'python --version', 'web').text).toContain('3.12');
  });
});

describe('docker data model', () => {
  it('restart and stop/start keep the writable layer; only removing the container loses it', () => {
    let run = startStage(D2);
    const rows = (r: StageRun) => dbRows(r.world, appDb(r.world)!);
    let r = sh(run, 'docker restart db', 'srv-db');
    expect(r.text).toContain('데이터는 그대로');
    run = r.run;
    expect(rows(run)).toBe(1520);
    run = sh(run, 'docker stop db', 'srv-db').run;
    expect(appDb(run.world)).toBeUndefined();
    expect(run.health.notes.join()).toContain('DB 응답 없음');
    expect(sh(run, 'docker container ls -a', 'srv-db').text).toContain('Exited');
    run = sh(run, 'docker start db', 'srv-db').run;
    expect(rows(run)).toBe(1520);
    r = sh(run, 'docker rm db', 'srv-db');
    expect(r.failed).toBe(true);
    r = sh(run, 'docker rm -f db', 'srv-db');
    expect(r.text).toContain('데이터도 컨테이너와 함께 지워졌어요');
    r = sh(r.run, 'docker run -p 3306:3306 --name db mysql:8', 'srv-db');
    expect(r.failed).toBe(false);
    expect(rows(r.run)).toBe(0);
    expect(sh(r.run, 'docker logs db', 'srv-db').text).toContain('Table enrollments is empty');
  });

  it('a volume keeps data when the container is removed and recreated', () => {
    let run = startStage(D2);
    run = sh(run, 'docker rm -f db', 'srv-db').run;
    let r = sh(run, 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql mysql:8', 'srv-db');
    expect(r.text).toContain('백업을 볼륨 dbdata 에 복원');
    r = sh(r.run, 'docker rm -f mysql', 'srv-db');
    r = sh(r.run, 'docker run -p 3306:3306 --volume dbdata:/var/lib/mysql/:rw --name other mysql:8', 'srv-db');
    expect(r.failed, r.text).toBe(false);
    expect(r.text).not.toContain('복원');
    expect(dbRows(r.run.world, appDb(r.run.world)!)).toBe(1520);
    expect(sh(r.run, 'docker logs other', 'srv-db').text).toContain('volume:dbdata');
  });

  it('the volume mission needs the data folder: a volume on another folder does not count', () => {
    let run = missions('log', 'recipe', 'image', 'run');
    run = sh(run, 'docker rm -f db', 'srv-db').run;
    run = sh(run, 'docker run -p 3306:3306 -v dbdata:/tmp --name db mysql:8', 'srv-db').run;
    expect(run.objectivesDone).not.toHaveProperty('volume');
    run = sh(run, 'docker rm -f db', 'srv-db').run;
    run = sh(run, 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8', 'srv-db').run;
    expect(run.objectivesDone).toHaveProperty('volume');
  });

  it('player-typed names never hit Object.prototype', () => {
    const run = startStage(D2);
    let r = sh(run, 'docker rm -f db', 'srv-db');
    r = sh(r.run, 'docker run -p 3306:3306 -v constructor:/var/lib/mysql --name toString mysql:8', 'srv-db');
    expect(r.failed, r.text).toBe(false);
    expect(dbRows(r.run.world, appDb(r.run.world)!)).toBe(1520);
    expect(sh(r.run, 'docker logs __proto__', 'srv-db').failed).toBe(true);
    expect(sh(r.run, 'docker volume create __proto__', 'srv-db').failed).toBe(true);
  });
});

describe('d2-volume: the update script recreates the DB without its volume', () => {
  const atIncident = () => only(dockerDone(), 'd2-volume:0');

  it('the new container is empty, the volume still holds the data', () => {
    const run = atIncident();
    const db = appDb(run.world)!;
    expect(db.volume).toBeNull();
    expect(dbRows(run.world, db)).toBe(0);
    expect(run.world.docker!.hosts['srv-db'].volumes.dbdata).toBe(1520);
    expect(run.health.notes).toContain('신청 내역 0건! 데이터 유실');
  });

  it('restart does not fix it; reattaching the volume does', () => {
    let run = atIncident();
    run = ticks(sh(run, 'docker restart db', 'srv-db').run, 2);
    expect(run.scenarios[0].state).toBe('active');
    run = ticks(solve(run, 'd2-volume:0'), 2);
    expect(run.scenarios[0].state).toBe('resolved');
    expect(dbRows(run.world, appDb(run.world)!)).toBe(1520);
  });

  it('dashboard green ⇔ incident resolved, over many player attempts', () => {
    const attempts: [string, string][][] = [
      [['docker restart db', 'srv-db']],
      [['docker run -p 3306:3306 -v dbdata:/var/lib/mysql mysql:8', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 --name db mysql:8', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 -v dbdata:/tmp mysql:8', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name x mysql:8', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 -v fresh:/var/lib/mysql --name db mysql:8', 'srv-db']],
    ];
    for (const steps of attempts) {
      let run = atIncident();
      for (const [line, host] of steps) {
        run = ticks(sh(run, line, host).run, 2);
        const resolvedNow = run.scenarios[0].state === 'resolved';
        if (isGreen(run)) expect(resolvedNow, steps.map((s) => s[0]).join(' → ')).toBe(true);
      }
    }
  });
});

describe('d2-deploy: a bad release on APP-01', () => {
  it('the container runs a new tag that answers 500; running the morning tag again fixes it', () => {
    let run = only(dockerDone(), 'd2-deploy:0');
    expect(sh(run, 'docker ps', 'srv-new').text).toContain('enroll:1.1');
    expect(sh(run, 'docker logs enroll', 'srv-new').text).toContain('500 Internal Server Error');
    expect(run.health.availability).toBeLessThan(0.5);
    run = ticks(solve(run, 'd2-deploy:0'), 2);
    expect(run.scenarios[0].state).toBe('resolved');
    expect(sh(run, 'docker logs enroll', 'srv-new').text).not.toContain('500');
  });

  it('never "breaks" with the tag that is already running', () => {
    let run = readyToRun();
    run = sh(run, 'docker build -t enroll:1.1 .', 'ops').run;
    run = sh(run, 'docker push enroll:1.1', 'ops').run;
    run = sh(run, 'docker run -p 80:8000 enroll:1.1', 'srv-new').run;
    run = only(run, 'd2-deploy:0');
    expect(run.world.docker!.containers.find((c) => c.host === 'srv-new')!.image).toBe('enroll:1.2');
  });
});

describe('d2-uplink: the load test fills one 10G uplink; LACP makes it 20G', () => {
  const atIncident = () => only(dockerDone(), 'd2-uplink:0');

  it('one cable carries everything while the other is blocked, and pages get slow', () => {
    const run = atIncident();
    const w = run.world;
    const busy = torLinks(w).filter((l) => utilization(w, l.key) > 1);
    expect(busy.map((l) => l.key)).toEqual(['CORE-01:Te1/0/3~TOR-01:Te1/1/1']);
    expect(studentDelivery(w).notes).toContain('수강신청 응답이 느려요');
    expect(studentDelivery(w).ok).toBeLessThan(0.9);
    expect(ios(run, 'TOR-01', ['enable', 'show spanning-tree vlan 10']).text).toMatch(/Te1\/1\/2\s+Altn BLK/);
  });

  it('bundling one side only does not help (members suspended, traffic detours via CORE-02)', () => {
    let run = atIncident();
    run = ios(run, 'TOR-01', ['enable', 'configure terminal', 'interface range te1/1/1 - 2', 'channel-group 1 mode active', 'end']).run;
    run = ticks(run, 2);
    expect(poState(run.world, 'TOR-01', 1).members.map((m) => m.flag)).toEqual(['s', 's']);
    expect(run.scenarios[0].state).toBe('active');
  });

  it('bundling both ends forms Po1 at 20G and resolves it; the summary shows both members P', () => {
    let run = ticks(solve(atIncident(), 'd2-uplink:0'), 2);
    expect(run.scenarios[0].state).toBe('resolved');
    const po = logicalLinks(run.world).find((l) => l.key === 'CORE-01:Po1~TOR-01:Po1')!;
    expect(po.capMbps).toBe(20000);
    expect(utilization(run.world, po.key)).toBeLessThan(0.9);
    expect(ios(run, 'TOR-01', ['enable', 'show etherchannel summary']).text).toMatch(/Po1\(SU\)\s+LACP\s+Te1\/1\/1\(P\)\s+Te1\/1\/2\(P\)/);
    const logs = run.world.devices['TOR-01'].nd!.log.map((e) => e.tag);
    expect(logs).toContain('EC-5-BUNDLE');
  });
});

describe('d2-storm: a loop with STP off on both ends', () => {
  const atIncident = (v = 0) => only(dockerDone(), `d2-storm:${v}`);

  it('storms VLAN 50: names and new campus addresses fail, links fill up, MAC flaps in the log', () => {
    let run = atIncident();
    run = ticks(run, 3);
    const w = run.world;
    expect(w.net!.storm).toEqual([50]);
    expect(resolve(w, 'sugang', 'ops').ip).toBeNull();
    expect(campusDelivery(w).ok).toBeLessThan(0.5);
    expect(w.devices['TOR-01'].nd!.log.some((e) => e.tag === 'SW_MATM-4-MACFLAP_NOTIF')).toBe(true);
    expect(ios(run, 'TOR-01', ['enable', 'show spanning-tree vlan 50']).text).toContain('does not exist');
  });

  it.each([['TOR-01'], ['TOR-02']])('turning STP back on for VLAN 50 on %s alone ends it', (tor) => {
    let run = atIncident(1);
    run = ios(run, tor, ['enable', 'configure terminal', 'spanning-tree vlan 50', 'end']).run;
    run = ticks(run, 2);
    expect(run.world.net!.storm).toEqual([]);
    expect(run.scenarios[0].state).toBe('resolved');
    expect(resolve(run.world, 'sugang', 'ops').ip).not.toBeNull();
  });

  it('only cutting the loop (shutting the stray port) stops the storm but STP is still off: not resolved yet', () => {
    let run = atIncident();
    run = ios(run, 'TOR-01', ['enable', 'configure terminal', 'interface gi1/0/12', 'shutdown', 'end']).run;
    run = ticks(run, 2);
    expect(run.world.net!.storm).toEqual([]);
    expect(run.scenarios[0].state).toBe('active');
    run = ticks(solve(run, 'd2-storm:0'), 2);
    expect(run.scenarios[0].state).toBe('resolved');
  });
});

describe('docker build', () => {
  it('prints the same Dockerfile as the design board, WORKDIR and EXPOSE included', () => {
    let run = startStage(D2);
    run = applyAction(run, (w) => writeDockerfile(w, 'enroll')).run;
    const r = sh(run, 'docker build -t enroll:1.0 .', 'ops');
    expect(r.failed).toBe(false);
    for (const [i, line] of ENROLL_DOCKERFILE.entries()) expect(r.text).toContain(`Step ${i + 1}/${ENROLL_DOCKERFILE.length} : ${line}`);
    expect(ENROLL_DOCKERFILE.map((l) => l.split(' ')[0])).toEqual(['FROM', 'WORKDIR', 'COPY', 'RUN', 'EXPOSE', 'CMD']);
  });

  it('only builds on the admin PC, so a server always gets the image through the registry', () => {
    let run = readyToRun();
    const r = sh(run, 'docker build -t enroll:2.0 .', 'srv-new');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('관리 PC');
    expect(sh(r.run, 'docker run -p 80:8000 enroll:2.0', 'srv-new').failed).toBe(true);
    run = sh(run, 'docker build -tenroll:3.0 .', 'ops').run;
    expect(run.world.docker!.built).toContain('enroll:3.0');
  });

  it('names the finished recipe when the image name does not match it', () => {
    let run = startStage(D2);
    run = applyAction(run, (w) => writeDockerfile(w, 'enroll')).run;
    const r = sh(run, 'docker build -t khu-enroll:1.0 .', 'ops');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('완성한 레시피: enroll');
    expect(sh(startStage(D2), 'docker build -t enroll:1.0 .', 'ops').text).toContain('설계 보드');
  });
});

describe('container names, ids and hosts', () => {
  it('an exact name wins over an id prefix, and an ambiguous id prefix matches nothing', () => {
    let run = readyToRun();
    run = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-new').run;
    run = sh(run, 'docker run --name cc enroll:1.0', 'srv-new').run;
    run = sh(run, 'docker run --name e3 enroll:1.0', 'srv-new').run;
    const ids = run.world.docker!.containers.filter((c) => c.host === 'srv-new').map((c) => c.id);
    expect(ids.every((id) => id.startsWith('cc'))).toBe(true);
    const r = sh(run, 'docker rm -f cc', 'srv-new');
    expect(r.run.world.docker!.containers.filter((c) => c.host === 'srv-new').map((c) => c.name)).toEqual(['enroll', 'e3']);
    expect(sh(run, 'docker logs ccc', 'srv-new').failed).toBe(true);
    expect(sh(run, `docker logs ${ids[0].slice(0, 10)}`, 'srv-new').text).toContain('Running on');
  });

  it('container commands on the admin PC point to a server; servers without Docker say so', () => {
    const run = startStage(D2);
    for (const line of ['docker logs db', 'docker rm -f db', 'docker stop db']) expect(sh(run, line, 'ops').text, line).toContain('서버에 ssh 로 접속');
    expect(sh(run, 'docker ps', 'ops').text).toContain('관리 PC에는 컨테이너가 없어요');
    expect(sh(run, 'docker ps', 'web').text).toContain('Docker가 설치돼 있지 않아요');
  });

  it('docker is a D-2 tool: the next day has no docker command', () => {
    expect(sh(startStage(4), 'docker ps', 'ops').text).toContain('오늘은 쓰지 않는');
  });
});

describe('the day’s fixed incidents', () => {
  it('the load test starts after the docker missions, the storm after the bundle is saved', () => {
    let run = dockerDone();
    for (let i = 0; i < 40 && state(run, 'd2-uplink:0') !== 'active'; i++) run = tickRun(run).run;
    expect(state(run, 'd2-uplink:0')).toBe('active');
    expect(run.world.traffic.rps).toBe(8000);
    run = ticks(solve(run, 'd2-uplink:0'), 2);
    expect(state(run, 'd2-uplink:0')).toBe('resolved');
    const storm = run.scenarios.find((s) => s.id.startsWith('d2-storm'))!.id;
    run = ticks(run, 30);
    expect(state(run, storm), 'waits for the lacp mission').toBe('waiting');
    for (const st of AUTOPLAY[D2].lacp) run = apply(run, st, null);
    expect(run.objectivesDone).toHaveProperty('lacp');
    for (let i = 0; i < 40 && state(run, storm) !== 'active'; i++) run = tickRun(run).run;
    run = ticks(solve(run, storm), 2);
    expect(state(run, storm)).toBe('resolved');
    expect(isGreen(run)).toBe(true);
  });
});
