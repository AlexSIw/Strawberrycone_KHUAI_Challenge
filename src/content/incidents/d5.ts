// Incident templates first taught on D-5. See IncidentTemplate in src/sim/scenario.ts.
import { replaceCable } from '../../sim/actions';
import { cableAt, linkUp } from '../../sim/network';
import type { IncidentTemplate } from '../../sim/scenario';
import type { World } from '../../sim/types';

/** The cable plugged into a server's eth0 (wherever on the switch the player put it). */
const serverCable = (w: World, host: string) => cableAt(w, `${host}:eth0`);

export const templates: IncidentTemplate[] = [
  {
    // A half-damaged server cable: the link stays up, CRC errors climb, the LED flickers green/amber.
    // Found in the NMS port view (IOS isn't taught until D-4), fixed by swapping the cable.
    id: 'd5-crc',
    day: 0,
    variants: [
      { host: 'web', label: 'WEB-01' },
      { host: 'web2', label: 'WEB-02' },
      { host: 'db', label: 'DB-01' },
    ],
    make: (v) => {
      const host = String(v.host);
      return {
        title: '포트 불빛이 초록·주황으로 깜빡임',
        alert: '네트워크실 지나가다 봤는데, TOR 배선판의 포트 불빛 하나가 초록이랑 주황으로 번갈아 깜빡여요. 원래 그래요?',
        severity: 'warning',
        alarm: { source: 'poll', device: 'TOR-01', text: 'TOR-01 포트 입력 오류(CRC) 증가' },
        room: 'network',
        inject: (w) => {
          const c = serverCable(w, host);
          if (c) c.degraded = true;
        },
        check: (w) => {
          const c = serverCable(w, host);
          return !!c && !c.broken && !c.degraded && linkUp(w, host, 'eth0');
        },
        hints: [
          '관제 화면(NMS)에서 그 스위치를 열고 포트마다 숫자를 비교해봐. 시간이 갈수록 계속 늘어나는 칸이 있는 포트는 어디야?',
          '불은 들어오는데(연결은 살아 있는데) 깨진 데이터가 쌓인다면, 신호가 지나가는 길(맨 아래 물리 계층)에 흠이 있는 거야. 그 포트에 꽂힌 게 뭔지 끝까지 따라가 봐.',
          '네트워크실 TOR 배선판 앞에서 케이블을 하나씩 검사하고 손볼 수 있어.',
        ],
        bannedPhrases: [String(v.label)],
        solution:
          '케이블 속 선이 일부 손상돼서 연결은 살아 있지만 깨진 데이터(CRC 오류)가 쌓이고 있다. NMS에서 CRC가 늘어나는 TOR-01 포트를 찾아 그 케이블을 따라가고, 네트워크실 TOR 배선판에서 새 케이블로 교체한다.',
        solutionSteps: [
          {
            label: `${v.label} 케이블 교체`,
            action: (w) => {
              const c = serverCable(w, host);
              if (c) replaceCable(w, c.id);
            },
          },
        ],
        todo: '깜빡이는 포트의 케이블을 새것으로 바꾸기',
        checks: [],
        fixHow: 'NMS에서 CRC가 늘어나는 TOR-01 포트를 찾고 → 네트워크실 TOR 배선판에서 케이블 교체',
        concept: 'osi',
        lesson: '케이블이 반쯤 망가지면 불은 들어와도(링크 UP) 깨진 데이터가 섞여요(CRC 오류). 늘어나는 숫자를 보고 찾고, 문제 찾기는 언제나 L1(케이블)부터!',
      };
    },
  },
];
