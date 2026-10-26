// D-4: 네트워크 (v1 stage 2 + IOS). SSH into TOR-01 over the management network, create VLANs 10/20 and
// put the three new servers in them, give CORE-01 the VLAN 10/20 gateway (single-member HSRP), register
// the servers in DNS, look at the DHCP pools, save the config.
// Teaching incidents: a server port moved to the wrong VLAN; the library Wi-Fi DHCP pool runs dry.
// The other VLANs, the cores' other SVIs, the campus and the DHCP/DNS servers are pre-built by 선배.
import { campusDelivery, hostDelivery, reach } from '../../sim/network';
import type { Device, PlayContext, World } from '../../sim/types';
import { ipOf } from '../incidents/d4';
import { ADDR } from '../topology';
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK } from './common';

const TOR = 'TOR-01';
const CORE = 'CORE-01';
const NEW_VLANS = [10, 20];
/** Server → TOR-01 access port → VLAN (the D-Day plan) */
const PORT_PLAN: [string, string, number][] = [
  ['web', 'Gi1/0/1', 10],
  ['web2', 'Gi1/0/2', 10],
  ['db', 'Gi1/0/3', 20],
];
/** DNS records this day adds */
const RECORDS: [string, string][] = [
  ['web', ipOf('web')],
  ['db', ipOf('db')],
];

const nd = (w: World, id: string) => w.devices[id]?.nd;

/** Take a fresh startup-config snapshot (same shape as topology.ts), so the day starts with nothing unsaved. */
export function resave(d: Device | undefined): void {
  const n = d?.nd;
  if (!n) return;
  n.startup = JSON.stringify({ ifs: n.ifs, vlans: n.vlans, svis: n.svis, stpOff: n.stpOff });
  n.dirty = false;
}

const vlansMade = (w: World) => NEW_VLANS.filter((v) => v in (nd(w, TOR)?.vlans ?? {}));
const portsSet = (w: World) =>
  PORT_PLAN.filter(([, p, v]) => {
    const f = nd(w, TOR)?.ifs[p];
    return f?.mode === 'access' && f.accessVlan === v;
  });
/** `interface vlan N` with `ip address 10.10.N.2 /24` and `standby 1 ip 10.10.N.1`, not shut down. */
const gatewaysSet = (w: World) =>
  NEW_VLANS.filter((v) => {
    const s = nd(w, CORE)?.svis[v];
    return !!s && !s.shutdown && s.ip === ADDR.core(v, 1) && s.mask === 24 && s.hsrp?.vip === ADDR.gw(v);
  });
const lookup = (w: World, name: string) => {
  const dns = w.net?.dns ?? {};
  const k = Object.keys(dns).find((x) => x.toLowerCase() === name);
  return k ? dns[k] : undefined;
};
const recordsSet = (w: World) => RECORDS.filter(([n, ip]) => lookup(w, n) === ip);

/**
 * Looked at the address pools on dhcp01 itself: a `dhcp pool list|show` typed while the latest ssh
 * points at dhcp01 (not one typed on the 관리 PC before getting there).
 */
function poolsSeen(c: PlayContext): boolean {
  if (!c.events.includes('ssh:dhcp01')) return false;
  const names = ['dhcp01', ADDR.dhcp01];
  let onDhcp = false;
  for (const x of c.commands) {
    const ssh = /^ssh\s+(?:\S+@)?(\S+)/i.exec(x);
    if (ssh) onDhcp = names.includes(ssh[1].toLowerCase());
    else if (/^(exit|logout)$/i.test(x)) onDhcp = false;
    else if (onDhcp && /^dhcp\s+pool\s+(list|show)\b/.test(x)) return true;
  }
  return false;
}
const savedGear = (w: World) => [TOR, CORE].filter((id) => nd(w, id)?.dirty === false);
/**
 * The 관리 PC session is on `names` (a host's name or address) now, as far as the typed lines tell: its latest
 * ssh went there and no exit came after it. (Leaving ns1 to fix something else un-ticks "ssh ns1".)
 */
