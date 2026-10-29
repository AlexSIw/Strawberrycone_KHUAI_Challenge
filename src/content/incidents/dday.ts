// Incident templates of the D-Day timeline. See IncidentTemplate in src/sim/scenario.ts.
// Cause and effect, not a list (docs/v2-plan.md departure 9):
//   10:00:30 the open spike outgrows the enroll pods → scale out;
//   that scale-out opens more DB connections than DB-01 allows (a `condition` trigger) → smaller pool;
//   10:06    신청 집중 fills TOR-02's single 10G uplink → bundle the spare (the D-2 LACP lesson);
//   10:15:30 macro bots fill the L4 session table → firewall deny on their source.
// The traffic itself comes from D-Day's onTick curve (days/day5.ts), so the first and third incidents
// break nothing on their own: they mark the moment the curve outgrows what the morning world can carry.
// Every check reads what the world does (pods, connections, link load, firewall verdicts). The capacity
// and uplink checks hold the world to the day's peaks, not to the traffic of the moment: when the curve
// drops at 10:20:30 an unfixed world doesn't fix itself.
import { readyPods } from '../../sim/k8s';
import { cidrSource, computeLoad, fwBlocksCidr, studentDelivery, studentFw, utilization } from '../../sim/network';
import type { IncidentTemplate } from '../../sim/scenario';
import type { World } from '../../sim/types';
import { POD_RPS } from '../k8sWorld';
import { ifPhrases } from './d4';

// ---------- the students' peaks (D-Day's curve in days/day5.ts is built from these) ----------

/** Students per second at 10:00 open, 신청 집중 (10:05–10:15) and 정정 (10:15–10:20). */
export const OPEN_RPS = 10800;
export const FOCUS_RPS = 14400;
export const LATE_RPS = 12000;
/** Once the doors open the curve wobbles by ±1.5% so the graph looks alive. */
export const WOBBLE = 0.015;
/** The tops of the open and 신청 집중 plateaus, wobble included. */
const OPEN_PEAK = Math.round(OPEN_RPS * (1 + WOBBLE));
const FOCUS_PEAK = Math.round(FOCUS_RPS * (1 + WOBBLE));

// ---------- what the checks (and D-Day's health) measure ----------

/** Requests per second the Running enroll pods can serve. */
export const enrollCapacity = (w: World): number => (w.k8s ? readyPods(w.k8s, 'enroll').length * POD_RPS : 0);

/** The enroll app's DB connection pool per pod (`env enroll` → DB_POOL); null if it isn't a usable number. */
export function dbPool(w: World): number | null {
  const raw = w.k8s?.deployments.enroll?.env.DB_POOL;
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= 1 ? n : null;
}

/** DB connections the Running enroll pods try to hold (each opens its whole pool). */
export const dbWanted = (w: World): number => (w.k8s ? readyPods(w.k8s, 'enroll').length * (dbPool(w) ?? 0) : 0);

/** DB-01's connection limit. */
export const dbMax = (w: World): number => w.db?.maxConn ?? Infinity;

/** The pods ask DB-01 for more connections than it allows. */
export const dbOver = (w: World): boolean => dbWanted(w) > dbMax(w);

/** Logical links running hotter than this make pages slow (the network core's own threshold). */
export const HOT_UTIL = 0.9;

/** Links above HOT_UTIL right now (keys of w.net.load). */
export const hotLinks = (w: World): string[] => Object.keys(w.net?.load ?? {}).filter((k) => utilization(w, k) > HOT_UTIL);

/**
 * Would every link stay under HOT_UTIL with the students at the 신청 집중 peak? (The links as they are
 * now; bots aside, since blocking them is the macro incident's business.)
 */
function carriesFocusPeak(w: World): boolean {
  const sources = (w.traffic.sources ?? []).filter((s) => s.kind !== 'macro');
  const load = computeLoad({ ...w, traffic: { ...w.traffic, rps: Math.max(w.traffic.rps, FOCUS_PEAK), sources } });
  return Object.values(load).every((l) => l.cap <= 0 || l.mbps / l.cap <= HOT_UTIL);
}

