import { duplicateIps, ping } from '../../sim/network';
import type { Scenario } from '../../sim/scenario';
import type { StageDef } from '../types';
import { cabledWorld, emptyHealth, networkPath, SERVERS, serverStatus } from '../worlds';

const scenarios: Scenario[] = [
  {
    id: 's2-dns',
    stage: 2,
    title: '이름을 못 찾음 (DNS)',
    alert: '웹 서버가 DB를 못 찾는대요! "db가 누구야?"라고 에러가 떠요.',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'objective', objective: 'dhcp', delay: 3 },
    inject: (w) => {
      delete w.net!.dns.db;
    },
    check: (w) => ping(w, 'web', 'db').ok,
    hints: [
      'ping을 이름(db)으로 해보고, 숫자 주소로도 해볼래? 결과가 다르면 큰 힌트야.',
      '숫자로는 되는데 이름으로는 안 된다면 길은 멀쩡한 거야. 이름을 숫자로 바꿔주는 "전화번호부"가 누구였지?',
      '그 전화번호부 장부를 열어서 db가 적혀 있는지 확인해봐. (dns 관련 명령어를 help에서 찾아봐)',
    ],
    bannedPhrases: ['dns add db', '10.0.1.20'],
    solution: 'DNS 장부에 db를 등록한다: dns add db 10.0.1.20',
    solutionSteps: [{ cmd: 'dns add db 10.0.1.20', host: 'ops' }],
    concept: 'dns',
    lesson: '컴퓨터는 이름이 아니라 IP로 찾아가요. 이름 → IP 변환은 DNS(전화번호부)의 일!',
    courseRef: ['풀서네 Lec02', '마서프 Lec01'],
  },
  {
    id: 's2-conflict',
    stage: 2,
    title: 'IP 충돌',
    alert: 'DB 연결이 됐다 안 됐다 해요… 수강신청 페이지가 반쯤 깨져요.',
    severity: 'warning',
    room: 'server',
    trigger: { type: 'after', scenario: 's2-dns', delay: 6 },
    inject: (w) => {
      // A teammate "fixed" the spare server by hand and copied the DB's address.
      const l3 = w.devices.spare.l3!;
      l3.mode = 'static';
      l3.ip = '10.0.1.20';
      l3.gw = '10.0.1.1';
    },
    check: (w) => duplicateIps(w).length === 0 && ping(w, 'web', 'db').loss === 0,
    hints: [
      'ping db를 여러 번 해봐. 응답이 들쭉날쭉하지? 왜 어떤 건 오고 어떤 건 안 올까?',
      '같은 도로명 주소를 두 집이 쓰면 택배가 어디로 갈까? 서버들의 주소를 하나씩 확인해봐.',
      '주소를 손으로 박아둔 서버가 있는지 찾아봐. 그 서버는 안내데스크에서 자동으로 받게 바꾸는 게 좋아.',
    ],
    bannedPhrases: ['ip set dhcp', 'spare'],
    solution: 'spare 서버가 DB와 같은 IP(10.0.1.20)를 고정으로 쓰고 있다. ssh spare → ip set dhcp',
    solutionSteps: [{ cmd: 'ip set dhcp', host: 'spare' }],
    concept: 'ip',
    lesson: '한 IP는 한 장비만! 손으로 박은 주소는 사고의 씨앗이에요. DHCP에 맡기세요.',
    courseRef: ['풀서네 Lec02'],
  },
  {
    id: 's2-gateway',
    stage: 2,
    title: '외부 접속 불가 (게이트웨이)',
    alert: '학생들이 집에서 접속이 안 된대요! 그런데 관리 PC에서는 web이 잘 보여요.',
    severity: 'critical',
    room: 'network',
    trigger: { type: 'after', scenario: 's2-conflict', delay: 6 },
    inject: (w) => {
      const l3 = w.devices.web.l3!;
      l3.mode = 'static';
      l3.ip = '10.0.1.10';
      l3.gw = '10.0.1.254';
    },
    check: (w) => ping(w, 'internet', 'web').ok,
    hints: [
      '건물 안에서는 되는데 건물 밖에서만 안 된다… 안과 밖을 이어주는 건 뭐였지?',
      'web 서버가 "밖으로 나가는 문"을 어디로 알고 있는지 확인해봐. 실제 라우터 주소랑 같아?',
      'web에 접속해서 주소 설정을 보고, 밖으로 나가는 문(gateway) 주소를 라우터 주소로 맞춰봐.',
    ],
    bannedPhrases: ['ip set gw 10.0.1.1', '10.0.1.254'],
    solution: 'web의 게이트웨이가 10.0.1.254로 잘못돼 있다. ssh web → ip set gw 10.0.1.1',
    solutionSteps: [{ cmd: 'ip set gw 10.0.1.1', host: 'web' }],
    concept: 'gateway',
    lesson: '같은 네트워크 안은 스위치가, 밖(인터넷)은 게이트웨이(라우터)가 길을 열어줘요.',
    courseRef: ['풀서네 Lec02'],
  },
];