function onHostNow(c: PlayContext, names: string[]): boolean {
  let at: string | null = null;
  for (const x of c.commands) {
    const ssh = /^ssh\s+(?:\S+@)?(\S+)/i.exec(x);
    if (ssh) at = ssh[1].toLowerCase();
    else if (/^(exit|logout)$/i.test(x)) at = null;
  }
  return at !== null && names.includes(at);
}
const ev = (c: PlayContext, e: string) => c.events.includes(e);
/** The player has reached device `dev` (ssh, or any IOS line typed on it, e.g. at its console). */
const onDevice = (c: PlayContext, dev: string) => c.events.some((e) => e === `ssh:${dev}` || e.startsWith(`ios:${dev}:`));
/** TOR-01 `port` is an access port in `vlan`. */
const portIn = (w: World, port: string, vlan: number) => {
  const f = nd(w, TOR)?.ifs[port];
  return f?.mode === 'access' && f.accessVlan === vlan;
};
const sviOf = (w: World, vlan: number) => nd(w, CORE)?.svis[vlan];

export const day1: DaySpec = {
  id: 1,
  label: 'D-4',
  date: '02-06',
  clock: WEEKDAY_CLOCK,
  fixed: [
    { template: 'd4-vlan', trigger: { type: 'gate', objectives: ['gateway'] } },
    { template: 'd4-dhcp', trigger: { type: 'gate', objectives: ['wr'] } },
  ],
  // The typing-heaviest weekday: no random extra on top of its two teaching incidents.
  extras: [0, 0],
  mapSwitch: 'TOR-01',
  mapDevices: ['web', 'web2', 'db'],
  title: '네트워크',
  subtitle: 'VLAN · 게이트웨이 · DHCP · DNS · IOS',
  topics: ['사설 IP와 /24', 'VLAN과 L2·L3 스위치', '게이트웨이와 HSRP', 'DHCP · DNS', 'IOS 명령 모드와 syslog', '관리망(OOB)'],
  intro: [
    { who: 'boss', text: 'D-4. 어제 서버는 다 꽂았지? 오늘은 장비들이 서로 대화하게 만든다.' },
    { who: 'mentor', text: '컴퓨터끼리는 IP 주소라는 번호로 서로를 찾아. 10.10.10.11처럼 점으로 나눈 숫자 네 칸이야. 주소 계획은 관제실 설계 보드에 있어.' },
    { who: 'mentor', text: '서버마다 동네(VLAN)를 정해주고, 동네와 동네를 잇는 문(게이트웨이)을 코어 스위치에 달고, 이름을 주소로 바꿔 주는 전화번호부(DNS)에도 올리자.' },
    {
      who: 'mentor',
      text: '스위치는 관리 PC에서 ssh로 원격 접속해서 설정해. 처음 하는 순서는 목표 아래에 한 단계씩 나오니까 따라오면 돼. 막히면 ? 를 쳐 봐. 다음에 올 수 있는 말을 알려줘.',
    },
    { who: 'boss', text: '학생 접속은 아직 없어. 대신 도서관 와이파이 같은 캠퍼스 건물들은 오늘도 우리 네트워크로 인터넷을 쓰니까 조심해서!' },
    { who: 'lion', text: '동네 나누고, 문 달고, 전화번호부에 올리기! 해볼게요.', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: 'VLAN은 동네, 코어의 VLAN 인터페이스는 동네 문, DNS는 전화번호부, write memory는 저장 버튼. 오늘 다 해봤네.' },
    {
      who: 'mentor',
      text: '하나만 더. CORE-01에서 show standby brief 를 쳐 보면 Standby(대기 짝)가 unknown인 줄이 있어: 오늘 만든 VLAN 10·20, 그리고 K8S용 VLAN 40. 게이트웨이를 코어 한 대만 맡고 있다는 뜻이야. 그 한 대가 고장 나면 끝이니까, 짝은 D-1에 세우자.',
    },
    { who: 'boss', text: '내일(D-3)은 드디어 수강신청 웹 서비스를 연다!' },
  ],
  recap: {
    built: [
      '서버실 1번 랙에 새 서버 3대: WEB-01·WEB-02(웹 서버)와 DB-01(신청 기록을 보관하는 DB 서버)',
      '서버마다 전원 A·B 두 줄 (한 줄이 끊겨도 안 꺼져요)',
      '서버 케이블을 1번 랙 위 스위치 TOR-01의 1·2·3번 포트(Gi1/0/1~3)에 연결',
      '관제 화면(NOC): NMS 탭은 네트워크 장비, FMS 탭은 전기·냉방을 지켜봐요',
    ],
    concepts: ['datacenter', 'rack', 'pdu', 'portled', 'osi', 'ups'],
  },
  objectives: [
    {
      id: 'ssh',
      text: '관리 PC에서 TOR-01에 원격 접속하기 (ssh TOR-01)',
      why: '관리 PC는 데이터센터 장비에 글자로 명령을 보내는 컴퓨터예요. ssh는 네트워크로 다른 장비에 원격 접속하는 명령인데, 장비 관리 전용 길(관리망)로 들어가서 서비스 길이 망가져도 접속할 수 있어요. 오늘은 여기서 스위치들에 들어가 설정을 바꿔요.',
      spot: 'desk',
      done: (_w, c) => c.events.includes('ssh:TOR-01'),
      concept: 'oob',
      lesson: '장비 관리용 길(관리망, 10.10.250.x)은 서비스가 다니는 길과 따로 있어요. 그래서 서비스 네트워크가 망가져도 관리 PC에서 장비에 들어갈 수 있어요.',
      steps: [
        {
          text: '관제실 관리 PC 앞에서 E: 터미널 열기',
          why: '터미널은 글자로 명령을 입력하는 창이에요. 처음엔 관리 PC(ops) 안에 있어요',
          done: (_w, c) => ev(c, 'open:terminal') || ev(c, 'ssh:TOR-01'),
        },
        {
          text: 'TOR-01에 원격 접속',
          cmd: 'ssh TOR-01',
          why: '프롬프트가 TOR-01> 로 바뀌면 스위치 안이에요. 빨간 % 줄은 "못 알아들었어요"라는 뜻이고, ^ 가 틀린 곳을 가리켜요',
          done: (_w, c) => ev(c, 'ssh:TOR-01'),
        },
      ],
    },
    {
      id: 'vlan',
      text: 'TOR-01에 VLAN 10(WEB)·20(DB) 만들기',
      why: 'VLAN은 스위치 하나를 여러 개의 독립된 네트워크로 나누는 설정이에요. 오늘은 웹 서버(WEB: 수강신청 화면 담당)와 DB 서버(신청 기록 창고)를 다른 VLAN에 넣어서, 서로 필요한 길로만 오가게 할 거예요. 먼저 TOR-01에 VLAN 10(웹 서버용)과 VLAN 20(DB 서버용)을 만들어요.',
      spot: 'desk',
      done: (w) => vlansMade(w).length === NEW_VLANS.length,
      progress: (w) => `${vlansMade(w).length}/${NEW_VLANS.length}`,
      after: ['ssh'],
      concept: 'vlan',
      lesson: '스위치 한 대 안에 동네(VLAN)를 둘 만들었어요. 같은 동네끼리만 바로 대화하고, 다른 동네로 가려면 문(게이트웨이)을 거쳐야 해요.',
      steps: [
        {
          text: '관리자 모드로',
          cmd: 'enable',
          why: '> 는 보기만 하는 모드예요. 프롬프트가 TOR-01# 으로 바뀌어요',
          done: (w, c) => ev(c, `ios:${TOR}:enable`) || vlansMade(w).length > 0,
        },
        {
          text: '설정 모드로',
          cmd: 'configure terminal',
          why: '설정을 바꾸려면 (config)# 모드여야 해요 (줄여서 conf t)',
          done: (w, c) => ev(c, `ios:${TOR}:configure terminal`) || vlansMade(w).length > 0,
        },
        {
          text: 'VLAN 10 만들기',
          cmd: 'vlan 10',
          why: '프롬프트가 (config-vlan)# 으로 바뀌면 VLAN 10의 설정 안이에요. name WEB 으로 알아보기 쉬운 이름을 붙여도 돼요(선택)',
          done: (w) => vlansMade(w).includes(10),
        },
        { text: 'VLAN 20 만들기', cmd: 'vlan 20', why: '그 자리에서 바로 쳐도 돼요. 이름은 name DB', done: (w) => vlansMade(w).includes(20) },
      ],
    },
    {
      id: 'ports',
      text: 'TOR-01 서버 포트를 VLAN에 넣기: Gi1/0/1(WEB-01)·Gi1/0/2(WEB-02)는 VLAN 10, Gi1/0/3(DB-01)은 VLAN 20',
      why: '스위치 포트마다 어느 VLAN에 속할지 정해 줘야, 그 포트에 꽂힌 서버가 그 VLAN에 들어가요. 지금 세 서버의 포트는 처음 상태인 기본 VLAN 1에 있어서 서버들이 아직 자기 네트워크에 들어가지 못했어요. 배선표대로 WEB-01·WEB-02 포트는 VLAN 10, DB-01 포트는 VLAN 20에 넣어요.',
      spot: 'desk',
      done: (w) => portsSet(w).length === PORT_PLAN.length,
      progress: (w) => `${portsSet(w).length}/${PORT_PLAN.length}`,
      after: ['vlan'],
      concept: 'l2l3',
      lesson: '포트마다 동네를 정하는 건 L2(같은 동네 배달) 일이에요. 이제 웹 서버와 DB 서버는 서로 다른 동네라, 둘을 이어 줄 L3(동네 사이 길 찾기)가 필요해요.',
      steps: [
        {
          text: 'WEB-01이 꽂힌 포트의 설정으로 들어가기',
          cmd: 'interface Gi1/0/1',
          why: 'Gi1/0/1 = 1번 포트(Gi = 기가비트). 설정 모드에서 쳐요. 프롬프트가 (config-if)# 로 바뀌면 그 포트의 설정 안이에요',
          done: (w, c) => ev(c, `ios:${TOR}:interface Gi1/0/1`) || portIn(w, 'Gi1/0/1', 10),
        },
        {
          text: '그 포트를 VLAN 10에 넣기',
          cmd: 'switchport access vlan 10',
          why: 'access 포트 = VLAN 하나에만 속하는, 서버를 꽂는 포트예요',
          done: (w) => portIn(w, 'Gi1/0/1', 10),
        },
        { text: 'Gi1/0/2(WEB-02)도 VLAN 10에 넣기', why: '다른 포트로 옮길 땐 interface Gi1/0/2 부터 다시 쳐요', done: (w) => portIn(w, 'Gi1/0/2', 10) },
        { text: 'Gi1/0/3(DB-01)은 VLAN 20에 넣기', why: 'DB 서버는 웹 서버와 다른 VLAN이에요', done: (w) => portIn(w, 'Gi1/0/3', 20) },
      ],
    },
    {
      id: 'gateway',
      text: 'CORE-01에 VLAN 10·20 게이트웨이 만들기 (CORE-01 자기 주소 .2, 서버들이 쓰는 가상 게이트웨이 .1)',
      why: '게이트웨이는 서버가 다른 VLAN(다른 네트워크)으로 갈 때 데이터를 맡기는 출구 주소예요. VLAN 사이 길을 찾아 주는 L3 스위치 CORE-01에 VLAN 10·20의 게이트웨이를 만들면, VLAN 10의 웹 서버와 VLAN 20의 DB 서버가 대화할 수 있어요. 주소 규칙은 10.10.<VLAN 번호>.x: .2는 CORE-01 자기 주소, .1은 서버들이 쓰는 가상 게이트웨이(HSRP)라 나중에 짝 코어가 이어받을 수 있어요.',
      spot: 'desk',
      done: (w) => gatewaysSet(w).length === NEW_VLANS.length,
      progress: (w) => `${gatewaysSet(w).length}/${NEW_VLANS.length}`,
      after: ['ports'],
      concept: 'hsrp',
      alsoConcepts: ['gateway'],
      lesson: '서버들의 게이트웨이(.1)는 코어 한 대에 박힌 주소가 아니라 가상 주소예요(HSRP). 지금은 VLAN 10·20을 CORE-01 혼자 맡고 있어서, show standby brief의 그 두 줄에 짝(Standby)이 unknown으로 나와요.',
      steps: [
        {
          text: '관리 PC로 돌아와 CORE-01에 접속',
          cmd: 'ssh CORE-01',
          why: '스위치 안에서는 ssh를 못 써요. end로 설정 모드를 나온 뒤 exit로 관리 PC(ops)에 돌아와서 접속해요',
          done: (_w, c) => onDevice(c, CORE),
        },
        {
          text: '관리자 모드 → 설정 모드',
          cmd: 'configure terminal',
          why: 'TOR-01에서처럼 enable 먼저, 그다음 configure terminal',
          done: (w, c) => ev(c, `ios:${CORE}:configure terminal`) || NEW_VLANS.some((v) => !!sviOf(w, v)),
        },
        {
          text: 'VLAN 10의 게이트웨이 인터페이스 만들기',
          cmd: 'interface vlan 10',
          why: '케이블을 꽂는 포트가 아니라 VLAN 10을 대표하는 가상 인터페이스(SVI)예요',
          done: (w) => !!sviOf(w, 10),
        },
        {
          text: 'CORE-01 자기 주소(.2) 정하기',
          cmd: 'ip address 10.10.10.2 255.255.255.0',
          why: '255.255.255.0은 /24와 같은 뜻이에요: 앞 세 칸(10.10.10)이 같은 주소끼리 한 네트워크',
          done: (w) => sviOf(w, 10)?.ip === ADDR.core(10, 1) && sviOf(w, 10)?.mask === 24,
        },
        {
          text: '서버들이 쓸 게이트웨이 .1 만들기',
          cmd: 'standby 1 ip 10.10.10.1',
          why: 'standby 1 = HSRP 1번 묶음. .1은 장비 한 대에 박힌 주소가 아니라 코어들이 함께 맡을 수 있는 가상 주소예요',
          done: (w) => sviOf(w, 10)?.hsrp?.vip === ADDR.gw(10),
        },
        {
          text: 'VLAN 20도 똑같이 (.2 / .1)',
          why: 'interface vlan 20 → ip address 10.10.20.2 255.255.255.0 → standby 1 ip 10.10.20.1',
          done: (w) => gatewaysSet(w).includes(20),
        },
      ],
    },
    {
      id: 'dns',
      text: 'DNS 서버(ns1)에 이름 등록하기: web = WEB-01, db = DB-01',
      why: 'DNS는 web 같은 이름을 10.10.10.11 같은 IP 주소로 바꿔 주는 전화번호부 서버예요(여기선 ns1). 내일 켤 수강신청 앱은 DB 서버를 숫자 대신 이름 db로 찾아가요. 그래서 web = WEB-01, db = DB-01의 주소를 등록해 둬요.',
      spot: 'desk',
      done: (w) => recordsSet(w).length === RECORDS.length,
      progress: (w) => `${recordsSet(w).length}/${RECORDS.length}`,
      after: ['gateway'],
      concept: 'dns',
      lesson: '이제 숫자 주소 대신 web, db 같은 이름으로 찾아갈 수 있어요. DNS는 이름을 숫자 주소로 바꿔주는 전화번호부!',
      steps: [
        {
          text: '관리 PC로 돌아와 DNS 서버에 접속',
          cmd: 'ssh ns1',
          why: 'ns1은 4번 랙의 DNS 서버예요. 코어 안이라면 end → exit 로 먼저 나와요. dns 명령은 ns1 안에서만 써요',
          done: (w, c) => onHostNow(c, ['ns1', ADDR.ns1]) || recordsSet(w).length === RECORDS.length,
        },
        { text: 'web 이름 등록 (WEB-01의 주소)', cmd: 'dns add web 10.10.10.11', done: (w) => recordsSet(w).some(([n]) => n === 'web') },
        { text: 'db 이름 등록 (DB-01의 주소)', cmd: 'dns add db 10.10.20.11', done: (w) => recordsSet(w).some(([n]) => n === 'db') },
      ],
    },
    {
      id: 'dhcp',
      text: 'DHCP 서버(dhcp01)에서 캠퍼스 주소 풀 확인하기 (dhcp pool list)',
      why: 'DHCP 서버(dhcp01)는 새로 접속한 노트북·폰에 IP 주소를 자동으로 빌려주는 서버예요. 도서관 와이파이 같은 캠퍼스 건물 기기들은 모두 여기서 10.20.x.x 같은 사설 주소(건물 안에서만 쓰는 주소)를 받아요. 건물마다 빌려줄 주소 묶음(풀)이 있는데, dhcp01에 접속해서 그 표를 봐 둬요.',
      spot: 'desk',
      done: (_w, c) => poolsSeen(c),
      after: ['dns'],
      concept: 'privateip',
      lesson: '캠퍼스 건물 기기들은 dhcp01이 나눠주는 주소(10.20.x.100~199)를 받아요. 10.으로 시작하는 주소는 건물 안에서만 쓰는 사설 주소고, /24는 앞 세 칸이 같은 동네라는 뜻이에요.',
      steps: [
        { text: '관리 PC로 돌아와 DHCP 서버에 접속', cmd: 'ssh dhcp01', why: 'ns1에서 exit 하면 관리 PC로 돌아와요', done: (_w, c) => ev(c, 'ssh:dhcp01') },
        { text: '건물별 주소 풀 보기', cmd: 'dhcp pool list', done: (_w, c) => poolsSeen(c) },
      ],
    },
    {
      id: 'wr',
      text: '설정 저장하기: 오늘 바꾼 TOR-01·CORE-01 (write memory)',
      why: '지금까지 바꾼 설정은 장비가 지금 쓰는 설정(running-config)에만 있어서, 장비가 다시 켜지면 사라져요. write memory로 다시 켤 때 읽는 설정(startup-config)에 저장해야 남아요. 오늘 손댄 TOR-01과 CORE-01 둘 다 저장해요.',
      spot: 'desk',
      done: (w) => savedGear(w).length === 2,
      progress: (w) => `${savedGear(w).length}/2`,
      after: ['dhcp'],
      // A fix on TOR-01 makes it unsaved again, so saving comes after the morning's VLAN incident.
      afterIncidents: ['d4-vlan:0'],
      concept: 'ios',
      lesson: '바꾼 설정은 지금 돌아가는 설정(running-config)에만 있어요. write memory로 재부팅 때 읽는 설정(startup-config)에 저장해야 밤사이 재부팅돼도 남아요.',
      steps: [
        {
          text: 'TOR-01 저장',
          cmd: 'write memory',
          why: '관리자 모드(TOR-01#)에서 쳐요. 설정 모드라면 end 먼저 (줄여서 wr)',
          done: (w) => savedGear(w).includes(TOR),
        },
        { text: 'CORE-01 저장', cmd: 'write memory', why: 'exit → ssh CORE-01 → enable → write memory', done: (w) => savedGear(w).includes(CORE) },
      ],
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'consolePick', hosts: ['web', 'web2', 'db'] },
    rack2: { kind: 'inspect', text: '2번 랙: 선배들이 먼저 설치해 둔 서버들(APP-01·DB-02·K8S 서버·NS2 예비 DNS 서버). 오늘 작업은 1번 랙 서버들의 네트워크예요.' },
    rack3: { kind: 'inspect', text: '3번 랙: TOR-02와 K8S 서버들. 이미 설정돼 있어요.' },
    rack4: { kind: 'inspect', text: '4번 랙: DHCP 서버(dhcp01)와 DNS 서버(ns1). 관리 PC에서 ssh로 들어갈 수 있어요.' },
    switch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'consolePick', hosts: ['TOR-01', 'CORE-01'] },
    patch: { kind: 'inspect', text: '패치 패널: 케이블이 모이는 곳. 어제 꽂은 서버 케이블은 옆 TOR 배선판을 거쳐 1번 랙 위 TOR-01으로 가요.' },
    pdu: { kind: 'gauge', target: 'pdu' },
    board: {
      kind: 'inspect',
      text: '주소 계획 (IP 주소 = 장비마다 붙는 번호) · 규칙: 10.10.<VLAN 번호>.<장비 번호> /24 (/24 = 마스크 255.255.255.0: 앞 세 칸이 같으면 같은 네트워크) | VLAN 10 = WEB(웹 서버) · VLAN 20 = DB | .1 = 게이트웨이 (가상 주소, standby) · .2 = CORE-01 자기 주소 · .3 = CORE-02 자리 (짝은 D-1에) | 서버: WEB-01 10.10.10.11 (이름 web), WEB-02 10.10.10.12, DB-01 10.10.20.11 (이름 db) | TOR-01 포트: Gi1/0/1 WEB-01, Gi1/0/2 WEB-02, Gi1/0/3 DB-01 | 관리망: 장비마다 10.10.250.x · 관리 PC(ops) 10.10.100.11',
    },
  },
  health: (w) => {
    // Inside the DC: the admin PC reaches each new server, and web finds db by name. Campus: DHCP + internet.
    const servers = PORT_PLAN.map(([id]) => id);
    const reachable = servers.filter((id) => {
      const r = reach(w, 'ops', ipOf(id));
      return r.ok && r.targetId === id;
    });
    const app = hostDelivery(w, 'web', 'db');
    const campus = campusDelivery(w);
    const services: Record<string, 'up' | 'degraded' | 'down'> = {};
    for (const id of servers) services[w.devices[id]?.label ?? id] = reachable.includes(id) ? 'up' : 'down';
    services['web → db'] = app.ok >= 0.99 ? 'up' : app.ok > 0 ? 'degraded' : 'down';
    services['캠퍼스 인터넷'] = campus.ok >= 0.99 ? 'up' : campus.ok > 0 ? 'degraded' : 'down';
    const notes = [...app.notes, ...campus.notes];
    const lost = servers.filter((id) => !reachable.includes(id));
    if (lost.length) notes.push(`관리 PC에서 응답 없는 서버: ${lost.map((id) => w.devices[id]?.label ?? id).join(', ')}`);
    const ok = (reachable.length / servers.length) * app.ok * campus.ok;
    return emptyHealth(w, { availability: ok, errorRate: 1 - ok, latencyMs: ok < 1 ? 600 : 20, services, notes });
  },
  panels: ['links', 'services'],
  /**
   * What D-4 builds, taken back out: VLANs 10/20 on TOR-01 and its three server ports, the VLAN 10/20
   * gateways on the cores, the web/db DNS records. Everything else stays as 선배 left it.
   */
  unbuild: (w) => {
    const tor = nd(w, TOR);
    if (tor) {
      for (const v of NEW_VLANS) delete tor.vlans[v];
      for (const [, p] of PORT_PLAN) if (tor.ifs[p]) tor.ifs[p].accessVlan = 1;
    }
    // The single gateway lives on CORE-01; CORE-02 gets its standby on D-1.
    for (const id of ['CORE-01', 'CORE-02']) {
      const n = nd(w, id);
      if (n) for (const v of NEW_VLANS) delete n.svis[v];
    }
    const dns = w.net?.dns;
    if (dns) for (const [name] of RECORDS) for (const k of Object.keys(dns)) if (k.toLowerCase() === name) delete dns[k];
    for (const id of [TOR, 'CORE-01', 'CORE-02']) resave(w.devices[id]);
  },
  /** No students yet; the campus buildings use the network as always. */
  setup: (w) => {
    w.traffic.rps = 0;
  },
};
