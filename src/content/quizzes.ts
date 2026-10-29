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

/** D-4 · 네트워크 */
const D4: Quiz = {
  draw: DRAW,
  pool: [
    {
      concept: 'oob',
      question: '관리 PC에서 ssh로 스위치에 들어가는 길(관리망)은 서비스가 다니는 길과 따로 깔려 있어요. 그래서 좋은 점은 뭘까요?',
      choices: ['서비스 길이 망가져도 장비에 들어가 고친다', '학생 요청이 관리망으로 더 빨리 지나간다', '관리망으로 들어가면 설정이 저절로 저장된다', '관리망에서는 비밀번호 없이 장비에 들어간다'],
      answer: 0,
      explain: '관리망(10.10.250.x)은 장비 관리 전용 길이야. 서비스 네트워크가 망가져도 이 길로 들어가서 고칠 수 있어.',
    },
    {
      concept: 'gateway',
      question: 'VLAN 10의 WEB-01이 VLAN 20의 DB-01에 데이터를 보내요. 어디를 거쳐 갈까요?',
      choices: ['같은 랙의 TOR-01 안에서 바로 간다', '이름을 아는 DNS 서버 ns1을 거친다', '장비 관리 전용 길(관리망)로 간다', 'CORE-01의 게이트웨이(.1)로 간다'],
      answer: 3,
      explain: '다른 VLAN으로 가는 데이터는 게이트웨이를 거쳐. TOR-01(L2)은 같은 VLAN 안만 배달하고, VLAN 사이 길은 L3 스위치 CORE-01이 찾아 줘.',
    },
    {
      concept: 'dns',
      question: '수강신청 앱이 DB-01을 숫자 주소 대신 이름 db로 찾아갈 수 있게 된 건 무엇 덕분일까요?',
      choices: ['dhcp01이 db에게 주소를 빌려줘서', 'VLAN 20 게이트웨이가 생겨서', 'ns1에 db와 그 주소를 올려 둬서', 'DB 포트를 VLAN 20에 넣어서'],
      answer: 2,
      explain: 'DNS(ns1)는 이름을 IP 주소로 바꿔 주는 전화번호부야. db = 10.10.20.11을 올려 둬서 앱이 이름으로 찾아가.',
    },
    {
      concept: 'privateip',
      question: '도서관 와이파이에 처음 붙은 노트북은 10.20.x.x 주소를 어디서 받을까요?',
      choices: ['dhcp01이 그 건물 주소 풀에서 빌려준다', 'ns1이 노트북 이름을 보고 정해 준다', 'CORE-01 게이트웨이(.1)가 직접 붙여 준다', '노트북이 인터넷에서 빈 주소를 찾아 쓴다'],
      answer: 0,
      explain: 'dhcp01은 새로 붙은 기기에 건물별 주소 묶음(풀)에서 주소를 빌려줘. 10.으로 시작하는 주소는 건물 안에서만 쓰는 사설 주소야.',
    },
    {
      concept: 'ios',
      question: 'TOR-01과 CORE-01에서 마지막에 write memory를 친 이유는 뭘까요?',
      choices: ['바꾼 설정이 지금 바로 적용되게 하려고', '장비가 다시 켜져도 설정이 남게 하려고', '다른 스위치에도 같은 설정을 보내려고', '설정 모드에서 관리자 모드로 나오려고'],
      answer: 1,
      explain: '바꾼 설정은 바로 적용되지만 지금 돌아가는 설정(running-config)에만 있어. write memory로 startup-config에 저장해야 재부팅해도 남아.',
    },
  ],
};

