// Stage 5 (Docker): the container model behaves like real Docker where the lessons depend on it —
// ports have two sides, data lives in a container's writable layer or on a volume, restart keeps data,
// one host port = one program — and the dashboard agrees with the incidents.
import { describe, expect, it } from 'vitest';
import { getStage } from '../../src/content/stages';
import { writeDockerfile } from '../../src/sim/actions';
import { appDb, dbRows, ENROLL_DOCKERFILE } from '../../src/sim/commands/docker';
import { applyAction, applyCommand, isCleared, startStage, tickRun, type StageRun } from '../../src/sim/engine';

const RED = '\x1b[31m';
// eslint-disable-next-line no-control-regex
const plain = (lines: string[]) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');

const state = (run: StageRun, id: string) => run.scenarios.find((s) => s.id === id)!.state;
const isGreen = (run: StageRun) => run.health.availability === 1 && run.health.notes.length === 0;

function sh(run: StageRun, line: string, host: string) {
  const r = applyCommand(run, line, host);
  return { run: r.run, text: plain(r.lines), failed: r.lines.some((l) => l.startsWith(RED)) };
}

function ticks(run: StageRun, n: number): StageRun {
  for (let i = 0; i < n; i++) run = tickRun(run).run;
  return run;
}

/** s5-drift has fired, the deploy log is read, the board is done and the image is built and pushed. */
function readyToRun(): StageRun {
  let run = startStage(5);
  // The failed hand deploy (and its log) only exists once s5-drift has fired.
  for (let i = 0; i < 60 && state(run, 's5-drift') !== 'active'; i++) run = tickRun(run).run;
  expect(state(run, 's5-drift')).toBe('active');
  run = sh(run, 'deploy log', 'srv-new').run;
  run = applyAction(run, (w) => writeDockerfile(w, 'enroll'), ['board:dockerfile']).run;
  run = sh(run, 'docker build -t enroll:1.0 .', 'ops').run;
  run = sh(run, 'docker push enroll:1.0', 'ops').run;
  return run;
}

/** Play until s5-volume has just fired (s5-drift solved with a correctly published container). */
function atVolumeIncident(): StageRun {
  let run = readyToRun();
  run = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-new').run;
  for (let i = 0; i < 60 && state(run, 's5-volume') !== 'active'; i++) run = tickRun(run).run;
  expect(state(run, 's5-volume')).toBe('active');
  return run;
}

