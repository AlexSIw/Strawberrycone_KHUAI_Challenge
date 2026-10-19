import { writeDockerfile } from '../../sim/actions';
import { enrollContainerReachable } from '../../sim/commands/docker';
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
        'srv-old': { python: '3.12.4', pulled: [] },
        'srv-new': { python: '3.9.18', pulled: [] },
        'srv-db': { python: '3.12.4', pulled: ['mysql:8'] },
      },
      containers: [{ id: 'a1b2c3d4e5f6', name: 'db', image: 'mysql:8', host: 'srv-db', ports: [3306, 3306], volume: null, running: true }],
      volumes: [],
      enrollments: 1520,
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
  const containers = d.containers.filter((c) => c.running && c.image.startsWith('enroll:') && c.ports?.[0] === 80).length;
  const cap = PER_SERVER * (1 + containers); // srv-old (manual install) + containers
  const served = Math.min(1, cap / Math.max(1, w.traffic.rps));
  if (served < 1) notes.push(`신청 서버 부족: ${Math.round(served * 100)}%만 처리`);
  const db = d.containers.find((c) => c.name === 'db' && c.running);
  if (!db) notes.push('DB 컨테이너가 꺼져 있음');
  if (d.enrollments === 0) notes.push('신청 내역 0건! 데이터 유실');
  const dataOk = db ? (d.enrollments > 0 ? 1 : 0.3) : 0;
  const services: Record<string, 'up' | 'degraded' | 'down'> = {
    'srv-old': 'up',
    'srv-new': containers > 0 ? 'up' : d.manualDeploy?.status === 'failed' ? 'down' : 'degraded',
    db: !db ? 'down' : d.enrollments === 0 ? 'degraded' : 'up',
  };
  return { ok: served * dataOk, latency: served < 1 ? 1500 : 60, services, notes };
}

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
    check: (w) => !!w.docker?.containers.some((c) => c.running && c.host === 'srv-new' && c.image.startsWith('enroll:')),
    hints: [
      '기존 서버에선 잘 되는 앱이 새 서버에선 안 돼. 두 서버가 뭐가 다를까? 새 서버의 배포 기록부터 봐.',
      '서버마다 설치된 프로그램 버전이 달라. 매번 맞춰 깔기보단, 앱과 실행 환경을 통째로 포장하면 어떨까? (밀키트처럼)',
      '설계 보드에서 레시피(Dockerfile)를 완성하고 → 이미지로 만들고 → 냉동고(레지스트리)에 올린 뒤 → 새 서버에서 꺼내 실행해봐.',
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
    lesson: '서버마다 환경이 달라서(configuration drift) 실패했어요. 이미지로 묶으면 어디서든 똑같이 실행돼요!',
    courseRef: ['마서프 Lec04–08'],
  },
  {
    id: 's5-port',
    stage: 5,
    title: '컨테이너는 떴는데 접속 불가',
    alert: '새 서버 컨테이너는 Up 상태인데… 학생 요청이 하나도 안 들어가요.',
    severity: 'warning',
    room: 'noc',
    optional: true,
    trigger: {
      type: 'condition',
      when: (w) => !!w.docker?.containers.some((c) => c.running && c.image.startsWith('enroll:') && c.ports?.[0] !== 80),
    },
    inject: () => {},
    check: (w) => enrollContainerReachable(w) && !w.docker!.containers.some((c) => c.running && c.image.startsWith('enroll:') && c.ports?.[0] !== 80),
    hints: [
      '컨테이너 목록에서 PORTS 칸을 봐. 다른 서버랑 뭐가 달라?',
      '컨테이너는 잠긴 방이야. 길가 문(80번)과 방 안 창구(8000번)를 이어줘야 손님이 들어와.',
      '컨테이너를 지우고, 포트를 이어주는 옵션을 붙여서 다시 실행해봐.',
    ],
    bannedPhrases: ['-p 80:8000'],
    solution: '포트 매핑 없이 실행했다. docker rm -f enroll → docker run -p 80:8000 enroll:1.0',
    solutionSteps: [
      { cmd: 'docker rm -f enroll', host: 'srv-new' },
      { cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' },
    ],
    concept: 'portMapping',
    lesson: 'EXPOSE는 "안쪽 창구 번호" 메모일 뿐! -p 80:8000 으로 바깥 문과 이어야 들어와요.',
    courseRef: ['마서프 Lec08–09'],
  },
  {
    id: 's5-volume',
    stage: 5,
    title: '데이터 증발',
    alert: 'DB 컨테이너가 재시작됐는데… 수강신청 내역이 전부 0건이에요!!! 학생들 난리 났어요!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's5-drift', delay: 8 },
    inject: (w) => {
      // A routine restart recreated the db container; its data lived inside the container.
      const db = w.docker!.containers.find((c) => c.name === 'db');
      if (db && !db.volume) w.docker!.enrollments = 0;
    },
    check: (w) => !!w.docker?.containers.some((c) => c.name === 'db' && c.running && !!c.volume) && w.docker!.enrollments > 0,
    hints: [
      'DB 컨테이너를 다시 켰더니 데이터가 사라졌어. 데이터는 원래 어디에 적혀 있었을까? DB 로그를 봐.',
      '컨테이너 안에 적은 메모는 컨테이너와 함께 사라져. 컨테이너가 없어져도 남는 공간이 필요해.',
      '식당 전용 사물함 같은 저장소(볼륨)를 붙여서 DB 컨테이너를 새로 실행하면, 백업도 거기로 복원돼.',
    ],
    bannedPhrases: ['-v dbdata', 'docker volume create'],
    solution: 'ssh srv-db → docker rm -f db → docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8',
    solutionSteps: [
      { cmd: 'docker rm -f db', host: 'srv-db' },
      { cmd: 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8', host: 'srv-db' },
    ],
    concept: 'volume',
    lesson: '컨테이너 안(쓰기 레이어)은 임시 메모장! 중요한 데이터는 볼륨(사물함)에 저장해야 남아요.',
    courseRef: ['마서프 Lec10'],
  },
];

export const stage5: StageDef = {
  id: 5,
  title: '"내 컴퓨터에선 되는데…"',
  subtitle: 'Container · Docker',
  topics: ['VM vs 컨테이너', '이미지 · Dockerfile · 레지스트리', '포트 매핑 (-p)', '볼륨'],
  intro: [
    { who: 'boss', text: '2차 수강신청 대비! 신청 서버를 한 대 더 늘리기로 했어. 동료가 손으로 설치하는 중이야.' },
    { who: 'mentor', text: '서비스가 5개로 늘어나니 서버마다 설치 상태가 조금씩 달라. 이게 바로 "내 컴퓨터에선 되는데" 문제지.' },
    { who: 'lion', text: '밀키트처럼 통째로 포장하면 안 될까요…?', mood: 'worried' },
    { who: 'mentor', text: '오, 그게 바로 컨테이너야.' },
  ],
  outro: [
    { who: 'mentor', text: '이미지(밀키트 원본) → 레지스트리(냉동고) → 컨테이너(한 끼). 그리고 데이터는 볼륨(사물함)에!' },
    { who: 'boss', text: '좋아. 근데 서버가 10대, 컨테이너가 30개가 되면… 이걸 다 손으로 관리할 거야?' },
  ],
  initialWorld: stage5World,
  objectives: [
    { id: 'log', text: '새 서버(srv-new)의 배포 기록 확인하기 (ssh srv-new → deploy log)', done: (_w, c) => c.events.includes('deploy_log_failed') },
    { id: 'recipe', text: '관제실 설계 보드에서 Dockerfile(레시피 카드) 완성', done: (w) => w.flags['dockerfile:enroll'] === 'ok', after: ['log'] },
    { id: 'image', text: '관리 PC에서 이미지 빌드 → 레지스트리에 push', done: (w) => !!w.docker?.registry.some((i) => i.startsWith('enroll:')), after: ['recipe'] },
    { id: 'run', text: 'srv-new 에서 컨테이너 실행', done: (w) => !!w.docker?.containers.some((c) => c.host === 'srv-new' && c.running && c.image.startsWith('enroll:')), after: ['image'] },
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
    ups: { kind: 'inspect', text: 'UPS 정상.' },
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
