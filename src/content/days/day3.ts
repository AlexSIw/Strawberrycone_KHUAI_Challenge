// D-2: 컨테이너 · 링크 (v1 stage 5 + LACP / STP). The hand install on APP-01 failed, so the app moves into
// a container: Dockerfile board → build/push on the admin PC → `docker run -p` on APP-01 → the DB on a
// volume on DB-02. Then the afternoon load test fills TOR-01's single working uplink (the second cable is
// there but spanning tree blocks it): bundle both with LACP. Then a loop with STP off storms VLAN 50.
// Teaching incidents: uplink saturation → LACP; loop / broadcast storm → STP back on. Optional: no -p.
import { snapshot } from '../../sim/ios/config';
import { appDb, dbRows } from '../../sim/commands/docker';
import { campusDelivery, lbView, reach, studentDelivery } from '../../sim/network';
import type { Device, DockerState, Health, World } from '../../sim/types';
import { APP_HOST, appContainer, badImage, DB_HOST, dbOnVolume, enrollUnreachable, poBundled, UPLINK_PORTS } from '../incidents/d2';
import { ipOf } from '../incidents/d4';
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK } from './common';

/** Enrollment rows in last night's DB backup (restored into an empty volume). */
const BACKUP_ROWS = 1520;
/** The DB VLAN, whose CORE-02 standby gateway 선배 adds only after D-2. */
const DB_VLAN = 20;

type Status = 'up' | 'degraded' | 'down';
const status = (ok: number): Status => (ok >= 0.99 ? 'up' : ok > 0 ? 'degraded' : 'down');

/** A fresh startup-config snapshot, so the day starts with nothing unsaved. */
function resave(d: Device | undefined): void {
  const n = d?.nd;
  if (!n) return;
  n.startup = snapshot(n);
  n.dirty = false;
}

/** Docker on APP-01 (the failed hand install) and DB-02 (MySQL with its data inside the container). */
function dockerLayer(): DockerState {
  return {
    built: [],
    registry: ['mysql:8'],
    hosts: {
      [APP_HOST]: { python: '3.9.18', pulled: [], volumes: {} },
      [DB_HOST]: { python: '3.12.4', pulled: ['mysql:8'], volumes: {} },
    },
    containers: [{ id: 'a1b2c3d4e5f6', name: 'db', image: 'mysql:8', host: DB_HOST, ports: [3306, 3306], volume: null, volumePath: null, rows: BACKUP_ROWS, running: true }],
    manualDeploy: { host: APP_HOST, service: 'enroll', status: 'failed' },
    nextId: 1,
  };
}

/** The app container students reach through the L4 (pool member healthy). */
const appUp = (w: World) => {
  const c = appContainer(w);
  return !!c && lbView(w).members.some((m) => m.host === APP_HOST && m.healthy);
};

const saved = (w: World) => ['TOR-01', 'CORE-01'].filter((id) => w.devices[id]?.nd?.dirty === false);

function health(w: World): Health {
  const path = studentDelivery(w);
  const campus = campusDelivery(w);
  const notes = [...path.notes];
  const services: Record<string, Status> = {};
  const app = appContainer(w);
  const bad = !!app && badImage(w, app.image);
  const appOk = !app ? 0 : bad ? 0.2 : 1;
  if (!app) notes.push('APP-01의 신청 앱이 응답하지 않아요');
  else if (bad) notes.push('신청 요청이 500 에러(서버 안 처리 오류)로 실패해요');
  const db = appDb(w);
  // The app reaches its DB over the network: APP-01 (VLAN 10) → DB-02 (VLAN 20) through the core's gateway.
  const dbReached = !!db && (!app || reach(w, APP_HOST, ipOf(DB_HOST)).ok);
  const rows = db ? dbRows(w, db) : 0;
  const dataOk = !db || !dbReached ? 0 : rows > 0 ? 1 : 0.3;
  if (!db) notes.push('DB 응답 없음 (신청 앱 → DB-02:3306)');
  else if (!dbReached) notes.push('신청 앱이 DB-02에 연결하지 못해요');
  else if (rows === 0) notes.push('신청 내역이 0건으로 보여요 (DB가 비어 있어요)');
  const ok = path.ok * appOk * dataOk;
  services['수강신청'] = status(ok);
  services['APP-01 (신청 앱)'] = !app ? 'down' : bad ? 'degraded' : 'up';
  services['DB-02 (DB)'] = !db || !dbReached ? 'down' : rows === 0 ? 'degraded' : 'up';
  services['캠퍼스 인터넷'] = status(campus.ok);
  notes.push(...campus.notes);
  for (const c of Object.values(w.campus ?? {})) {
    services[c.label] = !c.up ? 'down' : c.latencyMs >= 1000 ? 'degraded' : 'up';
    if (!c.up) notes.push(`${c.label} 응답 없음`);
    else if (c.latencyMs >= 1000) notes.push(`${c.label} 응답 느림 (${(c.latencyMs / 1000).toFixed(1)}초)`);
  }
  const slow = path.notes.some((n) => n.includes('느려요'));
  const latencyMs = ok === 0 ? 0 : slow ? 900 : 60;
  return emptyHealth(w, { availability: ok, errorRate: 1 - ok, latencyMs, services, notes });
}