describe('docker run: both sides of -p', () => {
  it('-p 80:80 is not reachable (the app listens on 8000) and fires s5-port', () => {
    let run = readyToRun();
    const r = sh(run, 'docker run -p 80:80 enroll:1.0', 'srv-new');
    expect(r.failed).toBe(false);
    // The run only says what was connected; spotting the wrong inner port is the incident's job.
    expect(r.text).toContain('(바깥 80번 → 컨테이너 안 80번)');
    expect(r.text).not.toMatch(/주의|없어요/);
    run = ticks(r.run, 6);
    expect(state(run, 's5-port')).toBe('active');
    expect(run.health.availability).toBeLessThan(1);
    const def = getStage(5).scenarios.find((s) => s.id === 's5-port')!;
    for (const s of def.solutionSteps) if ('cmd' in s) run = sh(run, s.cmd, s.host).run;
    run = ticks(run, 2);
    expect(state(run, 's5-port')).toBe('resolved');
  });

  it.each(['--publish 80:8000', '--publish=80:8000', '-p=80:8000', '-dp 80:8000', '-d -p 0.0.0.0:80:8000/tcp', '-p80:8000', '-itdp 80:8000', '-e DEBUG=1 -p 80:8000'])('accepts %s', (opt) => {
    let run = readyToRun();
    const r = sh(run, `docker run ${opt} enroll:1.0`, 'srv-new');
    expect(r.failed, r.text).toBe(false);
    expect(r.text).not.toContain('포트 연결 없이');
    run = ticks(r.run, 6);
    expect(run.world.docker!.containers.find((c) => c.host === 'srv-new')!.ports).toEqual([80, 8000]);
    expect(state(run, 's5-port')).toBe('waiting');
    expect(state(run, 's5-drift')).toBe('resolved');
  });

  it('rejects unknown options and docker options written after the image', () => {
    const run = readyToRun();
    for (const line of ['docker run --publsh 80:8000 enroll:1.0', 'docker run enroll:1.0 -p 80:8000', 'docker run -p 127.0.0.1:80:8000 enroll:1.0', 'docker run -p 80 enroll:1.0']) {
      const r = sh(run, line, 'srv-new');
      expect(r.failed, line).toBe(true);
      expect(r.run.world.docker!.containers.some((c) => c.host === 'srv-new'), line).toBe(false);
    }
  });

  it('s5-port follows the dashboard: a working published container resolves it even with a leftover unpublished one', () => {
    let run = readyToRun();
    // The colleague's memo: run without -p → students can't get in.
    run = ticks(sh(run, 'docker run enroll:1.0', 'srv-new').run, 3);
    expect(state(run, 's5-port')).toBe('active');
    expect(isGreen(run)).toBe(false);
    // A second, correctly published container next to it lets students in.
    const r = sh(run, 'docker run -p 80:8000 --name e2 enroll:1.0', 'srv-new');
    expect(r.failed, r.text).toBe(false);
    run = ticks(r.run, 3);
    expect(isGreen(run)).toBe(true);
    expect(state(run, 's5-port')).toBe('resolved');
  });

  it('a correct container next to a stray one never fires s5-port', () => {
    let run = readyToRun();
    run = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-new').run;
    run = ticks(sh(run, 'docker run --name e2 enroll:1.0', 'srv-new').run, 3);
    expect(state(run, 's5-port')).toBe('waiting');
    expect(isGreen(run)).toBe(true);
  });

  it('refuses a second container on a host port that is already taken', () => {
    let run = readyToRun();
    run = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-new').run;
    const r = sh(run, 'docker run -p 80:8000 --name e2 enroll:1.0', 'srv-new');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('port is already allocated');
    expect(r.run.world.docker!.containers.filter((c) => c.host === 'srv-new')).toHaveLength(1);
    // srv-old's hand-installed app already holds port 80.
    const old = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-old');
    expect(old.failed).toBe(true);
    expect(old.text).toContain('port is already allocated');
  });
});

