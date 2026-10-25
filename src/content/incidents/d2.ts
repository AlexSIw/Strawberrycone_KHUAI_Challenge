// Incident templates first taught on D-2. See IncidentTemplate in src/sim/scenario.ts.
// Every check looks at what the network / containers actually do (delivery, utilization, STP, port-channel
// state, what answers on a port), never at a flag the solution sets.
import { appDb, BAD_IMAGE_FLAG, dataOnVolume, dbRows, enrollPublished, isDb, isEnroll, nextContainerId } from '../../sim/commands/docker';
import { listening, log, logicalLinks, poState, resolve, runsStp, stpView, studentDelivery, utilization } from '../../sim/network';
import type { IncidentTemplate } from '../../sim/scenario';
import type { World } from '../../sim/types';
import { own } from '../../sim/util';
import { studentsServed } from './d3';
import { ifPhrases } from './d4';

/** APP-01: the server the enrollment app runs on today (as a container). */
export const APP_HOST = 'srv-new';
/** DB-02: the server the enrollment DB container runs on. */
export const DB_HOST = 'srv-db';
/** The afternoon's 모의 부하 테스트: requests per second (× 1.6 Mbps ≈ 12.8 Gbps through TOR-01). */
export const LOAD_TEST_RPS = 8000;
/** The bundle D-2 builds: TOR-01's two cables to CORE-01, both ends. */
export const UPLINK_PORTS: Record<string, string[]> = { 'TOR-01': ['Te1/1/1', 'Te1/1/2'], 'CORE-01': ['Te1/0/3', 'Te1/0/4'] };
/** A link this busy makes pages slow (same threshold as net/health.ts). */
const BUSY = 0.9;

/** Someone changed the config by hand and didn't save: the switch's own log says so. */
export function touchedBy(w: World, dev: string, who = '10.10.100.23'): void {
  const nd = own(w.devices, dev)?.nd;
  if (!nd) return;
  nd.dirty = true;
  log(w, dev, 'SYS-5-CONFIG_I', `Configured from console by admin on vty0 (${who})`);
}

/** Links between TOR-01 and a core that are up. */
const torUplinks = (w: World) =>
  logicalLinks(w).filter((l) => l.up && [l.a.dev, l.b.dev].includes('TOR-01') && [l.a.dev, l.b.dev].some((d) => d.startsWith('CORE-')));

/** Students get through at full speed and none of TOR-01's uplinks is congested. */
export const uplinkRelaxed = (w: World): boolean => studentDelivery(w).ok >= 0.99 && torUplinks(w).every((l) => utilization(w, l.key) <= BUSY);

/** TOR-01 ↔ CORE-01 run as one port-channel with (at least) both cables bundled (2 × 10G). */
export function poBundled(w: World): boolean {
  const po = logicalLinks(w).find((l) => l.kind === 'po' && l.key === 'CORE-01:Po1~TOR-01:Po1');
  return !!po && po.up && po.cables.length >= 2;
}

/** …and every member configured on either end is in it (flag P): nothing down or suspended. */
export const poWhole = (w: World): boolean =>
  poBundled(w) && ['TOR-01', 'CORE-01'].every((d) => poState(w, d, 1).members.every((m) => m.flag === 'P'));

/** The app container on APP-01 that students can reach: web port outside → the app's port inside. */
export const appContainer = (w: World) => w.docker?.containers.find((c) => c.host === APP_HOST && enrollPublished(c));

/** The image a teammate pushed this afternoon has a bug: every request ends in a 500. */
export const badImage = (w: World, image: string): boolean => own(w.flags, BAD_IMAGE_FLAG) === image;

/** An enroll container is running on APP-01 but none of them lets students in (no -p, or the wrong inner port). */
export const enrollUnreachable = (w: World): boolean =>
  !!w.docker?.containers.some((c) => c.host === APP_HOST && c.running && isEnroll(c) && !enrollPublished(c)) && !appContainer(w);

/** The DB the app uses keeps its data on a volume, and has the enrollment rows. */
export const dbOnVolume = (w: World): boolean => {
  const db = appDb(w);
  return !!db && dataOnVolume(db) && dbRows(w, db) > 0;
};

