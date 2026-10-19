import { duplicateIps, ping } from '../../sim/network';
import type { Scenario } from '../../sim/scenario';
import type { World } from '../../sim/types';
import type { StageDef } from '../types';
import { cabledWorld, emptyHealth, networkPath, SERVERS, serverStatus } from '../worlds';

/** web asks for "db" by name and the DB machine itself answers (not just any box that owns that address). */
function webReachesDb(w: World): { ok: boolean; loss: number } {
  const p = ping(w, 'web', 'db');
  return { ok: p.ok && p.targetId === 'db', loss: p.loss };
}

const scenarios: Scenario[] = [
  {
    id: 's2-dns',
    stage: 2,
    title: 'web 서버가 db를 못 찾음',
    alert: 'web 서버가 db를 못 찾는대요! "db가 누구야?"라고 에러가 떠요.',
    severity: 'critical',
    room: 'noc',
    // After the setup (terminal → DHCP → ping) is finished.
    trigger: { type: 'gate', objectives: ['terminal', 'dhcp', 'ping'] },
    inject: (w) => {
      // Someone tidied up the name book and dropped db's line.
      delete w.net!.dns.db;
    },
    // The name has to lead to the DB machine itself: a guessed address that some other box answers doesn't count.
    check: (w) => webReachesDb(w).ok,
    hints: [
      '에러를 다시 읽어봐. web이 db까지 가는 "길"을 모르는 걸까, db가 "누군지" 모르는 걸까? ping db 하면 정확히 뭐라고 나와?',
      'db의 숫자 주소로도 ping 해봐 (숫자 주소는 주소를 나눠준 안내데스크(DHCP)가 알고 있어). 숫자로는 되는데 이름으로 안 되면, 이름을 숫자로 바꿔주는 "전화번호부"가 누구였지?',
      '그 전화번호부 장부(dns 명령어)를 열어서 db가 있는지 봐. db의 진짜 주소는 안내데스크가 나눠준 주소 목록(dhcp status)이나 db 서버의 ip addr에서 확인할 수 있어.',
    ],
    bannedPhrases: ['dns add db', '10.0.1.20'],
    solution: 'DNS 장부에 db를 등록한다: dns add db 10.0.1.20',
    solutionSteps: [{ cmd: 'dns add db 10.0.1.20', host: 'ops' }],
    concept: 'dns',
    lesson: '컴퓨터는 이름이 아니라 숫자 주소(IP)로 찾아가요. 이름을 숫자 주소로 바꿔주는 건 DNS(전화번호부)의 일!',
  },
  {
    id: 's2-conflict',
    stage: 2,
    title: 'DB 연결이 됐다 안 됐다',
    alert: 'DB 연결이 됐다 안 됐다 해요… 수강신청 페이지가 반쯤 깨져요.',
    severity: 'warning',
    // Where the symptom is seen (ping db from the NOC desk), not where the culprit sits.
    room: 'noc',
    trigger: { type: 'gate', scenarios: ['s2-dns'] },
    inject: (w) => {
      // A teammate "fixed" the spare server by hand and copied the DB's address.
      const l3 = w.devices.spare.l3!;
      l3.mode = 'static';
      l3.ip = '10.0.1.20';
      l3.gw = '10.0.1.1';
    },
    // No live duplicate, and "db" leads to the DB machine itself. Switching the copycat off also counts
    // (a real stop-gap); moving the DB's own address away does not, because then "db" reaches the wrong box.
    check: (w) => {
      const r = webReachesDb(w);
      return duplicateIps(w).length === 0 && r.ok && r.loss === 0;
    },
    hints: [
      'ping db를 여러 번 해봐. 응답이 들쭉날쭉하지? 왜 어떤 건 오고 어떤 건 안 올까?',
      '같은 도로명 주소를 두 집이 쓰면 택배가 어디로 갈까? 서버들의 주소를 하나씩 확인해봐.',
      '주소를 손으로 박아둔 서버가 있는지 찾아봐. 네트워크로 안 들어가지는 서버는 랙 앞에 가서 콘솔(장비에 직접 붙은 화면·키보드)로 열 수 있어. 그 서버는 안내데스크에서 자동으로 받게 바꾸는 게 좋아.',
    ],
    // The culprit's name in English and Korean, and where it sits (rack 2).
    bannedPhrases: ['ip set dhcp', 'spare', '예비 서버', '예비서버', 'rack2', '랙2', '랙 2', '2번 랙'],
    solution:
      'spare 서버가 DB와 같은 IP(10.0.1.20)를 고정으로 쓰고 있다. spare는 DNS 주소(10.0.1.30)로는 닿지 않으니 rack2 콘솔로 spare에 접속 → ip set dhcp. (급한 불은 spare 전원을 내려서 끌 수도 있지만, 다시 켜기 전에 주소를 고쳐야 한다)',
    solutionSteps: [{ cmd: 'ip set dhcp', host: 'spare' }],
    concept: 'ip',
    lesson: '한 IP는 한 장비만! 이미 누가 쓰는 주소를 손으로 박으면 충돌해요. 손으로 정할 땐 비어 있는 주소인지 꼭 확인하고, 헷갈리면 DHCP에 맡기세요. (겹친 장비를 끄기만 했다면, 다시 켜기 전에 주소부터!)',
  },
  {
    id: 's2-gateway',
    stage: 2,
    title: '학생들만 접속 불가',
    alert: '학생들이 집에서 접속이 안 된대요! 그런데 관리 PC에서는 web이 잘 보여요.',
    severity: 'critical',
    // The comparison in the alert is made from the NOC; the router is for the player to work out.
    room: 'noc',
    trigger: { type: 'gate', scenarios: ['s2-conflict'] },
    inject: (w) => {
      const l3 = w.devices.web.l3!;
      l3.mode = 'static';
      l3.ip = '10.0.1.10';
      l3.gw = '10.0.1.254';
    },
    check: (w) => ping(w, 'internet', 'web').ok,
    hints: [
      '관리 PC에서 web까지 가는 길이랑, 학생 집에서 web까지 가는 길은 뭐가 다를까?',
      '건물 안에서는 되는데 밖에서만 안 된다면, 안과 밖을 잇는 문이 수상해. web 서버가 "밖으로 나가는 문"을 어디로 알고 있는지, 실제 라우터 주소랑 같은지 확인해봐.',
      'web에 접속해서 주소 설정을 보고, 밖으로 나가는 문(gateway) 주소를 라우터 주소로 맞춰봐.',
    ],
    // Re-asking DHCP on web also restores the right gateway, so that command is a full answer too.
    bannedPhrases: ['ip set gw 10.0.1.1', '10.0.1.254', 'ip set dhcp'],
    solution: 'web의 게이트웨이가 10.0.1.254로 잘못돼 있다. ssh web → ip set gw 10.0.1.1',
    solutionSteps: [{ cmd: 'ip set gw 10.0.1.1', host: 'web' }],
    concept: 'gateway',
    lesson: '같은 네트워크 안은 스위치가, 밖(인터넷)은 게이트웨이(라우터)가 길을 열어줘요. 게이트웨이는 라우터의 진짜 주소여야 해요 (DHCP로 다시 받아도 맞춰져요).',
  },
];