/** D-3 · 서비스 오픈 */
const D3: Quiz = {
  draw: DRAW,
  pool: [
    {
      concept: 'socket',
      question: '처음 켠 수강신청 앱은 직원 한 명(single) 방식이에요. 손님이 몰리면 어떻게 될까요?',
      choices: ['요청이 줄을 서서 답이 느려진다', '앱이 알아서 직원 수를 늘린다', '한 명이 요청을 한꺼번에 다 처리한다', 'L4가 넘치는 요청을 DB-01로 보낸다'],
      answer: 0,
      explain: '직원 한 명(single)은 한 번에 한 요청만 받아서 나머지는 줄을 서. 연결마다 일꾼을 붙이면(멀티스레드) 여럿을 동시에 받아.',
    },
    {
      concept: 'port',
      question: '수강신청 앱을 켠 뒤 포트를 8080번에서 80번으로 바꾼 이유는 뭘까요?',
      choices: ['80번이 8080번보다 빠른 포트라서', '8080번은 DB 서버가 쓰는 번호라서', '웹 요청은 기본으로 80번을 두드려서', '번호가 작은 포트일수록 안전해서'],
      answer: 2,
      explain: '포트는 한 컴퓨터 안에서 어느 프로그램에 갈지 정하는 호실 번호야. 웹 요청은 기본으로 80번에 와서, 앱이 8080에서 기다리면 닿지 않아.',
    },
    {
      concept: 'l4',
      question: 'L4-01은 뒤에 있는 서버가 살아 있는지 어떻게 알까요?',
      choices: ['서버가 먼저 "살아 있어요"라고 알려 와서', '정해진 경로(/health)를 계속 물어서', '학생 요청이 실패하면 그때 알아채서', 'NMS 지도의 선 색깔을 보고 판단해서'],
      answer: 1,
      explain: 'L4는 헬스체크로 서버의 정해진 경로를 계속 물어보고, 대답하는 서버로만 학생을 보내. 그래서 가볍게 답하는 /health를 쓰게 했어.',
    },
    {
      concept: 'nms',
      question: '관제 화면의 사용률·오류 숫자로 보는 문제는 조금 늦게 경보가 떠요. 왜일까요?',
      choices: ['관제 시스템이 정해진 간격으로 물어봐서', '장비가 문제를 직접 알릴 때까지 기다려서', '누군가 확인(ACK)을 눌러야 경보가 떠서', '경보는 담당팀이 확인한 뒤에야 떠서'],
      answer: 0,
      explain: '관제 시스템은 장비에게 정해진 간격으로 상태를 물어봐(폴링). 그래서 숫자로 보는 문제는 다음 순찰 때에야 경보가 돼.',
    },
    {
      concept: 'isolation',
      question: '앱을 기능별 서비스로 나눈 뒤, 알림 서비스에 버그가 나면 어떻게 될까요?',
      choices: ['알림만 멈추고, 수강신청은 계속된다', '앱 전체가 멈춰 처음부터 다시 켠다', '알림 일을 신청 서비스가 대신 맡는다', '알림을 부르는 로그인도 함께 멈춘다'],
      answer: 0,
      explain: '기능별로 나누면 장애가 그 서비스 안에 갇혀(장애 격리). 알림이 멈춰도 로그인·신청은 계속 일해.',
    },
  ],
};

/** D-2 · 컨테이너 · 링크 */
const D2: Quiz = {
  draw: DRAW,
  pool: [
    {
      concept: 'container',
      question: '레시피(Dockerfile)대로 만든 이미지로 돌리면 서버마다 Python 버전이 달라도 괜찮아요. 왜일까요?',
      choices: ['docker run이 서버 Python을 맞게 바꿔서', '앱이 쓸 Python이 이미지 안에 함께 있어서', '레지스트리가 서버마다 맞는 버전을 골라서', '컨테이너는 Python 없이도 앱을 돌려서'],
      answer: 1,
      explain: '이미지는 앱과 실행 환경(Python과 그 버전)을 레시피대로 통째로 포장한 거야. 그래서 어느 서버에서 실행해도 똑같이 돌아.',
    },
    {
      concept: 'container',
      question: '관리 PC에서 만든 이미지를 docker push로 레지스트리에 올린 이유는 뭘까요?',
      choices: ['APP-01 같은 서버가 내려받아 실행하게', '관리 PC에서 바로 컨테이너로 돌리려고', '레시피(Dockerfile)를 다시 고치려고', '이미지에 버전 번호표(태그)를 붙이려고'],
      answer: 0,
      explain: '레지스트리는 이미지를 모아 두는 공용 창고(냉동고)야. 서버들은 실행할 때 여기서 이미지를 내려받아.',
    },
    {
      concept: 'portMapping',
      question: 'APP-01에서 컨테이너를 docker run -p 80:8000 으로 실행했어요. 80:8000은 무슨 뜻일까요?',
      choices: ['서버의 80번을 컨테이너 안 8000번에 잇는다', '컨테이너 안 80번을 서버의 8000번에 잇는다', '컨테이너를 80개에서 8000개까지 늘린다', '1초에 80건부터 8000건까지 받게 한다'],
      answer: 0,
      explain: '-p 바깥:안쪽이야. 학생과 L4는 서버의 80번 문으로 오고, 앱은 컨테이너 안 8000번 창구에서 기다려서 둘을 이어 줘야 해.',
    },
    {
      concept: 'volume',
      question: 'DB 컨테이너에 볼륨(-v dbdata:…)을 붙인 이유는 뭘까요?',
      choices: ['신청 앱이 DB를 이름 db로 찾게 하려고', 'DB가 기록을 더 빨리 찾게 하려고', '신청 앱이 들어올 3306번 문을 열려고', '컨테이너를 바꿔도 기록이 남게 하려고'],
      answer: 3,
      explain: '컨테이너 안에 적은 데이터는 컨테이너를 지우면 함께 사라져. 바깥 사물함(볼륨)에 적게 하면 새로 만들어도 남아.',
    },
    {
      concept: 'lacp',
      question: 'TOR-01 → CORE-01 케이블 두 줄을 LACP로 묶어 Po1을 만들었어요. 무엇이 달라졌을까요?',
      choices: ['한 줄은 쉬고, 다른 줄이 끊기면 그때 일한다', '두 줄이 VLAN을 반씩 나눠 실어 나른다', '두 줄이 한 길처럼 함께 일해 폭이 두 배다', '한쪽 장비에만 묶어도 양쪽이 같이 쓴다'],
      answer: 2,
      explain: '묶으면 장비가 두 줄을 한 줄(Port-channel)로 봐서 STP가 막지 않아. 둘 다 일해서 폭이 두 배이고, 한 줄이 끊겨도 버텨.',
    },
  ],
};