/**
 * Macro sources the firewall still lets (some of) through to the 수강신청 address: a range counts as
 * blocked only when the firewall drops all of it (judged like `fw top`'s FW column).
 */
export function botsAllowed(w: World): string[] {
  const lb = w.net?.lb;
  if (!lb) return [];
  return (w.traffic.sources ?? []).filter((s) => s.kind === 'macro' && fwBlocksCidr(w, s.cidr, lb.publicIp, lb.port) < 1).map((s) => s.cidr);
}

/** Share of the students (STUDENT_BLOCKS, evenly) the firewall lets through to 수강신청. */
export const studentFwShare = (w: World): number => studentFw(w).allowed;

/**
 * Students still get through at all (a fix that blocks everyone, or takes the service down, is no fix).
 * studentDelivery already turns away the students a firewall rule catches.
 */
const studentsGetThrough = (w: World): boolean => studentDelivery(w).ok > 0.5;

/** The macro bots' source as `fw top` lists it: an outside hosting block, same label in every variant. */
export const BOT_LABEL = '해외 클라우드 서버';

/**
 * 빈자리 노리기: the bots take the seats the students leave. Once 정정 winds down, a macro source sends
 * what the students no longer do, so the L4 session table stays as full as at 10:16 until the bots are
 * blocked (what the alarm and `lb status` say). D-Day's onTick calls this after setting the students' rps.
 */
export function macroPress(w: World): void {
  for (const s of w.traffic.sources ?? []) {
    if (s.kind !== 'macro') continue;
    const base = Number(w.flags[s.id] ?? s.rps);
    s.rps = Math.max(base, Math.round(base + LATE_RPS - w.traffic.rps));
  }
}

/** TOR-02's uplinks to CORE-01: the one in use and the spare that is cabled but shut. */
const TOR_PORTS = ['Te1/1/1', 'Te1/1/2'];
const CORE_PORTS = ['Te1/0/6', 'Te1/0/7'];

