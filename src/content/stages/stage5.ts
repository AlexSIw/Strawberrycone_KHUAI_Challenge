import { writeDockerfile } from '../../sim/actions';
import {
  appDb,
  dataOnVolume,
  DB_ENDPOINT,
  dbRows,
  enrollContainerReachable,
  enrollPublished,
  isDb,
  isEnroll,
  nextContainerId,
} from '../../sim/commands/docker';
import type { Scenario } from '../../sim/scenario';
import type { Device, World } from '../../sim/types';
import type { StageDef } from '../types';
import { emptyHealth } from '../worlds';

const host = (id: string, label: string, rack: string): Device => ({ id, kind: 'server', label, rack, installed: true, feeds: ['A', 'B'], ports: ['eth0'] });

export function stage5World(): World {
  return {
    t: 0,
    devices: {
      ops: { ...host('ops', '관리 PC', ''), rack: undefined },
      'srv-old': host('srv-old', '기존 신청 서버', 'rack1'),
      'srv-new': host('srv-new', '새 서버', 'rack2'),
      'srv-db': host('srv-db', 'DB 서버', 'rack1'),
    },
    cables: {},
    docker: {
      built: [],
      registry: ['mysql:8'],
      hosts: {
        // srv-old runs the hand-installed enroll app, which already holds port 80.
        'srv-old': { python: '3.12.4', pulled: [], volumes: {}, busyPorts: [80] },
        'srv-new': { python: '3.9.18', pulled: [], volumes: {} },
        'srv-db': { python: '3.12.4', pulled: ['mysql:8'], volumes: {} },
      },
      // The DB keeps its data in its own writable layer: fine until the container is recreated.
      containers: [
        { id: 'a1b2c3d4e5f6', name: 'db', image: 'mysql:8', host: 'srv-db', ports: [3306, 3306], volume: null, volumePath: null, rows: 1520, running: true },
      ],
      manualDeploy: null,
      nextId: 1,
    },
    traffic: { rps: 2500, noticeShare: 0 },
    flags: { backupRows: 1520 },
  };
}

const PER_SERVER = 3000;

function dockerHealth(w: World) {
  const d = w.docker!;
  const notes: string[] = [];
  const published = d.containers.filter(enrollPublished);
  const cap = PER_SERVER * (1 + published.length); // srv-old (manual install) + reachable containers
  const served = Math.min(1, cap / Math.max(1, w.traffic.rps));
  if (served < 1) notes.push(`신청 서버 부족: ${Math.round(served * 100)}%만 처리`);
  // The app finds its DB at srv-db:3306 — whatever the container is called.
  const db = appDb(w);
  const rows = db ? dbRows(w, db) : 0;
  if (!db) notes.push(`DB 응답 없음 (신청 앱 → ${DB_ENDPOINT.host}:${DB_ENDPOINT.port})`);
  else if (rows === 0) notes.push('신청 내역 0건! 데이터 유실');
  const dataOk = db ? (rows > 0 ? 1 : 0.3) : 0;
  const services: Record<string, 'up' | 'degraded' | 'down'> = {
    'srv-old': 'up',
    'srv-new': published.some((c) => c.host === 'srv-new') ? 'up' : d.manualDeploy?.status === 'failed' ? 'down' : 'degraded',
    db: !db ? 'down' : rows === 0 ? 'degraded' : 'up',
  };
  return { ok: served * dataOk, latency: served < 1 ? 1500 : 60, services, notes };
}

/**
 * Enroll containers are running but students reach none of them (no -p, or the wrong ports).
 * A leftover unpublished container next to a working one is harmless, so it doesn't count —
 * this keeps the incident in step with the dashboard's capacity.
 */
const enrollUnreachable = (w: World) =>
  !!w.docker?.containers.some((c) => c.running && isEnroll(c) && !enrollPublished(c)) && !enrollContainerReachable(w);

