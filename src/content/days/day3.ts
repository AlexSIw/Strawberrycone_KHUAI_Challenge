// D-2: 컨테이너 · 링크 (v1 stage 5 + LACP / STP). The hand install on APP-01 failed, so the app moves into
// a container: Dockerfile board → build/push on the admin PC → `docker run -p` on APP-01 → the DB on a
// volume on DB-02. Then the afternoon load test fills TOR-01's single working uplink (the second cable is
// there but spanning tree blocks it): bundle both with LACP. Then a loop with STP off storms VLAN 50.
// Teaching incidents: uplink saturation → LACP; loop / broadcast storm → STP back on. Optional: no -p.
import { snapshot } from '../../sim/ios/config';
import { appDb, dbRows } from '../../sim/commands/docker';
import { campusDelivery, lbView, reach, studentDelivery } from '../../sim/network';
import type { Device, DockerState, Health, PlayContext, World } from '../../sim/types';
import { APP_HOST, appContainer, badImage, DB_HOST, dbOnVolume, enrollUnreachable, poBundled, UPLINK_PORTS } from '../incidents/d2';
import { ipOf } from '../incidents/d4';
import type { DaySpec, GuideStep } from '../types';
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

// ---------- first-time guides (each step ticks from what the player really did) ----------

/** The enroll image was built on the 관리 PC / is in the registry. */
const built = (w: World) => !!w.docker?.built.some((i) => i.startsWith('enroll:'));
const pushed = (w: World) => !!w.docker?.registry.some((i) => i.startsWith('enroll:'));

/** The terminal is back on the 관리 PC, as far as the typed lines tell (every ssh closed with exit). */
function onAdminPc(c: PlayContext): boolean {
  let depth = 0;
  for (const x of c.commands) {
    if (/^ssh\s+\S/i.test(x)) depth++;
    else if (/^(exit|logout)$/i.test(x)) depth = Math.max(0, depth - 1);
  }
  return depth === 0;
}

/** Latest time an event matching `prefix` happened (-1: never). */
const lastAt = (c: PlayContext, prefix: string) =>
  Math.max(-1, ...Object.entries(c.eventTimes).filter(([e]) => e.startsWith(prefix)).map(([, t]) => t));

/** Some enroll container was started on APP-01 (right or wrong ports). */
const enrollStarted = (w: World) => !!w.docker?.containers.some((c) => c.host === APP_HOST && c.image.startsWith('enroll:'));

const IMAGE_STEPS: GuideStep[] = [
  {
    text: '관리 PC로 돌아오기 (APP-01에 접속해 있다면)',
    cmd: 'exit',
    why: '레시피(Dockerfile)와 앱 코드는 관리 PC에 있어요. 그래서 이미지는 관리 PC에서 만들어요.',
    done: (w, c) => onAdminPc(c) || built(w) || pushed(w),
  },
  {
    text: '레시피대로 이미지 만들기',
    cmd: 'docker build -t enroll:1.0 .',
    why: '-t 는 이름표예요: enroll(앱 이름) + :1.0(버전 번호표, 태그). 끝의 . 은 "레시피가 있는 지금 폴더"라는 뜻이에요.',
    done: (w) => built(w) || pushed(w),
  },
  {
    text: '이미지를 레지스트리에 올리기',
    cmd: 'docker push enroll:1.0',
    why: '레지스트리(registry.khu.ac.kr)는 이미지를 모아 두는 공용 창고예요. 서버들은 실행할 때 여기서 이미지를 내려받아요.',
    done: pushed,
  },
];

const RUN_STEPS: GuideStep[] = [
  {
    text: 'APP-01에 접속하기',
    cmd: 'ssh srv-new',
    why: '컨테이너는 학생 요청을 받을 서버(APP-01, 이름 srv-new)에서 실행해요.',
    done: (w, c) => (c.eventTimes['ssh:srv-new'] ?? -1) >= lastAt(c, 'docker_push:enroll') || enrollStarted(w),
  },
  {
    text: '서버의 문 80번과 컨테이너 안 창구 8000번을 이어서 실행하기',
    cmd: 'docker run -p 80:8000 enroll:1.0',
    why: '-p 바깥:안쪽. 학생과 L4는 서버의 80번 문(웹 기본 포트)으로 오고, 앱은 컨테이너 안 8000번(레시피의 EXPOSE)에서 기다려요. 이미지는 레지스트리에서 알아서 내려받아요.',
    done: (w) => !!appContainer(w),
  },
  {
    text: 'L4가 APP-01을 UP으로 보는지 확인하기',
    why: 'L4는 정해진 주소(/health)로 "살아 있니?"를 물어서, 대답하는 서버에만 학생을 보내요. NOC의 SMS나 L4의 lb pool 에서 보여요.',
    done: appUp,
  },
];