export const templates: IncidentTemplate[] = [
  {
    // 10:00 open: ~10,800 students a second against 4 enroll pods × 1000. Any scale-out big enough to
    // carry it (11+ pods) sets off the DB incident below (11 × DB_POOL 20 > 200). Held to the open's
    // peak, so the 10:20:30 drop doesn't fix it for the player.
    id: 'dday-capacity',
    day: 5,
    weight: 0,
    variants: [{ pods: 16 }],
    make: (v) => ({
      title: '오픈 직후 수강신청 페이지 응답 없음',
      alert: '수강신청 페이지가 안 열려요! 겨우 들어가도 화면이 빙글빙글 돌기만 해요…',
      severity: 'critical',
      alarm: { source: 'poll', device: 'L4-01', text: 'L4-01 서버 풀 응답시간 급증 (1.5초 이상)' },
      room: 'noc',
      inject: () => {},
      check: (w) => enrollCapacity(w) >= Math.max(w.traffic.rps, OPEN_PEAK),
      hints: [
        '오픈 순간 1초에 들어오는 요청 수(rps)가 얼마나 뛰었어? 그걸 받아 주는 신청 pod 수는 그대로야?',
        'pod 하나가 1초에 감당하는 양은 정해져 있어. 오픈 때 몰려온 양을 받으려면 몇 개가 필요할지 나눗셈해봐. 10시 5분부터는 더 몰려온다고 했지?',
        '쿠버네티스에는 원하는 pod 개수만 바꾸면 알아서 맞춰 주는 명령이 있어. 노드에 자리가 몇 개 남았는지도 같이 봐.',
      ],
      bannedPhrases: ['scale enroll', `${v.pods}개`, `${v.pods}으로`, `${v.pods} 으로`, `${v.pods}개로`],
      solution: `오픈 순간 접속이 평소의 수십 배(약 1만 1천 rps)로 뛰었는데 신청(enroll) pod는 4개(1초에 4천 건)뿐이었다. deploys · pods 로 확인 → scale enroll ${v.pods} (10시 5분 신청 집중의 1만 4천여 rps까지 대비. scale 은 앱 하나당 최대 16개). 오픈 피크를 받을 만큼 늘려야 풀린다: 10시 20분 넘어 접속이 줄어도 pod 수가 그대로면 안 풀린다.`,
      solutionSteps: [{ cmd: `scale enroll ${v.pods}`, host: 'ops' }],
      concept: 'scaleOut',
      lesson: '평소의 서른 배 넘는 손님이 1분 만에 몰렸어요(피크). 원하는 pod 개수만 바꾸자 쿠버네티스가 바로 늘려줬어요. 다음엔 피크 전에 미리 늘려 두기!',
    }),
  },
  {
    // The scale-out's side effect: every enroll pod opens DB_POOL connections to DB-01 (max 200).
    // Fires on a condition (planned as optional): it only happens if the player scales past 10 pods.
    id: 'dday-db',
    day: 5,
    weight: 0,
    variants: [{ pool: 10 }],
    make: (v) => ({
      title: '신청 버튼 누르면 오류',
      alert: '신청 버튼 누르면 에러가 나요! "잠시 후 다시 시도해 주세요"만 떠요. 페이지는 열리는데요?',
      severity: 'critical',
      alarm: { source: 'poll', device: 'db', text: 'DB-01 동시 연결 수 한도 도달 (200/200)' },
      room: 'noc',
      inject: () => {},
      check: (w) => dbPool(w) !== null && !dbOver(w) && enrollCapacity(w) > 0,
      hints: [
        '에러는 언제부터 났어? 방금 바꾼 게 있지 않아? 늘어난 pod들이 다 같이 쓰는 게 뭘까?',
        'DB는 동시에 받을 수 있는 연결 수(좌석)가 정해져 있어. pod 하나가 DB와 미리 열어 두는 연결 수 × pod 수를 계산해서 DB 좌석 수와 비교해봐.',
        'pod 수는 그대로 두고, pod 하나가 쥐는 연결 수를 줄이는 방법이 있어. 앱의 환경변수(설정)를 보고 바꾸는 명령을 떠올려봐.',
      ],
      bannedPhrases: [
        `연결 ${v.pool}개`,
        `${v.pool}으로`,
        `${v.pool} 으로`,
        `${v.pool}개로`,
        `DB_POOL을 ${v.pool}`,
        `DB_POOL 을 ${v.pool}`,
      ],
      solution: `늘린 신청 pod마다 DB 연결을 20개씩 미리 열어 두다 보니(예: 16 × 20 = 320) DB-01의 연결 한도(200)를 넘어, 자리를 못 잡은 요청이 오류가 났다. env enroll 로 DB_POOL 확인 → env set enroll DB_POOL=${v.pool} (16 × ${v.pool} = 160, 한도 안). DB_POOL 이 0이나 숫자가 아닌 값(오타)이면 pod가 DB 연결을 아예 못 열어서 같은 증상이 난다: 같은 명령으로 1 이상의 정수(pod 수 × 값 ≤ 200)로 고친다.`,
      solutionSteps: [{ cmd: `env set enroll DB_POOL=${v.pool}`, host: 'ops' }],
      concept: 'queue',
      lesson: '앞단(pod)을 넓히자 뒷단(DB)의 좌석이 모자랐어요. pod 수 × pod당 연결 수가 DB 한도를 넘으면 안 돼요. 한 곳을 넓히면 그다음 좁은 곳을 꼭 확인!',
    }),
  },
  {
    // 10:05 신청 집중 (~14,400 rps): with the enroll pods spread over n1–n4, half the traffic crosses
    // TOR-02's single 10G uplink (~115%), while TOR-01 has its 20G Po1. The spare TOR-02 Te1/1/2 ↔
    // CORE-01 Te1/0/7 is cabled but shut. Bundling both (LACP, the D-2 lesson) gives 20G (~58%).
    // Fixed when the links would carry the 신청 집중 peak, so the 10:20:30 drop doesn't fix it.
    id: 'dday-uplink',
    day: 5,
    weight: 0,
    variants: [{ group: 2 }],
    make: (v) => {
      const po = `Po${v.group}`;
      const bundle = (ports: string[]) => [
        'enable',
        'configure terminal',
        `interface ${ports[0].toLowerCase()}`,
        `channel-group ${v.group} mode active`,
        `interface ${ports[1].toLowerCase()}`,
        `channel-group ${v.group} mode active`,
        'no shutdown',
        'end',
        'write memory',
      ];
      return {
        title: '수강신청 응답 느림 · 간헐적 실패',
        alert: '신청은 되는데 너무 느려요… 몇 번씩 눌러야 겨우 되고, 가끔은 튕겨요.',
        severity: 'major',
        alarm: { source: 'poll', device: 'TOR-02', text: 'TOR-02 업링크 사용률 100% 초과' },
        room: 'network',
        inject: () => {},
        check: (w) => hotLinks(w).length === 0 && carriesFocusPeak(w) && studentsGetThrough(w),
        hints: [
          '관제 화면(NMS) 지도에서 빨갛게 변한 선은 어디야? 같은 일을 하는 다른 랙 스위치의 선과 굵기(용량)를 비교해봐.',
          'TOR-01은 같은 코어로 가는 선 두 가닥을 하나로 묶어서 두 배로 쓰고 있어. 3번 랙 스위치에도 같은 코어로 꽂혀는 있는데 꺼져 있는 선이 있는지, 두 스위치의 포트 상태를 비교해봐.',
          'D-2에 했던 것처럼 선 양쪽 끝 포트를 같은 묶음에 넣으면 돼. 꺼둔 포트는 켜고, 코어 쪽엔 TOR-01과의 묶음이 이미 있으니 새 묶음엔 아직 안 쓰는 번호를 골라. 묶음 상태를 보여주는 show 명령으로 확인한 다음 저장!',
        ],
        bannedPhrases: [
          ...[...TOR_PORTS, ...CORE_PORTS].flatMap(ifPhrases),
          po,
          `port-channel ${v.group}`,
          `채널 그룹 ${v.group}`,
          `채널그룹 ${v.group}`,
          `포트채널 ${v.group}`,
          `포트 채널 ${v.group}`,
        ],
        solution: `TOR-02(3번 랙)는 코어로 가는 길이 10G 한 가닥뿐이라 신청 집중(약 1만 4천 rps) 때 꽉 찼다(115%). 꽂혀만 있던 예비 선(TOR-02 Te1/1/2 ↔ CORE-01 Te1/0/7)을 켜고 두 가닥을 LACP로 묶는다. TOR-02: enable → configure terminal → interface te1/1/1 → channel-group ${v.group} mode active → interface te1/1/2 → channel-group ${v.group} mode active → no shutdown → end → write memory. CORE-01도 같은 방법으로 te1/0/6, te1/0/7 (CORE-01의 Po1 은 이미 TOR-01 묶음이라 새 번호를 쓴다). show etherchannel summary 에서 ${po}(SU), 두 포트 (P) 확인. TOR-02 의 CORE-02 쪽 선(Te1/1/3)은 STP 가 막아 둔 비상용 길이고, 코어 두 대는 따로 노는 장비라 다른 코어로 가는 선과는 묶을 수 없다. 신청 집중 피크를 받을 만큼 넓혀야 풀린다: 10시 20분 넘어 접속이 줄어도 묶지 않으면 안 풀린다.`,
        solutionSteps: [
          { ios: bundle(TOR_PORTS), host: 'TOR-02' },
          { ios: bundle(CORE_PORTS), host: 'CORE-01' },
        ],
        concept: 'peak',
        lesson: '3번 랙의 길이 10G 한 가닥뿐이라 병목이었어요. 놀던 예비 선을 켜서 두 가닥을 묶자(LACP) 20G가 됐어요. 묶어 두면 한 가닥이 끊겨도 나머지로 버텨요.',
      };
    },
  },
  {
    // 10:15 정정·빈자리 노리기: macro bots (one seeded outside block) fill the L4 session table, so new
    // student sessions are refused. `fw top` shows them (requests per address far above a person's).
    // They keep it full after 10:20:30 too (macroPress). Fixed when they are blocked and every student
    // block still gets through.
    id: 'dday-macro',
    day: 5,
    weight: 0,
    variants: [
      { cidr: '192.0.2.0/24', rps: 7000 },
      { cidr: '198.18.7.0/24', rps: 8000 },
      { cidr: '198.19.200.0/24', rps: 6500 },
    ],
    make: (v) => {
      const cidr = String(v.cidr);
      return {
        title: '수강신청 다시 접속 불가',
        alert: '또 접속이 안 돼요! "접속자가 너무 많습니다"만 떠요. 아까보다 사람은 줄었다는데요?',
        severity: 'critical',
        alarm: { source: 'trap', device: 'L4-01', text: 'L4-01 세션 테이블 가득 참 (30000/30000)' },
        room: 'noc',
        inject: (w) => {
          const sources = (w.traffic.sources ??= []);
          const id = `bots:${cidr}`;
          // The variant's rate, which macroPress tops up as the students leave.
          w.flags[id] = Number(v.rps);
          if (!sources.some((s) => s.cidr === cidr)) sources.push({ id, label: BOT_LABEL, cidr, rps: Number(v.rps), kind: 'macro' });
        },
        check: (w) => botsAllowed(w).length === 0 && studentFwShare(w) > 0.99 && studentsGetThrough(w),
        hints: [
          'L4가 붙잡고 있는 손님(세션) 수가 지금 학생 수에 비해 이상하게 많지 않아? 요청이 어디서 오는지 출발지별로 볼 수 있을까?',
          '사람은 주소 하나당 20초에 한 번쯤(0.05) 누르지만, 매크로(자동 클릭 프로그램)는 1초에 수십 번 눌러. 주소 하나당 요청 수가 튀는 출발지를 찾아봐. 입구 경비(방화벽)가 그걸 볼 수 있어.',
          '방화벽에는 요청을 많이 보내는 출발지를 순서대로 보여주는 명령과, 특정 출발지 대역을 막는 규칙을 맨 위에 넣는 명령이 있어. 학생들 대역까지 막지 않게 범위를 꼭 확인!',
        ],
        bannedPhrases: [cidr, cidrSource(cidr), cidr.split('.').slice(0, 3).join('.')],
        solution: `매크로(자동 클릭 프로그램)들이 L4 세션 자리(30000)를 차지해서 학생들의 새 접속이 거부됐다. ssh FW-01 → fw top 에서 주소 하나당 요청 수가 사람의 수백 배인 출발지(${cidr}, ${BOT_LABEL})를 찾고 → fw deny ${cidr}. 학생 대역(175.223 · 211.234 · 59.10)은 막지 않는다(하나라도 막혀 있으면 안 풀린다). 10시 20분 넘어 학생이 줄어도 매크로가 빈자리를 채워서, 막기 전까지 세션은 가득 찬 채로 남는다.`,
        solutionSteps: [{ cmd: `fw deny ${cidr}`, host: 'FW-01' }],
        concept: 'firewall',
        lesson: '매크로(사람 대신 신청 버튼을 자동으로 누르는 프로그램)가 사람보다 수백 배 빨리 눌러서 L4의 좌석(세션)을 차지했어요. 방화벽은 들어오는 요청을 출발지별로 보고 막을 수 있어서, 그 출발지 대역만 막자 학생들이 다시 들어왔어요. 너무 넓게 막으면 학생도 막혀요!',
      };
    },
  },
];
