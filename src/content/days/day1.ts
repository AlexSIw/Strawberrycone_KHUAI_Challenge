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
    { who: 'mentor', text: '서버마다 동네(VLAN)를 정해주고, 동네와 동네를 잇는 문(게이트웨이)을 코어 스위치에 달고, 이름표(DNS)도 붙이자. 주소 계획은 설계 보드에 있어.' },
    { who: 'mentor', text: '스위치는 관리 PC에서 ssh로 들어가. 리눅스랑 말투가 달라: > 는 구경만, enable 하면 #, configure terminal 하면 설정 모드야. ? 를 치면 다음에 올 말을 알려줘.' },
    { who: 'boss', text: '학생 접속은 아직 없어. 대신 도서관 와이파이 같은 캠퍼스 건물들은 오늘도 우리 네트워크로 인터넷을 쓰니까 조심해서!' },
    { who: 'lion', text: '동네 나누고, 문 달고, 이름표 붙이기! 해볼게요.', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: 'VLAN은 동네, 코어의 VLAN 인터페이스는 동네 문, DNS는 전화번호부, write memory는 저장 버튼. 오늘 다 해봤네.' },
    { who: 'mentor', text: '그런데 show standby brief 봤어? Standby가 unknown인 줄이 있지: 오늘 만든 VLAN 10·20, 그리고 K8S용 VLAN 40. 그 동네들은 문지기가 한 명뿐이라는 뜻이야. 짝은 D-1까지 세우자.' },
    { who: 'boss', text: '내일(D-3)은 드디어 수강신청 웹 서비스를 연다!' },
  ],
  objectives: [
    {
      id: 'ssh',
      text: '관리 PC에서 TOR-01에 원격 접속하기 (ssh TOR-01)',
      spot: 'desk',
      done: (_w, c) => c.events.includes('ssh:TOR-01'),
      concept: 'oob',
      lesson: '장비 관리용 길(관리망, 10.10.250.x)은 서비스가 다니는 길과 따로 있어요. 그래서 서비스 네트워크가 망가져도 관리 PC에서 장비에 들어갈 수 있어요.',
    },
    {
      id: 'vlan',
      text: 'TOR-01에 VLAN 10(WEB)·20(DB) 만들기',
      spot: 'desk',
      done: (w) => vlansMade(w).length === NEW_VLANS.length,
      progress: (w) => `${vlansMade(w).length}/${NEW_VLANS.length}`,
      after: ['ssh'],
      concept: 'vlan',
      lesson: '스위치 한 대 안에 동네(VLAN)를 둘 만들었어요. 같은 동네끼리만 바로 대화하고, 다른 동네로 가려면 문(게이트웨이)을 거쳐야 해요.',
    },
    {
      id: 'ports',
      text: 'TOR-01 서버 포트 배정: Gi1/0/1·2(WEB-01·02) → VLAN 10, Gi1/0/3(DB-01) → VLAN 20',
      spot: 'desk',
      done: (w) => portsSet(w).length === PORT_PLAN.length,
      progress: (w) => `${portsSet(w).length}/${PORT_PLAN.length}`,
      after: ['vlan'],
      concept: 'l2l3',
      lesson: '포트마다 동네를 정하는 건 L2(같은 동네 배달) 일이에요. 이제 웹 서버와 DB 서버는 서로 다른 동네라, 둘을 이어 줄 L3(동네 사이 길 찾기)가 필요해요.',
    },
    {
      id: 'gateway',
      text: 'CORE-01에 VLAN 10·20 게이트웨이 만들기 (자기 주소 .2, 가상 게이트웨이 standby .1)',
      spot: 'desk',
      done: (w) => gatewaysSet(w).length === NEW_VLANS.length,
      progress: (w) => `${gatewaysSet(w).length}/${NEW_VLANS.length}`,
      after: ['ports'],
      concept: 'hsrp',
      lesson: '서버들의 게이트웨이(.1)는 코어 한 대에 박힌 주소가 아니라 가상 주소예요(HSRP). 지금은 VLAN 10·20을 CORE-01 혼자 맡고 있어서, show standby brief의 그 두 줄에 짝(Standby)이 unknown으로 나와요.',
    },
    {
      id: 'dns',
      text: 'DNS 서버(ns1)에 web·db 이름 등록하기',
      spot: 'desk',
      done: (w) => recordsSet(w).length === RECORDS.length,
      progress: (w) => `${recordsSet(w).length}/${RECORDS.length}`,
      after: ['gateway'],
      concept: 'dns',
      lesson: '이제 숫자 주소 대신 web, db 같은 이름으로 찾아갈 수 있어요. DNS는 이름을 숫자 주소로 바꿔주는 전화번호부!',
    },
    {
      id: 'dhcp',
      text: 'DHCP 서버(dhcp01)에서 캠퍼스 주소 풀 확인하기 (dhcp pool list)',
      spot: 'desk',
      done: (_w, c) => poolsSeen(c),
      after: ['dns'],
      concept: 'privateip',
      lesson: '캠퍼스 건물 기기들은 dhcp01이 나눠주는 주소(10.20.x.100~199)를 받아요. 10.으로 시작하는 주소는 건물 안에서만 쓰는 사설 주소고, /24는 앞 세 칸이 같은 동네라는 뜻이에요.',
    },
    {
      id: 'wr',
      text: '설정 저장하기: 오늘 바꾼 TOR-01·CORE-01 (write memory)',
      spot: 'desk',
      done: (w) => savedGear(w).length === 2,
      progress: (w) => `${savedGear(w).length}/2`,
      after: ['dhcp'],
      // A fix on TOR-01 makes it unsaved again, so saving comes after the morning's VLAN incident.
      afterIncidents: ['d4-vlan:0'],
      concept: 'ios',
      lesson: '바꾼 설정은 지금 돌아가는 설정(running-config)에만 있어요. write memory로 재부팅 때 읽는 설정(startup-config)에 저장해야 밤사이 재부팅돼도 남아요.',
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'consolePick', hosts: ['web', 'web2', 'db'] },
    rack2: { kind: 'inspect', text: '2번 랙: 선배들이 먼저 설치해 둔 서버들. 오늘 작업은 1번 랙 서버들의 네트워크예요.' },
    rack3: { kind: 'inspect', text: '3번 랙: TOR-02와 K8S 서버들. 이미 설정돼 있어요.' },
    rack4: { kind: 'inspect', text: '4번 랙: DHCP 서버(dhcp01)와 DNS 서버(ns1). 관리 PC에서 ssh로 들어갈 수 있어요.' },
    switch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'consolePick', hosts: ['TOR-01', 'CORE-01'] },
    patch: { kind: 'inspect', text: '패치 패널: 케이블이 모이는 곳. 어제 꽂은 서버 케이블은 옆 TOR 배선판을 거쳐 1번 랙 위 TOR-01으로 가요.' },
    pdu: { kind: 'gauge', target: 'pdu' },
    board: {
      kind: 'inspect',
      text: '주소 계획 (10.10.VLAN.x /24): VLAN 10 WEB · VLAN 20 DB · 게이트웨이 = .1 (가상, standby) · CORE-01 자기 주소 = .2 | 서버: WEB-01 10.10.10.11, WEB-02 10.10.10.12, DB-01 10.10.20.11 | TOR-01 포트: Gi1/0/1 WEB-01, Gi1/0/2 WEB-02, Gi1/0/3 DB-01 | 관리망: 장비마다 10.10.250.x',
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