describe('docker data model', () => {
  it('restart and stop/start keep the writable layer; only removing the container loses it', () => {
    let run = startStage(5);
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
    expect(run.health.notes).toEqual([]);
    // rm without -f refuses a running container
    r = sh(run, 'docker rm db', 'srv-db');
    expect(r.failed).toBe(true);
    expect(r.run.world.docker!.containers).toHaveLength(1);
    r = sh(run, 'docker rm -f db', 'srv-db');
    expect(r.text).toContain('데이터도 컨테이너와 함께 지워졌어요');
    // A fresh container without a volume starts empty: the old rows are not a global counter.
    r = sh(r.run, 'docker run -p 3306:3306 --name db mysql:8', 'srv-db');
    expect(r.failed).toBe(false);
    expect(rows(r.run)).toBe(0);
    expect(sh(r.run, 'docker logs db', 'srv-db').text).toContain('Table enrollments is empty');
  });

  it('a volume keeps data when the container is removed and recreated', () => {
    let run = startStage(5);
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

  it('player-typed names never hit Object.prototype', () => {
    const run = startStage(5);
    let r = sh(run, 'docker rm -f db', 'srv-db');
    r = sh(r.run, 'docker run -p 3306:3306 -v constructor:/var/lib/mysql --name toString mysql:8', 'srv-db');
    expect(r.failed, r.text).toBe(false);
    expect(dbRows(r.run.world, appDb(r.run.world)!)).toBe(1520);
    expect(sh(r.run, 'docker volume ls', 'srv-db').text).toContain('constructor');
    expect(sh(r.run, 'docker logs __proto__', 'srv-db').failed).toBe(true);
    expect(sh(r.run, 'docker volume create __proto__', 'srv-db').failed).toBe(true);
  });
});

describe('s5-volume', () => {
  it('the update script recreates the DB container (new id, empty), not just restarts it', () => {
    const before = startStage(5).world.docker!.containers[0].id;
    const run = atVolumeIncident();
    const db = appDb(run.world)!;
    expect(db.id).not.toBe(before);
    expect(dbRows(run.world, db)).toBe(0);
    expect(run.health.notes).toContain('신청 내역 0건! 데이터 유실');
  });

  it('is solved by a volumed MySQL on srv-db:3306 whatever its name', () => {
    let run = atVolumeIncident();
    run = sh(run, 'docker rm -f db', 'srv-db').run;
    const r = sh(run, 'docker run -d -p 3306:3306 -v dbdata:/var/lib/mysql mysql:8', 'srv-db');
    expect(r.failed).toBe(false);
    run = ticks(r.run, 3);
    expect(state(run, 's5-volume')).toBe('resolved');
    expect(isGreen(run)).toBe(true);
    expect(isCleared(run)).toBe(true);
  });

  it('a volumed DB next to the old one is refused (port taken), so the dashboard never turns green with the incident open', () => {
    let run = atVolumeIncident();
    const r = sh(run, 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql mysql:8', 'srv-db');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('db 컨테이너가 이미 3306번을');
    run = ticks(r.run, 3);
    expect(state(run, 's5-volume')).toBe('active');
    expect(isGreen(run)).toBe(false);
  });

  it('a volume on the wrong folder does not keep MySQL data', () => {
    let run = atVolumeIncident();
    run = sh(run, 'docker rm -f db', 'srv-db').run;
    const r = sh(run, 'docker run -p 3306:3306 -v dbdata:/tmp --name db mysql:8', 'srv-db');
    expect(r.text).toContain('(볼륨 dbdata → 컨테이너 안 /tmp)');
    expect(r.text).not.toContain('복원');
    run = ticks(r.run, 3);
    expect(state(run, 's5-volume')).toBe('active');
    // The DB log shows where MySQL really writes, next to where the volume is attached.
    const logs = sh(run, 'docker logs db', 'srv-db').text;
    expect(logs).toContain('data dir: /var/lib/mysql (컨테이너 안');
    expect(logs).toContain('볼륨(dbdata)은 /tmp 에 붙어 있음');
  });

  it('a DB the app cannot reach (no -p, or another server) says where the app looks', () => {
    let run = atVolumeIncident();
    run = sh(run, 'docker rm -f db', 'srv-db').run;
    let r = sh(run, 'docker run -v dbdata:/var/lib/mysql --name db mysql:8', 'srv-db');
    expect(r.text).toContain('신청 앱은 srv-db 의 3306번 포트로 DB에 접속해요');
    run = ticks(r.run, 2);
    expect(run.health.notes.join()).toContain('DB 응답 없음 (신청 앱 → srv-db:3306)');
    expect(state(run, 's5-volume')).toBe('active');
    r = sh(run, 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8', 'srv-new');
    expect(r.text).toContain('신청 앱은 srv-db 의 3306번 포트로');
    expect(ticks(r.run, 2).scenarios.find((s) => s.id === 's5-volume')!.state).toBe('active');
  });

  it('dashboard green ⇔ incident resolved, over many player attempts', () => {
    const attempts: [string, string][][] = [
      [['docker restart db', 'srv-db']],
      [['docker run -p 3306:3306 -v dbdata:/var/lib/mysql mysql:8', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 --name db mysql:8', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 -v dbdata:/tmp mysql:8', 'srv-db']],
      [['docker stop db', 'srv-db'], ['docker run -p 3306:3306 -v v1:/var/lib/mysql mysql:8', 'srv-db'], ['docker start db', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 -v v1:/var/lib/mysql --name x mysql:8', 'srv-db'], ['docker rm -f x', 'srv-db']],
      [['docker rm -f db', 'srv-db'], ['docker run -p 3306:3306 -v ./data:/var/lib/mysql --name db mysql:8', 'srv-db']],
    ];
    for (const steps of attempts) {
      let run = atVolumeIncident();
      for (const [line, host] of steps) {
        run = sh(run, line, host).run;
        run = ticks(run, 2);
        const resolvedNow = state(run, 's5-volume') === 'resolved';
        if (isGreen(run)) expect(resolvedNow, steps.map((s) => s[0]).join(' → ')).toBe(true);
      }
    }
  });
});

describe('docker build', () => {
  it('prints the same Dockerfile as the design board, WORKDIR and EXPOSE included', () => {
    let run = startStage(5);
    run = applyAction(run, (w) => writeDockerfile(w, 'enroll')).run;
    const r = sh(run, 'docker build -t enroll:1.0 .', 'ops');
    expect(r.failed).toBe(false);
    for (const [i, line] of ENROLL_DOCKERFILE.entries()) expect(r.text).toContain(`Step ${i + 1}/${ENROLL_DOCKERFILE.length} : ${line}`);
    expect(ENROLL_DOCKERFILE).toContain('WORKDIR /app');
    expect(ENROLL_DOCKERFILE).toContain('EXPOSE 8000');
    // The design board has one card per instruction, in this order (DockerfileBoard.tsx CARDS).
    expect(ENROLL_DOCKERFILE.map((l) => l.split(' ')[0])).toEqual(['FROM', 'WORKDIR', 'COPY', 'RUN', 'EXPOSE', 'CMD']);
  });

  it('only builds on the admin PC, so a server always gets the image through the registry', () => {
    let run = readyToRun();
    const r = sh(run, 'docker build -t enroll:2.0 .', 'srv-new');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('관리 PC');
    expect(sh(r.run, 'docker run -p 80:8000 enroll:2.0', 'srv-new').failed).toBe(true);
    // -t takes its value attached too
    run = sh(run, 'docker build -tenroll:3.0 .', 'ops').run;
    expect(run.world.docker!.built).toContain('enroll:3.0');
  });

  it('names the finished recipe when the image name does not match it', () => {
    let run = startStage(5);
    run = applyAction(run, (w) => writeDockerfile(w, 'enroll')).run;
    const r = sh(run, 'docker build -t khu-enroll:1.0 .', 'ops');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('완성한 레시피: enroll');
    expect(sh(startStage(5), 'docker build -t enroll:1.0 .', 'ops').text).toContain('설계 보드');
  });
});

describe('container names and ids', () => {
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

  it('docker ps keeps its columns aligned (Hangul is two cells wide)', () => {
    let run = readyToRun();
    run = sh(run, 'docker run -p 80:8000 enroll:1.0', 'srv-new').run;
    run = sh(run, 'docker run --name e2 enroll:1.0', 'srv-new').run;
    const cells = (s: string) => [...s].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? 2 : 1), 0);
    for (const host of ['srv-new', 'srv-db']) {
      const lines = sh(run, 'docker ps', host).text.split('\n');
      const nameCol = cells(lines[0].slice(0, lines[0].indexOf('NAME')));
      for (const l of lines.slice(1)) expect(cells(l.slice(0, l.lastIndexOf(' ') + 1)), l).toBe(nameCol);
    }
  });
});

describe('container commands on the admin PC', () => {
  it('point the player to a server instead of "no such container"', () => {
    const run = startStage(5);
    for (const line of ['docker logs db', 'docker rm -f db', 'docker stop db']) {
      expect(sh(run, line, 'ops').text, line).toContain('서버에 ssh 로 접속');
    }
    expect(sh(run, 'docker ps', 'ops').text).toContain('관리 PC에는 컨테이너가 없어요');
  });
});