export const day3: DaySpec = {
  id: 3,
  label: 'D-2',
  date: '02-08',
  clock: WEEKDAY_CLOCK,
  fixed: [
    // A mistake the player may make (no -p, or the wrong inner port); optional.
    { template: 'd2-port', trigger: { type: 'condition', when: enrollUnreachable } },
    { template: 'd2-uplink', trigger: { type: 'gate', objectives: ['volume'] } },
    { template: 'd2-storm', trigger: { type: 'gate', objectives: ['lacp'] } },
  ],
  extras: [0, 1],
  mapSwitch: 'TOR-01',
  mapDevices: ['web', 'web2', 'db', APP_HOST, DB_HOST],
  title: '컨테이너 · 링크',
  subtitle: 'Docker · LACP · STP',
  topics: ['컨테이너 · 이미지 · 레지스트리', '포트 매핑과 볼륨', '업링크와 오버서브스크립션', 'LACP(포트 묶음)', 'STP와 루프(브로드캐스트 스톰)'],
  intro: [
    { who: 'boss', text: 'D-2! 수강신청까지 이틀. 베타 서비스는 오전 점검 공지를 걸어 둬서, 지금은 학생 접속이 없어.' },
    { who: 'boss', text: '2차 신청 대비로 앱 서버를 늘리려고, 선배가 APP-01(이름 srv-new)에 신청 앱을 손으로 설치했는데… 실패했대. L4는 벌써 APP-01을 보고 있고.' },
    { who: 'mentor', text: '서버마다 손으로 깔면 프로그램 버전이 조금씩 달라져. 오늘은 앱과 실행 환경을 통째로 포장하는 컨테이너(Docker)로 가자. 실패한 설치 기록부터 봐.' },
    { who: 'boss', text: '앱이 뜨면 오후에 모의 부하 테스트를 할 거야. 1초에 8,000건(8,000 rps)! 아, 선배가 어제 TOR-01에서 코어로 가는 케이블을 하나 더 깔아 뒀다더라.' },
    { who: 'lion', text: '포장하고, 띄우고, 부하 테스트까지! 해볼게요.', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: '컨테이너는 밀키트, 레지스트리는 냉동고, 볼륨은 사물함. 이제 어느 서버에서든 똑같이 띄울 수 있어.' },
    { who: 'mentor', text: '그리고 길 이야기. 스위치 사이 길이 둘이면 STP가 하나를 막아(고리 방지). 둘 다 쓰려면 LACP로 묶고, STP를 끄면 스톰이 난다. 오늘 둘 다 봤지?' },
    { who: 'boss', text: '내일(D-1)은 리허설이다. 서버 여러 대를 쿠버네티스로 묶고, 하나가 죽어도 버티는지 점검한다.' },
  ],
  objectives: [
    {
      id: 'log',
      text: 'APP-01에 접속해 실패한 설치 기록 보기 (ssh srv-new → deploy log)',
      spot: 'desk',
      done: (_w, c) => c.events.includes('deploy_log_failed'),
    },
    {
      id: 'recipe',
      text: '관제실 설계 보드에서 Dockerfile(레시피 카드) 완성하기',
      spot: 'board',
      done: (w) => w.flags['dockerfile:enroll'] === 'ok',
      after: ['log'],
      concept: 'container',
      lesson: 'APP-01은 Python 버전이 달라서 설치가 실패했어요. 앱과 실행 환경을 레시피(Dockerfile)대로 통째로 포장하면(이미지) 어느 서버에서나 똑같이 돌아요.',
    },
    {
      id: 'image',
      text: '관리 PC에서 이미지 만들기(docker build) → 레지스트리에 올리기(docker push)',
      spot: 'desk',
      done: (w) => !!w.docker?.registry.some((i) => i.startsWith('enroll:')),
      after: ['recipe'],
    },
    {
      id: 'run',
      text: 'APP-01에서 컨테이너 실행해 학생 요청이 들어오게 하기 (L4가 APP-01을 UP으로)',
      spot: 'desk',
      done: appUp,
      after: ['image'],
      concept: 'portMapping',
      lesson: '-p 80:8000 은 서버의 바깥 문(80)과 컨테이너 안 창구(8000)를 잇는 통로예요. 이게 있어야 L4의 "살아 있니?"에도, 학생 요청에도 앱이 대답해요.',
    },
    {
      id: 'volume',
      text: 'DB-02(srv-db)의 DB 컨테이너를 볼륨(사물함)에 데이터를 두도록 다시 만들기',
      spot: 'desk',
      done: dbOnVolume,
      after: ['run'],
      concept: 'volume',
      lesson: '컨테이너 안에 적은 데이터는 컨테이너를 지우면 함께 사라져요. 볼륨(사물함)에 두면 컨테이너를 새로 만들어도 남아요. 어젯밤 백업도 새 볼륨으로 복원했어요.',
    },
    {
      id: 'lacp',
      text: 'TOR-01·CORE-01 업링크 묶음(Po1) 확인하고 두 장비 설정 저장하기 (show etherchannel summary · write memory)',
      spot: 'desk',
      done: (w, c) => poBundled(w) && saved(w).length === 2 && c.events.some((e) => /^ios:(TOR-01|CORE-01):show etherchannel summary$/.test(e)),
      progress: (w) => `${saved(w).length}/2`,
      after: ['volume'],
      afterIncidents: ['d2-uplink:0'],
      concept: 'lacp',
      lesson: '케이블 두 줄을 LACP로 묶으면 장비는 한 줄(Port-channel)로 봐요. 그래서 STP가 막을 고리도 없고, 둘 다 일해서 폭이 두 배예요. 한 줄이 끊겨도 나머지로 버텨요.',
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'consolePick', hosts: ['TOR-01', 'web', 'db'] },
    rack2: { kind: 'consolePick', hosts: [APP_HOST, DB_HOST] },
    rack3: { kind: 'consolePick', hosts: ['TOR-02'] },
    rack4: { kind: 'inspect', text: '4번 랙: DHCP 서버(dhcp01)와 DNS 서버(ns1). 이름 찾기와 주소 나눠주기를 맡아요.' },
    switch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'consolePick', hosts: ['CORE-01', 'CORE-02'] },
    patch: { kind: 'inspect', text: '패치 패널: 랙 스위치와 코어를 잇는 케이블이 모이는 곳. 어제 선배가 TOR-01 → CORE-01 케이블을 한 줄 더 깔아 뒀대요.' },
    pdu: { kind: 'gauge', target: 'pdu' },
    board: { kind: 'board', board: 'dockerfile' },
  },
  health,
  panels: ['traffic', 'services', 'links'],
  /**
   * What D-2 builds, taken back out: the TOR-01 ↔ CORE-01 bundle (the second cable stays, unbundled).
   * Also CORE-02's VLAN 20 gateway: 선배 sets that standby up after D-2 (D-1 starts with it), so up to D-2
   * the VLAN 10/20 gateways live on CORE-01 alone (D-4's gateway-down incident needs that).
   */
  unbuild: (w) => {
    for (const [dev, ports] of Object.entries(UPLINK_PORTS)) {
      const n = w.devices[dev]?.nd;
      if (!n) continue;
      for (const p of ports) {
        if (!n.ifs[p]) continue;
        delete n.ifs[p].group;
        delete n.ifs[p].chMode;
      }
      delete n.ifs.Po1;
      resave(w.devices[dev]);
    }
    const c2 = w.devices['CORE-02']?.nd;
    if (c2) delete c2.svis[DB_VLAN];
    resave(w.devices['CORE-02']);
  },
  /** Docker on APP-01 / DB-02, the L4 pointed at APP-01:80 (/health), and no students during the morning maintenance. */
  setup: (w) => {
    w.docker = dockerLayer();
    w.flags.backupRows = BACKUP_ROWS;
    const lb = w.net?.lb;
    if (lb) {
      lb.members = [{ name: APP_HOST, host: APP_HOST, port: 80, enabled: true }];
      lb.health = { proto: 'http', port: 80, path: '/health' };
    }
    w.traffic.rps = 0;
    w.traffic.noticeShare = 0;
  },
};