/** D-1 · 점검 · 이중화 */
const D1: Quiz = {
  draw: DRAW,
  pool: [
    {
      concept: 'pod',
      question: '오늘 리허설은 1초에 1,500건이에요. 신청 pod 하나가 1초에 1000건쯤 처리하면, 원하는 상태에 pod를 최소 몇 개 적어야 할까요?',
      choices: ['1개', '2개', '3개', '15개'],
      answer: 1,
      explain: 'pod 하나가 1초에 1000건쯤이라 1개로는 1,500건을 못 버텨. 2개면 2,000건까지 받을 수 있어.',
    },
    {
      concept: 'selfHealing',
      question: '원하는 상태에 신청 pod를 2개로 적어 뒀다고 해 봐요. pod 하나가 죽으면 어떻게 될까요?',
      choices: ['남은 pod 하나가 두 몫을 계속 맡는다', '설계 보드에서 다시 2개로 적어야 한다', '쿠버네티스가 새 pod를 띄워 채운다', '그 노드가 고쳐질 때까지 1개로 돈다'],
      answer: 2,
      explain: '쿠버네티스는 원하는 상태와 실제 상태를 계속 비교해서 맞춰. pod가 죽으면 사람이 손대기 전에 새 pod를 띄워(Self-healing).',
    },
    {
      concept: 'service',
      question: 'pods 목록의 IP 칸은 pod가 새로 뜨면 바뀌어요. 그럼 학생 요청은 어떻게 살아 있는 pod를 찾아갈까요?',
      choices: ['바뀌지 않는 대표 이름(Service)을 거쳐 간다', '학생이 새 pod IP를 직접 찾아 입력한다', 'L4에 새 pod IP를 손으로 다시 등록한다', '죽은 pod의 IP를 새 pod가 그대로 물려받는다'],
      answer: 0,
      explain: 'Service(enroll-svc)는 바뀌지 않는 대표 번호야. 그 이름으로 부르면 그때 살아 있는 pod로 이어 줘.',
    },
    {
      concept: 'hsrp',
      question: 'CORE-02를 VLAN 10 게이트웨이의 짝(Standby)으로 붙였어요. CORE-01이 멈추면 VLAN 10의 WEB-01·WEB-02는 어떻게 될까요?',
      choices: ['서버마다 게이트웨이를 .3으로 바꿔 줘야 한다', 'CORE-02가 .1을 이어받아 그대로 쓴다', '고쳐질 때까지 다른 VLAN으로 못 간다', 'DHCP가 새 게이트웨이 주소를 나눠 준다'],
      answer: 1,
      explain: '.1은 두 코어가 함께 맡는 가상 주소(HSRP)야. CORE-01이 멈추면 Standby인 CORE-02가 바로 이어받아서 서버들은 문이 바뀐 줄도 몰라.',
    },
    {
      concept: 'drain',
      question: '냉각이 돌아와 노드가 다시 Ready가 됐는데, uncordon을 따로 해야 했던 이유는 뭘까요?',
      choices: ['"점검 중" 팻말이 아직 걸려 있어서', 'Ready여도 온도를 더 낮춰야 해서', 'drain 때 지운 pod를 다시 만들려고', '옮겨 간 pod를 원래 노드로 되돌리려고'],
      answer: 0,
      explain: 'drain 하면 노드에 "점검 중" 팻말(cordon)이 걸려 새 pod를 막아. Ready로 돌아와도 팻말은 그대로라 uncordon으로 떼야 다시 일을 받아.',
    },
  ],
};

/** Each weekday's quiz, by day (D-5 = 0). D-Day has none. */
export const QUIZZES: Quiz[] = [D5, D4, D3, D2, D1];