export const stage2: StageDef = {
  id: 2,
  title: '서로 대화하게 만들기',
  subtitle: 'L2/L3 · IP, DHCP, DNS, 게이트웨이',
  topics: ['MAC · 스위치', 'IP 주소 · 서브넷', 'DHCP · DNS', '게이트웨이 · 라우터', 'ping'],
  intro: [
    { who: 'lion', text: '케이블은 다 꽂았는데… 서버들이 서로 연락을 못 해요.', mood: 'worried' },
    { who: 'mentor', text: '도로는 깔렸는데 집 주소가 없는 상태야. 주소(IP)가 있어야 편지를 보내지.' },
    { who: 'mentor', text: '관제실 관리 PC(책상)에서 터미널을 열어봐. help를 치면 쓸 수 있는 명령어가 나와.' },
    { who: 'system', text: '목표: 주소를 나눠주는 DHCP를 켜고, 서버끼리 ping이 되게 하자.' },
  ],
  outro: [
    { who: 'mentor', text: 'MAC은 문패, IP는 도로명 주소, DNS는 전화번호부, 게이트웨이는 건물 밖으로 나가는 문. 기억나지?' },
    { who: 'boss', text: '좋아, 이제 진짜 수강신청 서비스를 열어보자!' },
  ],
  initialWorld: cabledWorld,
  objectives: [
    { id: 'terminal', text: '관제실 관리 PC에서 터미널 열기', done: (_w, c) => c.events.includes('open:terminal') },
    { id: 'dhcp', text: 'DHCP 서버 켜서 서버들에 주소 나눠주기', done: (w) => !!w.net?.dhcpServer && SERVERS.every((id) => !!w.devices[id].l3?.ip), after: ['terminal'] },
    { id: 'ping', text: 'ping 으로 web 서버 응답 확인하기', done: (_w, c) => c.events.some((e) => e.startsWith('ping:web:ok') || e.startsWith('ping:10.0.1.10:ok')), after: ['dhcp'] },
  ],
  scenarios,
  interactions: {
    rack1: { kind: 'consolePick', hosts: ['web', 'db'] },
    rack2: { kind: 'console', host: 'spare' },
    rack3: { kind: 'inspect', text: '빈 랙.' },
    rack4: { kind: 'inspect', text: '빈 랙.' },
    switch: { kind: 'inspect', text: '스위치는 같은 네트워크 안에서 MAC 주소(문패)를 보고 배달해요. 링크는 모두 초록불!' },
    router: { kind: 'console', host: 'r1' },
    patch: { kind: 'inspect', text: '케이블 정상.' },
    pdu: { kind: 'power' },
    ups: { kind: 'inspect', text: 'UPS 연결됨. 정전 대비 완료!' },
    crac: { kind: 'inspect', text: '냉각 정상.' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'terminal' },
    board: { kind: 'inspect', text: '네트워크: 10.0.1.0/24 · 라우터(게이트웨이) 10.0.1.1 · DHCP 범위 .10~.30' },
  },
  health: (w) => {
    const services = Object.fromEntries(SERVERS.map((id) => [id, serverStatus(w, id)]));
    const path = networkPath(w);
    return emptyHealth(w, { availability: path.ok, errorRate: 1 - path.ok, notes: path.notes, services, latencyMs: path.ok < 1 ? 900 : 25 });
  },
  panels: ['links', 'traffic'],
};
