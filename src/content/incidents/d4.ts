// Incident templates first taught on D-4. See IncidentTemplate in src/sim/scenario.ts.
// Every check looks at what the network actually does (reach, dhcpView, operState), never at a
// flag the solution sets.
import { dhcpView, longIf, log, operState, reach, resolve } from '../../sim/network';
import type { IncidentTemplate } from '../../sim/scenario';
import type { World } from '../../sim/types';
import { own } from '../../sim/util';
import { SERVERS } from '../topology';

/** A server's planned address ('db' → 10.10.20.11). */
export const ipOf = (id: string): string => `10.10.${SERVERS[id][2]}.${SERVERS[id][3]}`;

/** `from` gets an answer from the machine `id` itself at its planned address. */
export function reachesHost(w: World, from: string, id: string): boolean {
  const r = reach(w, from, ipOf(id));
  return r.ok && r.targetId === id;
}

/** `from` asks for `name` through DNS and the machine `id` itself answers (not just any box with that address). */
export function reachesByName(w: World, from: string, name: string, id: string): boolean {
  const ip = resolve(w, name, from).ip;
  if (!ip) return false;
  const r = reach(w, from, ip);
  return r.ok && r.targetId === id;
}

/** Every way to write an interface in a hint ('Gi1/0/3', 'GigabitEthernet1/0/3', '1/0/3'). */
export const ifPhrases = (short: string): string[] => [short, longIf(short), short.replace(/^[A-Za-z]+/, '')];

/** Someone changed the config by hand and didn't save: the switch's own log says so. */
function touchedBy(w: World, dev: string, who: string): void {
  const nd = own(w.devices, dev)?.nd;
  if (!nd) return;
  nd.dirty = true;
  log(w, dev, 'SYS-5-CONFIG_I', `Configured from console by admin on vty0 (${who})`);
}