const scenarios: Scenario[] = [
  {
    id: 's5-drift',
    stage: 5,
    title: '"내 컴퓨터에선 되는데…"',
    alert: '2차 수강신청 대비로 서버를 한 대 늘렸는데, 새 서버(srv-new)에서 신청 앱이 안 떠요!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'stageStart', delay: 4 },
    inject: (w) => {
      w.docker!.manualDeploy = { host: 'srv-new', service: 'enroll', status: 'failed' };
      w.traffic.rps = 6000;
    },
    check: (w) => !!w.docker?.containers.some((c) => c.running && c.host === 'srv-new' && isEnroll(c)),
    hints: [
      '기존 서버에선 잘 되는 앱이 새 서버에선 안 돼. 두 서버는 뭐가 다를까?',
      '새 서버의 배포(앱 설치) 기록을 봐. 서버마다 설치된 프로그램 버전이 달라. 매번 맞춰 깔기보단, 앱과 실행 환경을 통째로 포장하면 어떨까? (밀키트처럼)',
      '설계 보드에서 레시피(Dockerfile)를 완성하고 → 밀키트 원본(이미지)으로 만들고 → 냉동고(레지스트리)에 올린 뒤 → 새 서버에서 꺼내 실행해봐.',
    ],
    bannedPhrases: ['docker build -t enroll', 'docker push enroll', 'docker run'],
    solution: 'Dockerfile 작성 → docker build -t enroll:1.0 . → docker push enroll:1.0 → ssh srv-new → docker run -p 80:8000 enroll:1.0',
    solutionSteps: [
      { label: 'Dockerfile 작성', action: (w) => writeDockerfile(w, 'enroll') },
      { cmd: 'docker build -t enroll:1.0 .', host: 'ops' },
      { cmd: 'docker push enroll:1.0', host: 'ops' },
      { cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' },
    ],
    concept: 'container',
    lesson: '서버마다 설치 상태가 조금씩 달라져서 실패했어요. 앱과 환경을 이미지로 묶어 컨테이너로 실행하면 어디서든 똑같이 돌아가요!',
  },
  {
    id: 's5-port',
    stage: 5,
    title: '컨테이너는 떴는데 접속 불가',
    alert: '새로 띄운 신청 앱 컨테이너는 실행 중(Up)인데… 학생 요청이 하나도 안 들어가요.',
    severity: 'warning',
    room: 'noc',
    optional: true,
    trigger: { type: 'condition', when: enrollUnreachable },
    inject: () => {},
    check: enrollContainerReachable,
    hints: [
      '컨테이너 목록(docker ps)의 PORTS 칸을 봐. 포트는 서버로 들어오는 문 번호야. 다른 서버의 PORTS 칸, 그리고 앱 로그(앱이 남긴 기록, docker logs)가 말하는 번호와 비교해봐.',
      '컨테이너는 잠긴 방이야. 학생들이 오는 길가 문(웹 기본 포트: 주소에 번호를 안 붙이면 가는 문)과, 앱이 방 안에서 기다리는 창구 번호를 이어줘야 손님이 들어와.',
      '컨테이너를 지우고, 바깥 문과 안쪽 창구를 잇는 실행 옵션을 붙여서 다시 실행해봐.',
    ],
    bannedPhrases: ['-p 80:8000', '80->8000', '80 -> 8000', '80→8000', '80 → 8000', '80번과 8000번', '80번을 8000번', '80번에서 8000번', '80번 문과 8000번'],
    solution: '포트 매핑(바깥 문과 안쪽 창구 잇기)이 없거나 안쪽 번호가 앱 창구(8000)와 달랐다. docker rm -f enroll → docker run -p 80:8000 enroll:1.0',
    solutionSteps: [
      { cmd: 'docker rm -f enroll', host: 'srv-new' },
      { cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' },
    ],
    concept: 'portMapping',
    lesson: 'Dockerfile의 EXPOSE는 "안쪽 창구 번호" 메모일 뿐! -p 80:8000 으로 바깥 문과 이어야 들어와요.',
  },
  {
    id: 's5-volume',
    stage: 5,
    title: '데이터 증발',
    alert: 'DB(신청 기록 창고)를 업데이트하는 자동 작업(스크립트)이 DB 컨테이너를 지우고 새로 만들었는데… 수강신청 내역이 전부 0건이에요!!! 학생들 난리 났어요!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's5-drift', delay: 8 },
    inject: (w) => {
      // The update script removed and recreated every DB container on srv-db (same name, ports, mounts,
      // state). A fresh container has an empty writable layer; only data on a volume survives.
      const d = w.docker!;
      for (const c of d.containers) {
        if (isDb(c) && c.host === DB_ENDPOINT.host) {
          c.id = nextContainerId(d);
          c.rows = 0;
        }
      }
    },
    check: (w) => {
      const db = appDb(w);
      return !!db && dataOnVolume(db) && dbRows(w, db) > 0;
    },
    hints: [
      'DB 컨테이너를 지우고 새로 만들었더니 데이터가 사라졌어. 데이터는 원래 어디에 적혀 있었을까?',
      'DB 서버(srv-db)에 접속해서 DB 로그(DB가 남긴 기록)를 봐. 컨테이너 안에 적은 데이터는 그 컨테이너를 지우면 같이 사라져. 컨테이너를 새로 만들어도 남는 공간이 필요해.',
      '식당 전용 사물함 같은 저장소(볼륨)를 DB가 데이터를 쓰는 폴더(로그의 data dir)에 붙여서 DB 컨테이너를 새로 실행해봐. 신청 앱이 찾아오는 포트도 그대로 열어줘야 해. 백업은 빈 사물함으로 복원돼.',
    ],
    bannedPhrases: [
      '-v dbdata',
      'docker volume create',
      ':/var/lib/mysql',
      '/var/lib/mysql에 붙',
      '/var/lib/mysql 에 붙',
      '/var/lib/mysql에 볼륨',
      '/var/lib/mysql 에 볼륨',
      '볼륨을 /var/lib/mysql',
    ],
    solution: 'ssh srv-db → docker rm -f db → docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8 (볼륨·컨테이너 이름은 아무거나 괜찮아요)',
    solutionSteps: [
      { cmd: 'docker rm -f db', host: 'srv-db' },
      { cmd: 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8', host: 'srv-db' },
    ],
    concept: 'volume',
    lesson: '컨테이너 안은 컨테이너를 지우면 같이 사라지는 임시 메모장! (재시작은 괜찮아요) 중요한 데이터는 볼륨(사물함)에 저장해야 컨테이너를 새로 만들어도 남아요.',
  },
];

export const stage5: StageDef = {
  id: 5,
  title: '"내 컴퓨터에선 되는데…"',
  subtitle: '앱을 통째로 포장하는 컨테이너(Docker)',
  topics: ['VM vs 컨테이너', '이미지 · Dockerfile · 레지스트리', '포트 매핑 (-p)', '볼륨'],
  intro: [
    { who: 'boss', text: '2차 수강신청 대비! 신청 서버를 한 대 더 늘리기로 했어. 동료가 손으로 설치하는 중이야.' },
    { who: 'lion', text: '이번엔 설치 매뉴얼대로 했으니 괜찮겠죠?', mood: 'happy' },
    { who: 'mentor', text: '…설치(배포) 끝나면 꼭 확인해봐. 새 서버(srv-new)의 배포 기록부터.' },
  ],
  outro: [
    { who: 'lion', text: '서버마다 설치 상태가 달라서 안 됐던 거예요. 밀키트처럼 통째로 포장하니까 어디서든 똑같이 돌아가네요!', mood: 'happy' },
    { who: 'mentor', text: '그게 바로 컨테이너야. 이미지(밀키트 원본) → 레지스트리(냉동고) → 컨테이너(한 끼). 그리고 데이터는 볼륨(사물함)에!' },
    { who: 'boss', text: '좋아. 근데 서버가 10대, 컨테이너가 30개가 되면… 이걸 다 손으로 관리할 거야?' },
  ],
  initialWorld: stage5World,
  objectives: [
    { id: 'log', text: '새 서버(srv-new)의 배포 기록 확인하기 (ssh srv-new → deploy log)', spot: 'desk', done: (_w, c) => c.events.includes('deploy_log_failed') },
    { id: 'recipe', text: '관제실 설계 보드에서 Dockerfile(레시피 카드) 완성', spot: 'board', done: (w) => w.flags['dockerfile:enroll'] === 'ok', after: ['log'] },
    { id: 'image', text: '관리 PC에서 이미지 만들기(build) → 레지스트리(이미지 보관소)에 올리기(push)', spot: 'desk', done: (w) => !!w.docker?.registry.some((i) => i.startsWith('enroll:')), after: ['recipe'] },
    { id: 'run', text: 'srv-new에서 컨테이너 실행', spot: 'desk', done: (w) => !!w.docker?.containers.some((c) => c.host === 'srv-new' && c.running && isEnroll(c)), after: ['image'] },
    {
      id: 'open',
      text: '학생 요청이 새 서버(srv-new)의 컨테이너까지 들어오게 하기',
      done: (w) => !!w.docker?.containers.some((c) => c.host === 'srv-new' && c.running && isEnroll(c) && enrollPublished(c)),
      after: ['run'],
      spot: 'desk',
      concept: 'portMapping',
      lesson: '-p 80:8000 은 서버의 바깥 문(80)과 컨테이너 안쪽 창구(8000)를 잇는 통로예요. 이게 있어야 학생 요청이 컨테이너까지 들어와요.',
    },
  ],
  scenarios,
  interactions: {
    rack1: { kind: 'consolePick', hosts: ['srv-old', 'srv-db'] },
    rack2: { kind: 'console', host: 'srv-new' },
    rack3: { kind: 'inspect', text: '빈 랙.' },
    rack4: { kind: 'inspect', text: '빈 랙.' },
    switch: { kind: 'inspect', text: '링크 정상.' },
    router: { kind: 'inspect', text: '정상.' },
    patch: { kind: 'inspect', text: '정상.' },
    pdu: { kind: 'inspect', text: '전원 정상.' },
    ups: { kind: 'inspect', text: 'UPS(비상 배터리) 정상.' },
    crac: { kind: 'inspect', text: '냉각 정상.' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'terminal' },
    board: { kind: 'board', board: 'dockerfile' },
  },
  health: (w) => {
    const r = dockerHealth(w);
    return emptyHealth(w, { availability: r.ok, errorRate: 1 - r.ok, latencyMs: r.latency, services: r.services, notes: r.notes });
  },
  panels: ['traffic', 'services'],
};