export const stage2: StageDef = {
  id: 2,
  title: '서로 대화하게 만들기',
  subtitle: '주소(IP)와 이름(DNS)으로 서버끼리 연결하기',
  topics: ['MAC · 스위치', 'IP 주소 · 서브넷', 'DHCP · DNS', '게이트웨이 · 라우터', 'ping'],
  intro: [
    { who: 'lion', text: '케이블은 다 꽂았는데… 서버들이 서로 연락을 못 해요.', mood: 'worried' },
    { who: 'mentor', text: '도로는 깔렸는데 집 주소가 없는 상태야. 주소(IP)가 있어야 편지를 보내지.' },
    { who: 'mentor', text: '관제실 관리 PC(책상)에서 터미널(글자로 명령을 치는 창)을 열어봐. help를 치면 쓸 수 있는 명령어가 나와.' },
    { who: 'system', text: '목표: 주소를 자동으로 나눠주는 DHCP를 켜고, 서버끼리 ping(상대에게 "들려?" 하고 신호 보내기)이 되게 하자.' },
  ],
  outro: [
    { who: 'mentor', text: 'MAC은 문패, IP는 도로명 주소, DNS는 전화번호부, 게이트웨이는 건물 밖으로 나가는 문. 이 넷만 있으면 어디든 찾아가.' },
    { who: 'boss', text: '좋아, 이제 진짜 수강신청 서비스를 열어보자!' },
  ],
  initialWorld: cabledWorld,
  objectives: [
    { id: 'terminal', text: '관제실 관리 PC에서 터미널 열기', spot: 'desk', done: (_w, c) => c.events.includes('open:terminal') },
    {
      id: 'dhcp',
      text: 'DHCP 서버 켜서 서버들에 주소 나눠주기',
      done: (w) => !!w.net?.dhcpServer && SERVERS.every((id) => !!w.devices[id].l3?.ip),
      after: ['terminal'],
      spot: 'desk',
      concept: 'dhcp',
      lesson: 'DHCP 서버를 켜자 서버들이 알아서 주소를 받았어요. 주소를 손으로 하나하나 박지 않아도 돼요!',
    },
    { id: 'ping', text: 'ping으로 web 서버 응답 확인하기', spot: 'desk', done: (_w, c) => c.events.some((e) => e.startsWith('ping:web:ok') || e.startsWith('ping:10.0.1.10:ok')), after: ['dhcp'] },
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
    board: { kind: 'inspect', text: '네트워크: 10.0.1.0/24 (10.0.1.로 시작하는 주소) · 라우터(게이트웨이) 10.0.1.1 · DHCP가 나눠주는 주소 10.0.1.10~10.0.1.30' },
  },
  health: (w) => {
    const services = Object.fromEntries(SERVERS.map((id) => [id, serverStatus(w, id)]));
    const path = networkPath(w);
    return emptyHealth(w, { availability: path.ok, errorRate: 1 - path.ok, notes: path.notes, services, latencyMs: path.ok < 1 ? 900 : 25 });
  },
  panels: ['links', 'traffic'],
};