export const templates: IncidentTemplate[] = [
  {
    // A server port moved into the wrong VLAN: cable and LED are fine, the server is cut off.
    // One variant on purpose: D-4's save mission waits for 'd4-vlan:0' to be fixed.
    id: 'd4-vlan',
    day: 1,
    variants: [{ host: 'db', label: 'DB-01', port: 'Gi1/0/3', vlan: 20, wrong: 10 }],
    make: (v) => {
      const host = String(v.host);
      const port = String(v.port);
      const vlan = Number(v.vlan);
      return {
        title: '서버 하나가 다른 서버들과 연락 두절',
        alert: '서버 한 대가 갑자기 다른 서버들이랑 연락이 안 된대요. 전원도 케이블도 멀쩡하다는데요?',
        severity: 'critical',
        alarm: { source: 'poll', device: host, text: `${v.label} 응답 없음 (ping 감시)` },
        room: 'noc',
        inject: (w) => {
          const f = w.devices['TOR-01']?.nd?.ifs[port];
          if (f) f.accessVlan = Number(v.wrong);
          touchedBy(w, 'TOR-01', '10.10.100.23');
        },
        check: (w) => reachesHost(w, 'ops', host),
        hints: [
          '연락이 안 되는 서버는 어느 거야? 포트 불빛(링크)은 초록인데 ping만 안 된다면 케이블보다 위층 문제야. 그 서버가 꽂힌 스위치는 그 포트를 어떻게 보고 있을까?',
          '그 스위치의 서버 포트들이 각각 어느 동네(VLAN)에 들어 있는지 표로 보고, 오늘 만든 배정표와 비교해봐. 장비 일기장(로그)에 누가 설정을 건드린 흔적도 남아 있을 거야.',
          'VLAN과 포트 배정을 한눈에 보여주는 show 명령이 있어. 고칠 때는 그 포트의 설정 모드로 들어가서 VLAN을 정해주는 명령을 떠올려봐. 고친 다음엔 저장도!',
        ],
        bannedPhrases: [...ifPhrases(port), `vlan ${vlan}`, `VLAN ${vlan}`, `vlan${vlan}`, `VLAN${vlan}`, 'access vlan', ipOf(host)],
        solution: `${v.label} 서버가 꽂힌 TOR-01 ${port} 포트가 누군가에 의해 VLAN ${v.wrong}으로 바뀌었다 (show vlan brief, show logging으로 확인). TOR-01: enable → configure terminal → interface ${port} → switchport access vlan ${vlan} → end → write memory`,
        solutionSteps: [
          { ios: ['enable', 'configure terminal', `interface ${port}`, `switchport access vlan ${vlan}`, 'end', 'write memory'], host: 'TOR-01' },
        ],
        concept: 'syslog',
        lesson: '포트의 VLAN이 바뀌면 케이블·불빛은 멀쩡해도 그 서버는 다른 동네로 이사 간 셈이라 대화가 끊겨요. 누가 언제 설정을 바꿨는지는 장비 일기장(show logging)에 남아요.',
      };
    },
  },
  {
    // The library Wi-Fi scope runs dry: new devices get no address (169.254.x.x), the ones already on stay.
    // Stale leases → reclaim them; too many devices → widen the range. Widening fixes both.
    id: 'd4-dhcp',
    day: 1,
    variants: [
      { kind: 'stale', stale: 45, count: 85 },
      { kind: 'crowd', stale: 0, count: 125 },
    ],
    make: (v) => ({
      title: '도서관 와이파이 새 접속자만 인터넷 불가',
      alert: '중앙도서관 와이파이에 새로 접속한 사람들이 인터넷이 안 된대요. 먼저 와 있던 사람들은 괜찮고요.',
      severity: 'critical',
      alarm: { source: 'poll', device: 'dhcp01', text: 'dhcp01 주소 풀 사용률 100% (중앙도서관 무선)' },
      room: 'noc',
      inject: (w) => {
        const pool = w.net?.dhcp.pools['lib-wifi'];
        const group = w.net?.clients['lib-wifi'];
        if (pool) pool.stale = Number(v.stale);
        if (group) group.count = Number(v.count);
      },
      check: (w) => {
        const d = dhcpView(w, 'lib-wifi');
        return d.size > 0 && d.starving === 0;
      },
      hints: [
        '먼저 온 사람은 되고 새로 온 사람만 안 된대. 둘은 뭐가 다를까? 새 기기는 접속하자마자 주소를 어디서 받지?',
        '주소를 나눠주는 서버에서 그 건물 몫(풀)이 지금 어떤지 봐. 빈 칸이 남아 있어? 칸을 차지한 게 지금 있는 기기들이야, 이미 떠난 기기가 남긴 흔적이야?',
        'dhcp 명령 중에 풀의 범위를 넓히는 것과, 떠난 기기가 남긴 임대를 정리하는 것이 있어. 어느 쪽이 맞는지는 위에서 본 숫자가 알려줘.',
      ],
      bannedPhrases: ['dhcp leases clear', 'leases clear', 'dhcp pool set', 'pool set lib-wifi', '10.20.31.230', 'range 10.20.31'],
      solution:
        v.kind === 'stale'
          ? '도서관 무선 풀이 떠난 기기들의 묵은 임대(stale)로 꽉 찼다. ssh dhcp01 → dhcp pool list 로 확인 → dhcp leases clear lib-wifi (또는 범위를 넓혀도 된다: dhcp pool set lib-wifi range 10.20.31.100 10.20.31.230)'
          : '도서관 무선 기기 수가 풀 크기(100개)를 넘었다. ssh dhcp01 → dhcp pool list 로 확인 → dhcp pool set lib-wifi range 10.20.31.100 10.20.31.230',
      solutionSteps: [
        v.kind === 'stale'
          ? { cmd: 'dhcp leases clear lib-wifi', host: 'dhcp01' }
          : { cmd: 'dhcp pool set lib-wifi range 10.20.31.100 10.20.31.230', host: 'dhcp01' },
      ],
      concept: 'dhcp',
      lesson: '주소 풀(나눠줄 주소 묶음)이 바닥나면 새 기기는 주소를 못 받고 169.254로 시작하는 임시 주소를 스스로 붙여요. 그 주소로는 밖에 못 나가요. 풀이 왜 찼는지(진짜 사람 vs 묵은 흔적) 보고 고르는 게 핵심!',
    }),
  },
  {
    // v1 s2-dns: the name book lost db's line, or has a wrong number for it.
    id: 'd4-dns',
    day: 1,
    variants: [{ kind: 'del' }, { kind: 'typo' }],
    make: (v) => ({
      title: 'web 서버가 이름으로 db를 못 찾음',
      alert: 'web 서버에서 db 서버로 연결이 안 된대요! 그런데 IP 주소를 직접 넣으면 된다는데요?',
      severity: 'critical',
      alarm: { source: 'poll', device: 'web', text: 'WEB-01 → DB 연결 점검 실패' },
      room: 'noc',
      inject: (w) => {
        const dns = w.net?.dns;
        if (!dns) return;
        for (const k of Object.keys(dns)) if (k.toLowerCase() === 'db') delete dns[k];
        if (v.kind === 'typo') dns.db = '10.10.20.111';
      },
      check: (w) => reachesByName(w, 'web', 'db', 'db'),
      hints: [
        '이름(db)으로 할 때랑 숫자 주소로 할 때, 결과가 어떻게 달라? 둘 다 직접 해보고 비교해봐.',
        '숫자로는 되는데 이름으로는 안 된다면 길은 멀쩡해. 이름을 숫자로 바꿔주는 단계를 의심해봐. 그 이름이 지금 어떤 숫자로 바뀌는지(아예 안 바뀌는지) 확인해봐.',
        '이름 → 주소 장부를 맡은 서버에 접속하면 장부를 보는 명령과 고치는 명령이 있어. db의 진짜 주소는 db 서버 자신이 알고 있어.',
      ],
      bannedPhrases: ['10.10.20.11', 'dns add db', 'dns del db', 'add db'],
      solution:
        'DNS 장부(ns1)의 db 줄이 지워졌거나 틀린 주소로 바뀌었다. ssh ns1 → dns list 로 확인 → (틀린 줄이 있으면 dns del db) → dns add db 10.10.20.11',
      solutionSteps:
        v.kind === 'typo'
          ? [
              { cmd: 'dns del db', host: 'ns1' },
              { cmd: 'dns add db 10.10.20.11', host: 'ns1' },
            ]
          : [{ cmd: 'dns add db 10.10.20.11', host: 'ns1' }],
      concept: 'dns',
      lesson: '컴퓨터는 이름이 아니라 숫자 주소(IP)로 찾아가요. 이름을 숫자로 바꿔주는 DNS 장부에 줄이 없거나 틀리면, 길이 멀쩡해도 못 찾아가요.',
    }),
  },
  {
    // Someone plugged a small switch into a server port; bpduguard shut the port (err-disabled).
    // The small switch is already gone, so shut / no shut brings the port back.
    // Both variants are a standby box (the second web server, the secondary DNS): no spare → major.
    id: 'd4-errdisable',
    day: 1,
    variants: [
      { host: 'web2', label: 'WEB-02', port: 'Gi1/0/2' },
      { host: 'ns2', label: 'NS2', port: 'Gi1/0/8' },
    ],
    make: (v) => {
      const port = String(v.port);
      return {
        title: '예비 서버가 네트워크에서 사라짐',
        alert: '예비로 두던 서버 한 대가 갑자기 네트워크에서 사라졌대요. 전원은 켜져 있다는데요?',
        severity: 'major',
        alarm: { source: 'syslog', device: 'TOR-01', text: 'TOR-01 포트 하나가 err-disabled (스위치가 스스로 차단)' },
        room: 'noc',
        inject: (w) => {
          const f = w.devices['TOR-01']?.nd?.ifs[port];
          if (f) f.errDisabled = 'bpduguard';
          log(w, 'TOR-01', 'SPANTREE-2-BLOCK_BPDUGUARD', `Received BPDU on port ${longIf(port)} with BPDU Guard enabled. Disabling port.`);
        },
        check: (w) => operState(w, 'TOR-01', port) === 'up',
        hints: [
          '그 서버가 꽂힌 스위치 포트 불빛은 어때? 스위치는 그 포트를 어떤 상태라고 표시하고 있어? 그냥 꺼짐(down)과는 다른 말이 보일 거야.',
          '포트가 스스로 꺼졌다면 스위치가 뭔가 위험한 걸 보고 막은 거야. 장비 일기장(로그)에서 그 시각에 무슨 일이 있었는지 읽어봐. 원인이 이미 사라졌다면 포트를 다시 살리면 돼.',
          '스위치가 스스로 막은 포트는 저절로 안 풀려. 포트 상태를 바꾸는 명령은 그 포트의 설정 모드에 있어. 원인이 사라졌는지 확인하고 써봐. 고친 뒤엔 저장!',
        ],
        // The fix in plain words too ("껐다가 다시 켜").
        bannedPhrases: [...ifPhrases(port), 'shutdown', 'no shut', String(v.label), '껐다', '다시 켜'],
        solution: `누군가 ${v.label} 자리의 포트(${port})에 작은 스위치를 꽂아서 스위치 신호(BPDU)가 들어왔고, bpduguard가 그 포트를 err-disabled로 막았다. 그 장비는 이미 빠졌으니 TOR-01: enable → configure terminal → interface ${port} → shutdown → no shutdown → end → write memory`,
        solutionSteps: [
          { ios: ['enable', 'configure terminal', `interface ${port}`, 'shutdown', 'no shutdown', 'end', 'write memory'], host: 'TOR-01' },
        ],
        concept: 'syslog',
        lesson: '서버 자리에 스위치 신호(BPDU)가 들어오면 bpduguard가 그 포트를 막아요(err-disabled). 네트워크에 고리(루프)가 생기는 걸 막는 안전장치예요. 원인을 치우고 포트를 껐다 켜면 풀려요. 무슨 일이 있었는지는 장비 일기장이 알려줘요.',
      };
    },
  },
  {
    // A core VLAN interface (the VLAN's gateway) shut down by hand. With CORE-01 as the only gateway for
    // VLANs 10/20 that cuts the VLAN off; once CORE-02 is its standby (D-1's build) the standby takes over
    // and nothing breaks. Checked by the symptom (web reaches db), so a world where the standby already
    // exists fails the template matrix instead of passing quietly. Until D-3: D-3's world takes the CORE-02
    // standby out (day2.ts); D-2 can join once its own world does too.
    id: 'd4-svi',
    day: 1,
    until: 2,
    variants: [{ vlan: 10 }, { vlan: 20 }],
    make: (v) => {
      const vlan = Number(v.vlan);
      return {
        title: '웹 서버 ↔ DB 서버 연결 끊김',
        alert: '웹 서버에서 DB 서버로 가는 연결이 끊겼대요. 서버들은 다 켜져 있고 불빛도 정상이래요.',
        severity: 'critical',
        alarm: { source: 'syslog', device: 'CORE-01', text: 'CORE-01 인터페이스 하나가 down' },
        room: 'noc',
        inject: (w) => {
          const svi = w.devices['CORE-01']?.nd?.svis[vlan];
          if (svi) svi.shutdown = true;
          touchedBy(w, 'CORE-01', '10.10.100.23');
        },
        check: (w) => reachesHost(w, 'web', 'db'),
        hints: [
          '같은 동네(VLAN) 안에서는 되고, 동네를 건너갈 때만 안 된다면 어디가 의심스러워? 서버에서 자기 게이트웨이로 ping 해봐.',
          '동네와 동네를 잇는 문은 코어 스위치에 있는 VLAN 인터페이스야. 코어에서 인터페이스들의 상태를 한 줄씩 보여주는 show 명령으로 확인해봐.',
          '인터페이스를 켜고 끄는 건 그 인터페이스의 설정 모드에서 하는 일이야. 어느 인터페이스인지는 위에서 본 표가 알려줘. 고친 뒤엔 저장!',
        ],
        // The fix in plain words too ("다시 켜").
        bannedPhrases: ['no shutdown', 'no shut', `vlan ${vlan}`, `VLAN ${vlan}`, `vlan${vlan}`, `Vlan${vlan}`, 'interface vlan', '다시 켜'],
        solution: `CORE-01의 VLAN ${vlan} 인터페이스(SVI: 그 VLAN의 게이트웨이)가 누군가에 의해 shutdown 됐다 (show ip interface brief → administratively down, show logging). CORE-01: enable → configure terminal → interface vlan ${vlan} → no shutdown → end → write memory`,
        solutionSteps: [{ ios: ['enable', 'configure terminal', `interface vlan ${vlan}`, 'no shutdown', 'end', 'write memory'], host: 'CORE-01' }],
        concept: 'gateway',
        lesson: '게이트웨이(.1)를 맡은 코어의 VLAN 인터페이스가 꺼지면 동네 안은 멀쩡해도 밖으로는 못 나가요. 지금은 VLAN 10·20의 게이트웨이를 코어 한 대만 맡고 있어서 여기가 단일 장애점이에요.',
      };
    },
  },
];