const VOLUME_STEPS: GuideStep[] = [
  {
    text: 'DB-02에 접속하기',
    cmd: 'ssh srv-db',
    why: 'DB-02(이름 srv-db)는 신청 앱이 신청 기록을 적는 DB 서버예요.',
    done: (w, c) => c.events.includes('ssh:srv-db') || c.events.includes('docker_rm:db') || dbOnVolume(w),
  },
  {
    text: '지금 DB 컨테이너 살펴보기',
    cmd: 'docker ps',
    why: 'NAME(db) · IMAGE(mysql:8) · PORTS(3306)를 봐 둬요. 다시 만들 때 똑같이 써요. VOLUME 칸이 비어 있으면 데이터가 컨테이너 안에만 있다는 뜻이에요.',
    done: (w, c) => (c.eventTimes['docker_ps'] ?? -1) >= (c.eventTimes['ssh:srv-db'] ?? Infinity) || c.events.includes('docker_rm:db') || dbOnVolume(w),
  },
  {
    text: '옛 DB 컨테이너 지우기',
    cmd: 'docker rm -f db',
    why: '이미 뜬 컨테이너에는 볼륨을 새로 붙일 수 없어서 지우고 다시 만들어요. 안에 있던 데이터는 같이 지워지지만, 새 볼륨에 어젯밤 백업이 복원돼요.',
    done: (w, c) => c.events.includes('docker_rm:db') || dbOnVolume(w),
  },
  {
    text: '볼륨을 붙여 DB 컨테이너 다시 만들기',
    cmd: 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8',
    why: '-v 볼륨:폴더 는 사물함(dbdata)을 MySQL이 데이터를 적는 폴더(/var/lib/mysql)에 붙여요. -p 3306:3306 은 신청 앱이 DB를 찾아오는 문(3306번)을 그대로 여는 거예요.',
    done: dbOnVolume,
  },
];

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
    { who: 'boss', text: '2차 신청 대비로 앱 서버를 늘리려고, 선배가 2번 랙의 새 앱 서버 APP-01(이름 srv-new)에 신청 앱을 손으로 설치했는데… 실패했대. L4(학생 접속을 서버들에 나눠 주는 장비)는 벌써 APP-01로 학생을 보내려고 기다리고 있고.' },
    { who: 'mentor', text: '서버마다 손으로 깔면 프로그램 버전이 조금씩 달라져. 오늘은 앱과 실행 환경(앱이 쓰는 프로그램과 그 버전)을 통째로 포장하는 컨테이너(Docker)로 가자. 실패한 설치 기록부터 봐.' },
    { who: 'boss', text: '앱이 뜨면 오후에 모의 부하 테스트를 할 거야. 진짜 학생 대신 가짜 요청을 1초에 8,000건(8,000 rps) 보내서, 수강신청 날처럼 몰려도 버티는지 미리 보는 시험이지. 아, 선배가 어제 TOR-01에서 코어로 가는 케이블을 하나 더 깔아 뒀다더라.' },
    { who: 'mentor', text: '1번 랙·2번 랙 서버들의 요청은 전부 랙 스위치 TOR-01에서 코어 스위치로 가는 위쪽 길, 업링크로 모여. 업링크는 Te로 시작하는 빠른 포트(Te1/1/x)에 꽂힌 10G 케이블이야. 10G는 1초에 100억 비트를 나르는 폭이고, 얼마나 찼는지는 NMS 지도의 선 색으로 보여.' },
    { who: 'lion', text: '포장하고, 띄우고, 부하 테스트까지! 해볼게요.', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: '컨테이너는 밀키트, 레지스트리는 냉동고, 볼륨은 사물함. 이제 어느 서버에서든 똑같이 띄울 수 있어.' },
    { who: 'mentor', text: '그리고 길 이야기. 스위치 사이 길이 둘이면 STP가 하나를 막아(고리 방지). 둘 다 쓰려면 LACP로 묶고, STP를 끄면 스톰이 난다. 오늘 둘 다 봤지?' },
    { who: 'boss', text: '내일(D-1)은 리허설이다. 서버 여러 대를 쿠버네티스로 묶고, 하나가 죽어도 버티는지 점검한다.' },
  ],
  recap: {
    built: [
      'D-5: 1번 랙에 WEB-01·WEB-02(웹 서버: 학생 화면을 내주는 서버)와 DB-01(DB 서버: 신청 기록을 적는 서버)을 설치하고, 랙 맨 위 스위치 TOR-01에 케이블로 이었어요.',
      'D-4: 스위치 하나를 VLAN(독립된 작은 네트워크)으로 나눴어요: 10 WEB · 20 DB, 그리고 선배가 만들어 둔 40 K8S · 50 INFRA(DNS·DHCP). 코어 스위치 CORE-01에는 VLAN마다 게이트웨이(다른 VLAN으로 나가는 문)를 달았어요. 주소는 10.10.<VLAN>.x 모양이에요.',
      'D-4: 장비 설정은 관리 PC에서 ssh로 들어가 바꿔요: enable → configure terminal → … → end → write memory(저장).',
      'D-3: 수강신청 앱을 열었어요. 학생 요청은 L4(대표 주소 하나로 받아 서버들에 나눠 주는 장비)를 거쳐, 헬스체크에 대답하는 서버로만 가요.',
      'D-3: 관제 화면(NOC)의 NMS 지도에서 장비와 선 상태를, SMS에서 서비스 상태를 봐요.',
    ],
    concepts: ['ios', 'vlan', 'l2l3', 'port', 'l4', 'nms'],
  },
  primer: [
    { tool: 'deploy log', role: 'APP-01(이름 srv-new)에서 쳐요. 선배가 손으로 설치하다 실패한 기록을 보여 줘요.' },
    { tool: 'docker build · docker push', role: '관리 PC에서 레시피(Dockerfile)대로 앱을 이미지로 포장하고, 이미지 창고(레지스트리)에 올려요.' },
    { tool: 'docker run -p 바깥:안쪽 · -v 볼륨:폴더', role: '서버에서 이미지를 컨테이너로 실행해요. -p 는 서버의 문과 컨테이너 안 창구를 잇고, -v 는 데이터를 컨테이너 바깥 사물함(볼륨)에 둬요.' },
    { tool: 'NMS 지도의 선 색 · 점선', role: '스위치 사이 길이 얼마나 찼는지 색으로 보여 줘요. 점선은 예비 길이에요: 길이 빙 도는 고리(루프)를 막으려고 STP가 일부러 쉬게 둔 길.' },
    { tool: 'LACP 묶기 (channel-group … mode active)', role: '같은 두 스위치 사이 케이블 여러 줄을 한 줄(Port-channel, Po)로 묶어 폭을 합쳐요. 양쪽 장비에 똑같이 하고 show etherchannel summary 로 확인해요.' },
    { tool: 'show spanning-tree', role: '스위치에서 쳐요. VLAN마다 어느 포트가 일하고(FWD) 어느 포트가 예비로 쉬는지(BLK) 보여 줘요.' },
  ],
  objectives: [
    {
      id: 'log',
      text: 'APP-01에 접속해 실패한 설치 기록 보기 (ssh srv-new → deploy log)',
      spot: 'desk',
      done: (_w, c) => c.events.includes('deploy_log_failed'),
      why: 'APP-01(이름 srv-new)은 신청 앱을 한 벌 더 돌리려고 들인 새 앱 서버예요. 선배가 여기에 앱을 손으로 설치하다 실패했어요. 설치 기록(배포 로그)에서 왜 실패했는지부터 봐요.',
    },
    {
      id: 'recipe',
      text: '관제실 설계 보드에서 Dockerfile(레시피 카드) 완성하기',
      spot: 'board',
      done: (w) => w.flags['dockerfile:enroll'] === 'ok',
      after: ['log'],
      concept: 'container',
      why: 'Dockerfile은 앱을 어떤 재료(기본 이미지: Python 같은 실행 환경)로, 어떤 순서로 포장할지 적은 레시피예요. 레시피대로 포장한 묶음이 이미지, 이미지를 실행한 것이 컨테이너예요. 첫 줄에 앱이 원하는 Python을 적어 두면 서버에 어떤 버전이 깔려 있든 상관없어요.',
      lesson: 'APP-01은 Python 버전이 달라서 설치가 실패했어요. 앱과 실행 환경을 레시피(Dockerfile)대로 통째로 포장하면(이미지) 어느 서버에서나 똑같이 돌아요.',
    },
    {
      id: 'image',
      text: '관리 PC에서 이미지 만들기(docker build) → 레지스트리에 올리기(docker push)',
      spot: 'desk',
      done: pushed,
      after: ['recipe'],
      why: '이미지는 레시피와 앱 코드가 있는 관리 PC에서 만들어요. 다 만든 이미지는 레지스트리(이미지를 모아 두는 공용 창고)에 올려요. 그래야 APP-01 같은 서버가 거기서 내려받아 실행할 수 있어요.',
      steps: IMAGE_STEPS,
    },
    {
      id: 'run',
      text: 'APP-01에서 컨테이너 실행해 학생 요청이 들어오게 하기 (L4가 APP-01을 UP으로)',
      spot: 'desk',
      done: appUp,
      after: ['image'],
      concept: 'portMapping',
      why: '컨테이너는 바깥과 막힌 방이에요. 학생 요청은 서버의 80번 문(웹 기본 포트)으로 들어오는데 앱은 방 안 8000번 창구에서 기다려서, 실행할 때 둘을 이어 줘야 해요(포트 매핑 -p). 그래야 L4의 "살아 있니?" 질문에도 앱이 대답해서, L4가 APP-01로 학생을 보내요.',
      lesson: '-p 80:8000 은 서버의 바깥 문(80)과 컨테이너 안 창구(8000)를 잇는 통로예요. 이게 있어야 L4의 "살아 있니?"에도, 학생 요청에도 앱이 대답해요.',
      steps: RUN_STEPS,
    },
    {
      id: 'volume',
      text: 'DB-02(srv-db)의 DB 컨테이너를 볼륨(사물함)에 데이터를 두도록 다시 만들기',
      spot: 'desk',
      done: dbOnVolume,
      after: ['run'],
      concept: 'volume',
      why: 'DB-02는 신청 앱이 신청 기록을 적는 DB 서버예요. 그 DB(MySQL: 널리 쓰는 데이터베이스 프로그램)가 지금은 기록을 컨테이너 안에 적고 있어서, 컨테이너를 지우거나 새로 만들면 기록도 사라져요. 볼륨은 컨테이너 바깥에 따로 둔 저장 공간(사물함)이라, 여기에 적게 하면 컨테이너를 바꿔도 남아요.',
      lesson: '컨테이너 안에 적은 데이터는 컨테이너를 지우면 함께 사라져요. 볼륨(사물함)에 두면 컨테이너를 새로 만들어도 남아요. 어젯밤 백업도 새 볼륨으로 복원했어요. 이제 오후 모의 부하 테스트가 시작돼요!',
      steps: VOLUME_STEPS,
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
      why: '케이블 두 줄을 LACP로 묶으면 두 장비는 그 둘을 Port-channel 1(Po1)이라는 한 줄짜리 길로 써요. show etherchannel summary 에서 Po1(SU)는 "묶음이 일하는 중", 멤버 포트 옆 (P)는 "묶여서 일하는 중"이에요. 묶음도 업링크라서 trunk(여러 VLAN을 한 줄로 함께 실어 나르는 포트)로 일하고, 실어 나를 VLAN 목록이 NMS에 "trunk 10,20,40,50"처럼 보여요.',
      lesson: '케이블 두 줄을 LACP로 묶으면 장비는 한 줄(Port-channel)로 봐요. 그래서 STP가 막을 고리도 없고, 둘 다 일해서 폭이 두 배예요. 한 줄이 끊겨도 나머지로 버텨요.',
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'consolePick', hosts: ['TOR-01', 'web', 'db'] },
    rack2: { kind: 'consolePick', hosts: [APP_HOST, DB_HOST] },
    rack3: { kind: 'consolePick', hosts: ['TOR-02'] },
    rack4: { kind: 'inspect', text: '4번 랙: DHCP 서버(dhcp01)와 DNS 서버(ns1). 이름 찾기와 주소 나눠주기를 맡아요. 둘 다 VLAN 50(INFRA, 주소 10.10.50.x)에 있어요.' },
    switch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'consolePick', hosts: ['CORE-01', 'CORE-02'] },
    patch: {
      kind: 'inspect',
      text: '패치 패널: 랙 스위치와 코어를 잇는 케이블이 모이는 곳. 어제 선배가 TOR-01 → CORE-01 케이블을 한 줄 더 깔아 뒀대요. 위쪽 길(업링크)은 스위치의 Te 포트(10G), 서버 케이블은 Gi 포트(1G)에 꽂혀요. 포트 이름의 숫자는 장비/모듈/포트 번호예요(Gi1/0/3 = 1번 장비 0번 모듈의 3번 포트). 케이블을 검사·교체하려면 바로 위 TOR 배선판(E · 케이블 점검)으로 가요.',
    },
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
