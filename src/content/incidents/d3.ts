// Incident templates first taught on D-3. See IncidentTemplate in src/sim/scenario.ts.
import { replaceCable } from '../../sim/actions';
import { lbView, linkUp, studentDelivery } from '../../sim/network';
import type { IncidentTemplate } from '../../sim/scenario';
import type { World } from '../../sim/types';
import { ifPhrases } from './d4';

/** Students get through: the L4 has a healthy member and most requests make it (a little loss elsewhere doesn't count). */
export const studentsServed = (w: World): boolean => lbView(w).members.some((m) => m.healthy) && studentDelivery(w).ok > 0.5;

export const templates: IncidentTemplate[] = [
  {
    // The L4's health check asks the wrong path or port, so it marks the healthy web server down and
    // sends students nowhere. Until D-3: later days' pool members (containers, pods) listen elsewhere,
    // so the port fix wouldn't carry over.
    id: 'd3-l4health',
    day: 2,
    until: 2,
    variants: [
      { kind: 'path', bad: '/healthz' },
      { kind: 'port', bad: 8080 },
    ],
    make: (v) => ({
      title: '수강신청 사이트 접속 불가',
      alert: '수강신청 사이트가 갑자기 안 열려요! 웹 서버는 멀쩡히 켜져 있다는데요?',
      severity: 'critical',
      alarm: { source: 'trap', device: 'L4-01', text: 'L4-01 서버 풀 멤버 전부 DOWN' },
      room: 'noc',
      inject: (w) => {
        const lb = w.net?.lb;
        if (!lb) return;
        if (v.kind === 'path') {
          lb.health.proto = 'http';
          lb.health.path = String(v.bad);
        } else lb.health.port = Number(v.bad);
      },
      check: studentsServed,
      hints: [
        '웹 서버에 직접 요청하면 돼? 학생들이 쓰는 대표 주소로 요청하면? 둘 다 해보고 어디서 달라지는지 비교해봐.',
        '학생 요청은 L4(입구 안내원)를 거쳐서 서버로 가. 안내원은 서버가 살아 있는지 정해진 방법으로 계속 물어봐. 안내원이 지금 서버를 어떻게 보고 있는지 L4에 들어가서 확인해봐.',
        'L4에는 서버 목록과 헬스체크(살아 있는지 묻는 방법) 설정을 보여주는 명령이 있어. 그 설정을 웹 서버가 실제로 가진 경로·포트와 하나씩 비교해봐.',
      ],
      // The right value too, in plain words ("경로를 /health 로" / "포트를 80으로"): ' /health ' is word-edged
      // so '/healthz' still passes, and '80' never matches inside '8080'.
      bannedPhrases: ['/healthz', '8080', v.kind === 'path' ? ' /health ' : '80'],
      solution:
        v.kind === 'path'
          ? 'L4 헬스체크가 웹 서버에 없는 경로(/healthz)를 묻고 있어서, 멀쩡한 서버를 DOWN으로 보고 손님을 안 보냈다. ssh L4-01 → lb pool / lb health 로 확인 → lb health set path /health'
          : 'L4 헬스체크가 웹 서버가 쓰지 않는 포트(8080)를 묻고 있어서, 멀쩡한 서버를 DOWN으로 보고 손님을 안 보냈다. ssh L4-01 → lb pool / lb health 로 확인 → lb health set port 80',
      solutionSteps: [
        v.kind === 'path' ? { cmd: 'lb health set path /health', host: 'L4-01' } : { cmd: 'lb health set port 80', host: 'L4-01' },
      ],
      concept: 'mttd',
      lesson: '헬스체크가 틀리면 L4는 멀쩡한 서버도 "죽었다"며 손님을 안 보내요. 그리고 학생 민원과 경보 중 뭘 먼저 봤나요? 장애 시작부터 경보 확인(ACK)까지가 MTTD예요.',
    }),
  },
  {
    // One of TOR-01's links to the cores is cut: the one traffic used (spanning tree then opens the spare
    // to CORE-02) or the STP-blocked spare itself. Either way students notice nothing, but there is one
    // path less (major), and the NMS gets a link-down trap at once. D-3 only: under D-2's load test and on
    // later days' bundles, losing an uplink is no longer invisible to students, so this text wouldn't hold.
    id: 'd3-uplink',
    day: 2,
    until: 2,
    variants: [
      { cable: 'tor1-up1', port: 'Te1/1/1' },
      { cable: 'tor1-up3', port: 'Te1/1/3' },
    ],
    make: (v) => {
      const id = String(v.cable);
      const port = String(v.port);
      return {
        title: '경보는 떴는데 학생들은 정상',
        alert: '관제 화면에 경보가 하나 떴는데, 학생들은 아무 문제 없대요. 이거 지금 봐야 해요?',
        severity: 'major',
        alarm: { source: 'trap', device: 'TOR-01', text: 'TOR-01 인터페이스 링크 다운' },
        room: 'network',
        inject: (w) => {
          const c = w.cables[id];
          if (c) c.broken = true;
        },
        check: (w) => {
          const c = w.cables[id];
          return !!c && !c.broken && !c.degraded && linkUp(w, 'TOR-01', port);
        },
        hints: [
          '관제 화면(NMS)에서 그 스위치를 열어봐. 불이 꺼진(down) 포트는 어디로 이어져 있어? 그런데 서비스는 왜 멀쩡할까?',
          '랙 스위치에서 코어로 가는 길은 여러 갈래야. 끊긴 게 평소에 데이터가 다니던 길이야, 막아 두었던 예비 길이야? 어느 쪽이든 길이 하나 줄었으니 다음 고장엔 버틸 여유가 줄어. 끊긴 길의 물리 상태부터 봐.',
          '네트워크실 TOR 배선판 앞에서 케이블을 하나씩 검사하고 손볼 수 있어.',
        ],
        bannedPhrases: ifPhrases(port),
        solution: `TOR-01 ${port} ↔ 코어 스위치 사이 케이블이 끊어졌다. 남은 길로 서비스는 살아 있지만 이중화가 줄어든 상태(major). 네트워크실 TOR 배선판(케이블 점검)에서 그 케이블을 테스트하고 새것으로 교체한다.`,
        solutionSteps: [{ label: `TOR-01 ${port} 업링크 케이블 교체`, action: (w) => replaceCable(w, id) }],
        concept: 'spof',
        lesson: '길이 여러 갈래라 하나가 끊겨도 서비스는 살았어요. 하지만 끊긴 채로 두면 다음 고장엔 버틸 게 줄어요. 그래서 "서비스 영향 없음"이어도 major예요.',
      };
    },
  },
  {
    // v1 s4-notify: after the split, the notification service crashes and enrollment keeps working.
    // The app layer only exists on D-3.
    id: 'd3-notify',
    day: 2,
    until: 2,
    variants: [{ svc: 'notify' }],
    make: () => ({
      title: '알림 서비스 다운',
      alert: '수강신청 알림 메일이 안 온대요! …그런데 신청은 잘 되고 있대요?',
      severity: 'minor',
      alarm: { source: 'poll', device: 'web', text: 'WEB-01 알림(notify) 서비스 응답 없음' },
      room: 'noc',
      inject: (w) => {
        const n = w.app?.services.notify;
        if (n) n.up = false;
      },
      check: (w) => !!w.app?.services.notify?.up && !w.app.notifyBug,
      hints: [
        '관제 화면에서 수강신청 성공률을 봐. 알림이 죽었는데 그 숫자는 어때? 한 덩어리였을 때랑 뭐가 달라졌지?',
        '이제 알림은 따로 떨어진 매장이야. 그 매장만 손보면 돼. 서비스 상태를 보는 명령부터!',
        '서비스 하나만 다루는 svc 명령들이 있어. 알림팀이 고친 새 버전(핫픽스)을 올려 뒀대. 그 버전이 돌게 하려면 그 서비스에 뭘 해야 할까?',
      ],
      // The fix in plain words too ("재시작해", "다시 시작해", "restart").
      bannedPhrases: ['svc restart notify', 'restart notify'],
      solution: '알림 서비스만 재시작한다: svc restart notify (급히 고친 새 버전, 핫픽스가 반영됨)',
      solutionSteps: [{ cmd: 'svc restart notify', host: 'ops' }],
      concept: 'isolation',
      lesson: '알림이 죽어도 신청은 됐어요! 기능별로 나눈 덕분에 장애가 번지지 않았어요(장애 격리).',
    }),
  },
  {
    // A campus service run by another team gets slow. Our network is fine: hand it to its team.
    id: 'd3-campus',
    day: 2,
    variants: [
      { svc: 'lms', label: 'KHU LMS', what: '온라인 강의·과제 사이트', team: 'LMS 운영팀', ms: 180 },
      { svc: 'library', label: 'KHU 도서관', what: '도서 검색·대출 사이트', team: '도서관 시스템팀', ms: 140 },
    ],
    make: (v) => {
      const svc = String(v.svc);
      const back = (w: World) => {
        const s = w.campus?.[svc];
        if (s) {
          s.up = true;
          s.latencyMs = Number(v.ms);
        }
      };
      return {
        title: `${v.label} 응답 지연`,
        alert: `${v.label}(${v.what}) 접속이 너무 느리대요. 페이지 하나 여는 데 몇 초씩 걸린대요.`,
        severity: 'minor',
        // Campus services aren't devices in the NMS map: the alarm is pinned on the service (SMS row).
        alarm: { source: 'poll', device: svc, text: `${v.label} 응답시간 4초 이상` },
        room: 'noc',
        inject: (w) => {
          const s = w.campus?.[svc];
          if (s) s.latencyMs = 4200;
        },
        check: (w) => {
          const s = w.campus?.[svc];
          return !!s && s.up && s.latencyMs < 1000;
        },
        escalate: { delay: 20, team: String(v.team), fix: back },
        hints: [
          '느린 게 그 서비스 하나뿐이야, 전부야? 수강신청이랑 다른 교내 서비스 응답시간은 어때?',
          '우리가 관리하는 길(네트워크)이 문제라면 다른 서비스도 같이 느려야 해. 이 서비스를 누가 운영하는지 서비스 관제 화면(SMS)에서 확인해봐.',
          '내 담당이 아닌 시스템은 직접 손대지 않아. 경보 목록에 이런 경우를 위한 버튼이 있어.',
        ],
        bannedPhrases: [String(v.team)],
        solution: `우리 네트워크와 다른 서비스는 정상이고 ${v.label}만 느리다 → ${v.team}이 운영하는 서버 쪽 문제. NOC 경보 목록에서 "담당팀 이관"을 눌러 ${v.team}에 넘기고, 해결될 때까지 지켜본다.`,
        solutionSteps: [{ label: `담당팀 이관 → ${v.team} 조치`, action: back }],
        concept: 'escalation',
        lesson: '우리 길은 멀쩡하고 그 서비스만 느렸어요. 내 담당이 아닌 시스템은 증상을 정리해서 담당팀에 넘기는(이관) 게 맞아요. 넘긴 뒤에도 해결될 때까지 지켜보기!',
      };
    },
  },
];
