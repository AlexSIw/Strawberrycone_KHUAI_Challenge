// The 퇴근 퀴즈 of each weekday: five questions a day, three drawn for every attempt (src/content/quizRun.ts).
// The rules tests/quiz.test.ts holds them to:
//  - each question checks a card a mission of that day awards, and can be answered from that day's dialogue,
//    mission whys and cards (never from a randomly drawn incident);
//  - the question is board text (해요체); the explanation is 쿠사수's (반말, his portrait shows next to it), at
//    most 2 sentences and 120 characters;
//  - 3–4 choices, no absolute words (항상·절대·모든·반드시·무조건·전혀), and the right choice is never the only
//    longest or the only shortest one.
import type { Quiz } from './types';

const DRAW = 3;

/** D-5 · 물리 구축 */
const D5: Quiz = {
  draw: DRAW,
  pool: [
    {
      concept: 'epstps',
      question: '도서관 노트북에서 누른 수강신청 요청은 건물 안에서 무엇을 타고 데이터센터까지 올까요?',
      choices: ['층마다 있는 통신선 통로(TPS실)의 선', '층마다 있는 전기 통로(EPS실)의 전선', '건물 옥상 안테나에서 쏘는 무선 전파', '건물 엘리베이터 통로의 비상 전화선'],
      answer: 0,
      explain: '건물 층마다 통신선 통로(TPS실)가 있어서, 네트워크 선이 거길 타고 데이터센터까지 와. EPS실은 전기 배선이 지나는 통로야.',
    },
    {
      concept: 'rack',
      question: '1번 랙 맨 위에 미리 달려 있던 TOR-01은 무슨 일을 할까요?',
      choices: ['그 랙 서버들을 네트워크에 이어 준다', '그 랙 서버들에 전기를 나눠 준다', '그 랙 안의 뜨거운 공기를 식혀 준다', '그 랙 서버들의 신청 기록을 보관한다'],
      answer: 0,
      explain: 'TOR-01은 랙 맨 위에 다는 스위치(ToR)야. 그 랙 서버들의 케이블을 받아서 네트워크에 이어 줘.',
    },
    {
      concept: 'pdu',
      question: '서버 전원을 A줄·B줄 두 줄 다 꽂은 이유는 뭘까요?',
      choices: ['두 줄로 받으면 서버가 더 빨리 돌아서', '한 줄이 끊겨도 서버가 계속 켜져 있게', 'A줄 하나로는 서버 전기가 모자라서', 'B줄은 정전 때 UPS 배터리 전기를 받는 줄이라서'],
      answer: 1,
      explain: '서버에는 전원부가 두 개라 A줄·B줄에 하나씩 꽂아. 한 줄(PDU 하나)이 끊겨도 다른 줄로 계속 켜져 있어.',
    },
    {
      concept: 'portled',
      question: 'NMS에서 TOR-01 포트 표를 봤어요. 초록 불이 켜진 포트는 어떤 상태일까요?',
      choices: ['일부러 쉬게 둔 예비 포트', '받은 데이터가 깨진 채 들어오는 중', '양쪽이 이어져 신호가 오가는 중', '꽂혀는 있지만 신호가 아직 없음'],
      answer: 2,
      explain: '초록은 케이블 양쪽이 이어져 신호가 오가는 상태야. 계속 주황이면 일부러 쉬게 둔 예비 포트, 꺼져 있으면 연결이 없거나 끊긴 거야.',
    },
    {
      concept: 'ups',
      question: 'FMS 탭에서 냉방(항온항습기)에 이상이 보여요. 관제실에 있는 우리는 뭘 해야 할까요?',
      choices: ['시설팀에 알리고 FMS로 계속 지켜본다', '냉각실로 가서 항온항습기를 직접 고친다', '열이 오르기 전에 서버 전원부터 내린다', 'UPS 배터리로 냉방 전기를 바꿔 준다'],
      answer: 0,
      explain: '전기·냉방 같은 시설은 시설팀 담당이야. 우리는 FMS로 지켜보다가 이상하면 바로 알려.',
    },
  ],
};

/** Each weekday's quiz, by day (D-5 = 0). D-Day has none. */
export const QUIZZES: Quiz[] = [D5];