export const templates: IncidentTemplate[] = [
  {
    // The afternoon load test sends 8,000 rps to the app on APP-01 (behind TOR-01). TOR-01 has two cables
    // to CORE-01, but they aren't bundled, so spanning tree blocks one and a single 10G link carries
    // 12.8 Gbps. Fix: bundle both ends (LACP). D-2 only: from D-1 on the bundle already exists.
    id: 'd2-uplink',
    day: 3,
    until: 3,
    variants: [{ rps: LOAD_TEST_RPS }],
    make: (v) => ({
      title: '부하 테스트 중 수강신청 응답 느림',
      alert: '모의 부하 테스트를 시작했더니 수강신청 페이지가 엄청 느려졌어요! 그런데 APP-01 서버는 한가하대요.',
      severity: 'major',
      alarm: { source: 'poll', device: 'TOR-01', text: 'TOR-01 업링크 사용률 100% 초과' },
      room: 'network',
      inject: (w) => {
        w.traffic.rps = Number(v.rps);
      },
      check: uplinkRelaxed,
      hints: [
        '느린 곳이 서버야, 길이야? 관제 화면(NMS) 지도에서 선 색을 봐. 꽉 차서 빨개진 선은 어디와 어디 사이야?',
        '그 스위치에서 코어로 가는 케이블은 몇 개 꽂혀 있고, 지금 일하는 건 몇 개야? 고리(루프)를 막으려고 STP가 하나를 막아 두고 있을 거야. 막힌 걸 억지로 열지 말고, 두 줄을 한 줄처럼 쓰는 방법은 없을까?',
        '여러 케이블을 한 묶음으로 만드는 설정(LACP)이 있어. 묶음은 양쪽 장비에 똑같이 해 줘야 해. 다 하고 나면 묶음 상태를 한 줄씩 보여주는 show 명령으로 확인!',
      ],
      bannedPhrases: ['channel-group', 'mode active', 'interface range', ...['Te1/1/1', 'Te1/1/2', 'Te1/0/3', 'Te1/0/4'].flatMap(ifPhrases)],
      solution:
        'TOR-01 → CORE-01 케이블이 두 개(Te1/1/1·Te1/1/2 ↔ Te1/0/3·Te1/0/4) 있는데 묶여 있지 않아서, STP가 고리를 막으려고 TOR-01 Te1/1/2를 막고(BLK) 있었다. 그래서 10G 한 줄로 부하 테스트 트래픽(약 12.8Gbps)을 받다가 넘쳤다. 양쪽을 LACP로 묶는다. TOR-01: enable → configure terminal → interface range te1/1/1 - 2 → channel-group 1 mode active → end → write memory / CORE-01: enable → configure terminal → interface range te1/0/3 - 4 → channel-group 1 mode active → end → write memory. show etherchannel summary 에서 Po1(SU)와 멤버 (P) 확인.',
      solutionSteps: [
        { ios: ['enable', 'configure terminal', 'interface range te1/1/1 - 2', 'channel-group 1 mode active', 'end', 'write memory'], host: 'TOR-01' },
        { ios: ['enable', 'configure terminal', 'interface range te1/0/3 - 4', 'channel-group 1 mode active', 'end', 'write memory'], host: 'CORE-01' },
      ],
      concept: 'oversubscription',
      lesson: '서버 여러 대의 트래픽이 랙 스위치의 위쪽 길(업링크) 하나로 모여요. 케이블이 두 개여도 STP가 하나를 막아 두면 10G 한 줄뿐이죠. LACP로 묶으니 둘 다 일해서 20G가 됐어요.',
    }),
  },
  {
    // A night-shift worker cabled two spare access ports (TOR-01 ↔ TOR-02) into VLAN 50 and turned STP off
    // for VLAN 50 on both switches. A loop with no STP speaker on it: a broadcast storm. DNS and DHCP live
    // in VLAN 50, so names and new campus addresses fail; every link carrying VLAN 50 is flooded.
    // Fix: turn STP back on for VLAN 50 (one switch is enough; bpduguard then also shuts the stray port).
    id: 'd2-storm',
    day: 3,
    variants: [
      { a: 'Gi1/0/12', b: 'Gi1/0/11' },
      { a: 'Gi1/0/11', b: 'Gi1/0/10' },
    ],
    make: (v) => {
      const a = String(v.a);
      const b = String(v.b);
      const VLAN = 50;
      return {
        title: '이름 찾기·와이파이 접속 먹통, 스위치 불빛 폭주',
        alert: '갑자기 사이트 이름으로 접속이 안 되고, 캠퍼스 건물들 인터넷도 끊겼대요! 서버실 스위치 불빛이 전부 미친 듯이 깜빡여요.',
        severity: 'critical',
        alarm: { source: 'syslog', device: 'TOR-01', text: 'TOR-01 MAC 주소 이동 경고 반복 (MACFLAP)' },
        room: 'network',
        // One mutation: the cable and STP-off land together, before the next sync.
        inject: (w) => {
          const t1 = w.devices['TOR-01']?.nd;
          const t2 = w.devices['TOR-02']?.nd;
          if (!t1 || !t2) return;
          for (const [nd, p] of [
            [t1, a],
            [t2, b],
          ] as const) {
            const f = nd.ifs[p];
            if (f) Object.assign(f, { mode: 'access', accessVlan: VLAN, shutdown: false, errDisabled: null });
            if (!nd.stpOff.includes(VLAN)) nd.stpOff = [...nd.stpOff, VLAN].sort((x, y) => x - y);
          }
          for (const [id, c] of Object.entries(w.cables)) if ([c.a, c.b].some((e) => e === `TOR-01:${a}` || e === `TOR-02:${b}`)) delete w.cables[id];
          w.cables.stray = { id: 'stray', a: `TOR-01:${a}`, b: `TOR-02:${b}`, broken: false };
          touchedBy(w, 'TOR-01', '10.10.100.42');
          touchedBy(w, 'TOR-02', '10.10.100.42');
        },
        check: (w) =>
          !stpView(w, VLAN).storm && (runsStp(w, 'TOR-01', VLAN) || runsStp(w, 'TOR-02', VLAN)) && resolve(w, 'sugang', 'ops').ip !== null,
        hints: [
          '서버 한두 대가 아니라 여러 곳이 한꺼번에 이상해. 관제 화면(NMS)의 선 색과 스위치 일기장(show logging)을 봐. 같은 기기 주소(MAC)가 두 포트 사이를 왔다 갔다 한다는 줄이 보여?',
          '같은 신호가 두 길로 돌고 돌면 고리(루프)가 생겨서 방송이 끝없이 불어나(브로드캐스트 스톰). 원래 이런 고리는 STP가 하나를 막아 줘야 해. 그 스위치들에서 STP가 그 VLAN에 지금 켜져 있는지 확인해봐.',
          'STP 상태를 보는 show 명령에서 그 VLAN이 "없다"고 나오면 누가 꺼 둔 거야(일기장에 흔적이 있어). 설정 모드에서 VLAN별로 STP를 다시 켜는 명령을 떠올려봐. 한쪽만 켜도 고리는 끊겨.',
        ],
        bannedPhrases: ['spanning-tree vlan', 'no spanning-tree', `VLAN ${VLAN}`, `vlan ${VLAN}`, `vlan${VLAN}`, `Vlan${VLAN}`, ...ifPhrases(a), ...ifPhrases(b)],
        solution: `야간 작업자가 TOR-01 ${a}와 TOR-02 ${b}를 VLAN ${VLAN}(DNS·DHCP가 있는 INFRA VLAN)에 넣고 케이블로 이은 다음, 두 스위치 모두 VLAN ${VLAN}의 STP를 꺼 둔 채(no spanning-tree vlan ${VLAN}) 퇴근했다. 고리가 생겼는데 막아 줄 STP가 없어서 방송이 끝없이 돌았다(브로드캐스트 스톰). show logging(MACFLAP, 설정 변경), show spanning-tree vlan ${VLAN}("does not exist")로 확인. TOR-01: enable → configure terminal → spanning-tree vlan ${VLAN} → end → write memory (TOR-02도 같이 켜 둔다). STP가 켜지면 고리 포트가 막히고(bpduguard가 그 포트를 err-disabled로 막기도 한다) 스톰이 멈춘다.`,
        solutionSteps: [
          { ios: ['enable', 'configure terminal', `spanning-tree vlan ${VLAN}`, 'end', 'write memory'], host: 'TOR-01' },
          { ios: ['enable', 'configure terminal', `spanning-tree vlan ${VLAN}`, 'end', 'write memory'], host: 'TOR-02' },
        ],
        concept: 'stp',
        lesson: '같은 VLAN에 길이 두 개 생기면 고리(루프)가 돼서 방송이 끝없이 불어나요(브로드캐스트 스톰). STP가 하나를 막아 줘야 하는데 양쪽 다 꺼져 있었어요. 오늘 업링크 두 줄 중 하나가 막혀 있던 것도 바로 이 STP 덕분이에요.',
      };
    },
  },
  {
    // A mistake the player may make: the app container runs, but students can't get in (no -p, or the
    // wrong inner port). Fires on that condition only (optional); D-2 only (docker exists on D-2).
    id: 'd2-port',
    day: 3,
    until: 3,
    weight: 0,
    variants: [{ host: APP_HOST }],
    make: () => ({
      title: '컨테이너는 떴는데 접속 불가',
      alert: '새로 띄운 신청 앱 컨테이너는 실행 중(Up)이라는데… L4가 APP-01을 계속 DOWN으로 봐요.',
      severity: 'warning',
      alarm: { source: 'poll', device: APP_HOST, text: 'APP-01 80번 포트 응답 없음 (L4 헬스체크 실패)' },
      room: 'noc',
      inject: () => {},
      check: (w) => !!appContainer(w) && listening(w, APP_HOST, 80),
      hints: [
        '컨테이너 목록(docker ps)의 PORTS 칸을 봐. 포트는 서버로 들어오는 문 번호야. 앱 로그(docker logs)가 말하는 번호와 비교해봐.',
        '컨테이너는 잠긴 방이야. 학생들이 오는 길가 문(웹 기본 포트)과, 앱이 방 안에서 기다리는 창구 번호를 이어줘야 손님이 들어와.',
        '이미 뜬 컨테이너는 문을 바꿀 수 없어. 지우고, 바깥 문과 안쪽 창구를 잇는 실행 옵션을 붙여서 다시 실행해봐.',
      ],
      bannedPhrases: ['-p 80:8000', '80->8000', '80 -> 8000', '80→8000', '80 → 8000', '80번과 8000번', '80번을 8000번', '80번에서 8000번', '80번 문과 8000번'],
      solution: '포트 매핑(바깥 문과 안쪽 창구 잇기)이 없거나 안쪽 번호가 앱 창구(8000)와 달랐다. (srv-new에서) docker rm -f enroll → docker run -p 80:8000 enroll:1.0',
      solutionSteps: [
        { cmd: 'docker rm -f enroll', host: APP_HOST },
        { cmd: 'docker run -p 80:8000 enroll:1.0', host: APP_HOST },
      ],
      concept: 'portMapping',
      lesson: 'Dockerfile의 EXPOSE는 "안쪽 창구 번호" 메모일 뿐! -p 바깥:안쪽 으로 서버의 문과 컨테이너 안 창구를 이어야 손님이 들어와요.',
    }),
  },
  {
    // One cable of the TOR-01 ↔ CORE-01 bundle stops working in it: shut on the TOR, or taken out of the
    // channel on the core (only one side bundled → suspended). The link lives on at half the width.
    // Needs Po1 on both ends: D-2 after the bundle is built (a same-day extra waits for every mission), D-1, D-Day.
    id: 'd2-po',
    day: 3,
    variants: [
      { kind: 'shut', dev: 'TOR-01', port: 'Te1/1/2' },
      { kind: 'oneside', dev: 'CORE-01', port: 'Te1/0/4' },
    ],
    make: (v) => {
      const dev = String(v.dev);
      const port = String(v.port);
      const shut = v.kind === 'shut';
      return {
        title: 'TOR-01 업링크 묶음 일부 빠짐',
        alert: '관제 화면에 TOR-01 업링크 경보가 떴어요. 서비스는 일단 돌아가는 것 같은데… 지금 봐야 해요?',
        severity: 'major',
        alarm: { source: 'syslog', device: 'TOR-01', text: 'TOR-01 Port-channel 1 멤버 이탈 (EC-5-UNBUNDLE)' },
        room: 'network',
        inject: (w) => {
          const f = w.devices[dev]?.nd?.ifs[port];
          if (!f) return;
          if (shut) f.shutdown = true;
          else {
            delete f.group;
            delete f.chMode;
          }
          touchedBy(w, dev);
        },
        check: poWhole,
        hints: [
          '서비스가 멀쩡한데 경보가 떴다면 여유나 예비가 줄어든 거야. 그 스위치에서 묶음 상태를 한 줄씩 보여주는 show 명령으로, 멤버마다 어떤 글자가 붙어 있는지 봐.',
          '묶음 멤버 옆 글자가 P면 묶여서 일하는 중, D는 꺼짐, s는 상대가 같이 안 묶어 줘서 대기 중이야. 빠진 멤버의 양쪽 끝 장비를 다 확인해. 일기장(show logging)에 누가 설정을 바꿨는지도 남아 있어.',
          '꺼진 포트라면 그 포트 설정 모드에서 다시 켜고, 한쪽만 묶여 있다면 반대쪽도 같은 묶음 번호로 묶어 줘. 그다음 저장!',
        ],
        bannedPhrases: [...ifPhrases(port), 'channel-group', 'mode active', 'no shutdown', 'no shut'],
        solution: shut
          ? `누군가 TOR-01 ${port}(묶음 Po1의 멤버)를 shutdown 해서 묶음이 10G 한 줄로 줄었다 (show etherchannel summary → ${port}(D), show logging). TOR-01: enable → configure terminal → interface ${port} → no shutdown → end → write memory`
          : `누군가 CORE-01 ${port}를 묶음에서 빼서(no channel-group) 한쪽만 묶인 상태가 됐다. 반대편 TOR-01 Te1/1/2가 대기(s)로 빠져 묶음이 10G 한 줄로 줄었다 (show etherchannel summary, show logging). CORE-01: enable → configure terminal → interface ${port} → channel-group 1 mode active → end → write memory`,
        solutionSteps: shut
          ? [{ ios: ['enable', 'configure terminal', `interface ${port}`, 'no shutdown', 'end', 'write memory'], host: dev }]
          : [{ ios: ['enable', 'configure terminal', `interface ${port}`, 'channel-group 1 mode active', 'end', 'write memory'], host: dev }],
        concept: 'lacp',
        lesson: '묶음(LACP) 멤버 하나가 빠지면 길은 살아 있어도 폭이 절반이 돼요. 묶음은 양쪽이 똑같이 설정돼야 하고, 빠진 멤버는 show etherchannel summary 의 글자(P·D·s)로 바로 보여요.',
      };
    },
  },
  {
    // A teammate pushes a new app image with a bug and redeploys APP-01's container with it: every
    // request ends in a 500. Fix: run the previous tag again (rollback). Docker is D-2 only.
    id: 'd2-deploy',
    day: 3,
    until: 3,
    variants: [{ bad: 'enroll:1.1', alt: 'enroll:1.2' }],
    make: (v) => ({
      title: '새 버전 배포 후 신청 에러 급증',
      alert: '방금 전까지 멀쩡했는데, 신청 버튼을 누르면 500 에러(서버 안에서 처리하다 터졌다는 표시)가 뜬대요!',
      severity: 'critical',
      alarm: { source: 'poll', device: APP_HOST, text: 'APP-01 HTTP 500 응답 급증' },
      room: 'noc',
      inject: (w) => {
        const d = w.docker;
        const c = appContainer(w);
        if (!d || !c) return;
        // The teammate's tag, never the one already running.
        const bad = c.image === String(v.bad) ? String(v.alt) : String(v.bad);
        if (!d.registry.includes(bad)) d.registry.push(bad);
        const h = own(d.hosts, c.host);
        if (h && !h.pulled.includes(bad)) h.pulled.push(bad);
        w.flags[BAD_IMAGE_FLAG] = bad;
        // Redeployed: a new container with the same name, ports and mounts.
        c.id = nextContainerId(d);
        c.image = bad;
      },
      check: (w) => {
        const c = appContainer(w);
        return !!c && !badImage(w, c.image) && studentsServed(w);
      },
      hints: [
        '에러가 언제부터 났지? 그 무렵 APP-01에서 뭐가 바뀌었는지 컨테이너 목록을 봐. 아침에 띄운 것과 같은 컨테이너야? IMAGE 칸은?',
        '컨테이너 로그를 보면 새 버전이 요청을 처리하다 터지고 있어. 고칠 때까지 학생들을 기다리게 할 순 없어. 예전 버전 이미지는 아직 냉동고(레지스트리)에 있지?',
        '버전 이름표(태그)를 아침에 쓰던 것으로 바꿔서 컨테이너를 새로 띄워봐. 이미 뜬 컨테이너는 이미지를 바꿀 수 없어서 지우고 다시 실행해야 해.',
      ],
      bannedPhrases: ['enroll:1.0', 'docker rm -f enroll', 'docker run -p'],
      solution:
        '동료가 버그 있는 새 이미지(enroll:1.1)로 APP-01 컨테이너를 다시 만들었다 (docker ps 의 IMAGE, docker logs 의 500 에러로 확인). 아침에 만든 이전 태그로 되돌린다: (srv-new에서) docker rm -f enroll → docker run -p 80:8000 enroll:1.0 (컨테이너 이름은 docker ps, 태그는 docker images 로 확인)',
      solutionSteps: [
        { cmd: 'docker rm -f enroll', host: APP_HOST },
        { cmd: 'docker run -p 80:8000 enroll:1.0', host: APP_HOST },
      ],
      concept: 'rollback',
      lesson: '버전마다 이름표(태그)를 붙여 둔 덕분에 예전 태그로 바로 되돌렸어요(rollback). 늘 latest(최신) 한 이름만 썼다면 어디로 돌아갈지 몰랐을 거예요.',
    }),
  },
  {
    // v1 s5-volume, after D-2's volume mission: the DB update script recreates the DB container from an old
    // command line without the volume. The data is safe in the volume; the new container just doesn't use it.
    id: 'd2-volume',
    day: 3,
    until: 3,
    variants: [{ host: DB_HOST }],
    make: () => ({
      title: 'DB 업데이트 후 신청 내역 0건',
      alert: 'DB(신청 기록 창고) 자동 업데이트가 끝났는데… 수강신청 내역이 전부 0건으로 보여요! 학생들 난리 났어요!',
      severity: 'critical',
      alarm: { source: 'poll', device: DB_HOST, text: 'DB-02 신청 내역 0건 (데이터 점검 실패)' },
      room: 'noc',
      inject: (w) => {
        const d = w.docker;
        if (!d) return;
        // The script removed and recreated the DB container(s) on DB-02: same name and port, no volume.
        for (const c of d.containers) {
          if (!isDb(c) || c.host !== DB_HOST) continue;
          Object.assign(c, { id: nextContainerId(d), volume: null, volumePath: null, rows: 0 });
        }
      },
      check: dbOnVolume,
      hints: [
        'DB 서버(DB-02)에서 컨테이너 목록을 봐. 아침에 만든 것과 같은 컨테이너야? VOLUME 칸은 어때?',
        'DB 로그에서 데이터를 어디에 쓰고 있는지(data dir) 봐. 사물함(볼륨)은 지워지지 않았어. 새 컨테이너가 그 사물함을 안 쓰고 있을 뿐이야.',
        '사물함을 DB가 데이터를 쓰는 폴더에 다시 붙여서 DB 컨테이너를 새로 실행해봐. 신청 앱이 찾아오는 포트도 그대로 열어야 해.',
      ],
      bannedPhrases: ['-v dbdata', 'docker volume create', ':/var/lib/mysql', '/var/lib/mysql에 붙', '/var/lib/mysql 에 붙', '/var/lib/mysql에 볼륨', '볼륨을 /var/lib/mysql'],
      solution:
        'DB 업데이트 스크립트가 볼륨 옵션(-v) 없이 DB 컨테이너를 새로 만들어서, 새 컨테이너는 빈 자기 안쪽에 데이터를 쓰고 있다. 데이터는 아침에 만든 볼륨에 그대로 있다. (srv-db에서) docker rm -f db → docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8 (볼륨 이름은 docker volume ls 로 확인한 아침의 것)',
      solutionSteps: [
        { cmd: 'docker rm -f db', host: DB_HOST },
        { cmd: 'docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8', host: DB_HOST },
      ],
      concept: 'volume',
      lesson: '데이터는 볼륨(사물함)에 그대로 있었어요. 새 컨테이너가 사물함을 안 붙였을 뿐! 컨테이너는 언제든 새로 만드는 일회용, 데이터는 볼륨에.',
    }),
  },
];
