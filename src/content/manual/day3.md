# 운영 매뉴얼 — D-2 · 컨테이너 · 링크 (Docker · LACP · STP)

수강신청까지 2일. 베타 서비스는 오전 점검 공지를 걸어 둬서 처음엔 학생 접속이 없어(0 rps: 1초에 들어오는 요청 수 0).
2차 신청 대비로 앱 서버를 늘리려고 선배가 APP-01(이름 srv-new)에 신청 앱을 손으로 설치했는데, 서버마다 프로그램 버전이 달라서 실패했어. L4는 이미 APP-01의 80번 포트를 보고 있어(헬스체크 http /health).
오늘은 앱과 실행 환경을 통째로 포장하는 컨테이너(Docker)로 APP-01에 앱을 띄우고, DB-02(이름 srv-db)의 DB 데이터를 볼륨에 옮겨.
앱이 뜨면 오후에 모의 부하 테스트(1초에 8,000건, 8,000 rps)가 시작되고 퇴근 때까지 계속 돌아. 선배가 어제 TOR-01 → CORE-01 케이블을 한 줄 더 깔아 뒀어(아직 묶지는 않았어).
터미널은 관제실 관리 PC(책상)에서 열어. 터미널은 관리 PC(ops)에서 시작해.

## 이번 날 목표
1. APP-01에 접속해 실패한 설치 기록 보기 (ssh srv-new → deploy log)
2. 관제실 설계 보드에서 Dockerfile(레시피 카드) 완성
3. 관리 PC에서 이미지 만들기(docker build) → 레지스트리에 올리기(docker push)
4. APP-01에서 컨테이너 실행해 학생 요청이 들어오게 하기 (L4가 APP-01을 UP으로 볼 때 완료)
5. DB-02의 DB 컨테이너를 볼륨(사물함)에 데이터를 두도록 다시 만들기
6. TOR-01·CORE-01 업링크 묶음(Po1) 확인하고 두 장비 설정 저장 (show etherchannel summary · write memory). 부하 테스트 장애를 해결한 뒤에 열려.
- 부하 테스트는 5번을 끝내고 조금 뒤에 시작돼. 6번을 끝내면 또 다른 장애가 와.

## 장비와 길
- ops: 관리 PC. 이미지 빌드·push 는 여기서. 컨테이너는 없어. 컨테이너 명령(ps/logs/rm…)은 서버에 ssh 로 접속해서 써.
- srv-new = APP-01 (10.10.10.13, 2번 랙, TOR-01 Gi1/0/4): 신청 앱 컨테이너를 띄울 서버. Python 3.9.
- srv-db = DB-02 (10.10.20.12, 2번 랙, TOR-01 Gi1/0/5): DB(MySQL: 널리 쓰는 데이터베이스 프로그램) 컨테이너 db 가 도는 서버. 지금은 데이터가 컨테이너 안에만 있어(볼륨 없음).
- 신청 앱은 DB를 srv-db 의 3306번 포트로 찾아가. 컨테이너 이름은 상관없어.
- 비교용: WEB-01(web)은 Python 3.12. 신청 앱은 3.11 이상이 필요해.
- 학생 길: 인터넷 → 방화벽 → CORE-01 → L4-01(대표 주소 sugang) → CORE-01 → TOR-01 → APP-01:80 → 컨테이너 안 8000.
- TOR-01 → 코어 케이블: Te1/1/1 ↔ CORE-01 Te1/0/3, Te1/1/2 ↔ CORE-01 Te1/0/4(어제 선배가 깐 두 번째 줄), Te1/1/3 ↔ CORE-02 Te1/0/3. 각각 10G.
- VLAN 50(INFRA)에는 DNS 서버(ns1·ns2)와 DHCP 서버(dhcp01)가 있고, TOR-01·TOR-02 둘 다 VLAN 50을 실어 날라.

## 핵심 개념
- 서버마다 설치 상태가 달라짐 — 손으로 깔다 보면 프로그램 버전이 조금씩 달라져서 "내 컴퓨터에선 되는데" 문제가 생겨.
- 컨테이너 · 이미지 (비유: 밀키트 원본(이미지)과 그걸로 만든 한 끼(컨테이너)) — 앱과 필요한 실행 환경을 묶어서 어느 서버에서나 똑같이 실행. VM(가상 머신)은 컴퓨터 통째(운영체제 포함)를 흉내 내서 무겁고, 컨테이너는 가벼워.
- Dockerfile (비유: 레시피 카드) — FROM(밑바탕 환경) · WORKDIR · COPY · RUN · EXPOSE · CMD 순서로 적은 카드. 설계 보드의 카드가 docker build 에 그대로 찍혀.
- 레지스트리 · 태그 (비유: 마트 냉동고 · 버전 이름표) — 만든 이미지를 올려두는(push) 곳. 서버는 여기서 꺼내(pull) 써. enroll:1.0 의 1.0 이 태그. 태그가 있어야 문제가 생겼을 때 예전 버전으로 되돌릴 수 있어(rollback).
- 포트 매핑 -p 바깥:안쪽 (비유: 길가 문 → 주방 창구) — 컨테이너는 잠긴 방. 서버의 바깥 포트와, 앱이 컨테이너 안에서 실제로 기다리는 포트(신청 앱은 8000)를 이어야 손님이 들어와. 안쪽 번호가 틀리면 L4의 "살아 있니?"에도 대답을 못 해. EXPOSE 는 메모일 뿐. 서버의 포트 하나는 프로그램 하나만 쓸 수 있어.
- 볼륨 -v 이름:/폴더 (비유: 식당 전용 사물함) — 컨테이너 안에 쓴 데이터는 그 컨테이너를 지우면 함께 사라져. 재시작·stop/start 는 같은 컨테이너라 그대로야. 프로그램이 데이터를 쓰는 폴더(DB 로그의 data dir)에 볼륨을 붙여야 남아. 비어 있는 새 볼륨에는 어젯밤 백업이 복원돼.
- 업링크 · 오버서브스크립션 (비유: 골목 여러 개가 모이는 큰길 하나) — 랙 서버들의 트래픽은 랙 스위치(TOR)의 위쪽 길(업링크)로 모여. 큰길이 좁으면 서버가 한가해도 길에서 막혀. 관제 화면(NMS) 선 색과 사용률로 봐. 1 rps ≈ 1.6 Mbps라서 8,000 rps ≈ 12.8 Gbps.
- STP · 루프 (비유: 회전교차로에 차단봉 하나) — 스위치 사이 길이 고리(루프)를 이루면 방송이 끝없이 돌아. STP(Spanning Tree)가 고리마다 포트 하나를 막아(BLK). 그래서 케이블이 두 줄이어도 묶지 않으면 STP가 한 줄을 막고 한 줄만 일해.
- LACP · 포트 묶음 (비유: 두 차선을 한 도로로) — 케이블 여러 줄을 논리 링크 하나(Port-channel, Po1)로 묶어. 장비는 한 줄로 보니까 STP가 막을 고리가 없고, 폭이 합쳐져(10G + 10G = 20G). 양쪽 장비에 똑같이 묶어야 해(보통 양쪽 다 active: LACP로 서로 확인. 양쪽 다 passive면 아무도 먼저 말을 안 걸어서 안 묶여). 한쪽만 묶으면 멤버가 묶음에서 빠져 멈춰(s, suspended).
- 브로드캐스트 스톰 — STP가 꺼진 고리에서 방송이 무한히 불어나 그 VLAN이 지나는 모든 링크가 꽉 차. 그 VLAN에 있는 서비스(DNS·DHCP)는 먹통, 다른 서비스도 느려져. 스위치 일기장에 같은 MAC 주소가 두 포트 사이를 오간다는 MACFLAP 경고가 반복돼. 고리 양 끝 중 한쪽이라도 STP를 켜면 끊겨.
- bpduguard — 서버용 포트에 스위치 신호(BPDU)가 들어오면 포트를 막아(err-disabled). STP가 꺼져 있으면 BPDU도 안 나가서 이 안전장치도 눈이 멀어.

## 쓸 수 있는 명령어
### 관리 PC·서버 (리눅스)
| 명령 | 뜻 |
|---|---|
| deploy log | (그 서버에서) 손으로 한 배포(설치·실행) 기록 |
| python --version | 그 서버의 Python(앱을 만든 프로그래밍 언어) 버전 |
| docker build -t <이미지:태그> . | Dockerfile 로 이미지 만들기. 관리 PC에서만. 이미지 이름은 레시피 이름(enroll)과 같아야 해 |
| docker push <이미지:태그> / docker pull <이미지:태그> | 레지스트리에 올리기 / 받아오기 |
| docker images | 이 장비에 있는 이미지(태그) 목록 |
| docker run [-p 바깥:안쪽] [-v 볼륨:/폴더] [--name 이름] [-d] <이미지> | 컨테이너 실행 (서버에 접속해서). 옵션은 이미지 이름 앞에 |
| docker ps [-a] | 컨테이너: IMAGE, STATUS, PORTS, VOLUME, NAME |
| docker stop/start/restart <이름> | 멈추기 / 다시 켜기 / 껐다 켜기 (데이터 그대로) |
| docker rm [-f] <이름> | 컨테이너 지우기 (안에 있던 데이터도 사라짐) |
| docker logs <이름> | 컨테이너 로그 |
| docker volume create <이름> / docker volume ls | 볼륨 만들기 / 목록 |
| curl [-v] http://sugang/enroll | 학생처럼 L4를 거쳐 요청 |
| ssh, exit, ping, traceroute, nslookup, ip addr, hostname, help, clear, hint | 공통 |

### L4 (ssh L4-01)
| 명령 | 뜻 |
|---|---|
| lb pool / lb health / lb status | 풀 멤버와 UP/DOWN · 헬스체크 설정 · 세션 수 |

### 스위치 (IOS: ssh TOR-01, ssh CORE-01 …)
| 명령 | 뜻 |
|---|---|
| show interfaces <포트> | 포트 상세: txload(사용률, 255가 꽉 참), BW(폭) |
| show interfaces status | 포트 상태 한눈에 |
| show spanning-tree [vlan N] | STP 상태: 포트마다 Role(Root/Desg/Altn)과 Sts(FWD 전달 / BLK 차단). 그 VLAN의 STP가 꺼져 있으면 "does not exist" |
| show etherchannel summary | 묶음 상태: Po1(SU) = 쓰는 중, 멤버 (P) 묶여서 일함 · (s) 묶음에서 빠져 멈춤(suspended: 상대가 같이 안 묶어 줌) · (D) 꺼짐 |
| show logging | 장비 일기장 (MACFLAP, 설정 변경, 묶음 들어감/빠짐 EC-5-BUNDLE/UNBUNDLE) |
| interface <포트> / interface range <포트> - <끝 번호> | (설정 모드) 포트 하나 / 여러 개를 한 번에 설정 |
| channel-group <번호> mode active | (포트 설정 모드) 이 포트를 묶음 <번호>에 넣기 (LACP). 묶음 인터페이스 Po<번호>가 만들어져 |
| [no] spanning-tree vlan <N> | (설정 모드) 그 VLAN의 STP 켜기 / 끄기 |
| shutdown / no shutdown | 포트 끄기 / 켜기 |
| write memory | 저장 |

### 관제 화면 · 설계 보드
- NMS: 선 색 = 사용률(초록 → 노랑 → 빨강). 장비를 누르면 포트·로그. 경보 목록의 확인(ACK).
- SMS: 수강신청, APP-01 신청 앱, DB-02, 캠퍼스 인터넷, KHU 서비스 상태.
- 설계 보드(E): Dockerfile 카드 6장을 순서대로.

## 결과 읽는 법
- deploy log: Python 버전이 맞지 않는다는 ERROR, 모듈을 못 찾는다는 에러 → 서버 환경 차이.
- docker run 끝의 `(바깥 N번 → 컨테이너 안 M번)`, `(볼륨 X → 컨테이너 안 /폴더)` = 방금 이은 것. 맞는지는 알려주지 않아. docker logs 의 "Running on http://0.0.0.0:8000"(앱이 기다리는 번호), DB 로그의 data dir 과 비교해.
- docker ps PORTS: `0.0.0.0:<바깥>-><안쪽>`. `(없음)`이면 밖에서 못 들어와. VOLUME `-` 이면 데이터가 컨테이너 안에만 있음.
- "port is already allocated" → 그 바깥 포트를 이미 다른 컨테이너가 씀. "Conflict … name is already in use" → 같은 이름 컨테이너가 있음(멈춘 것 포함).
- docker logs 의 `ERROR … 500 Internal Server Error` → 그 이미지(버전)에 버그.
- lb pool 에서 APP-01 DOWN → 80번에서 아무도 제대로 대답 못 함(컨테이너 없음, -p 없음, 안쪽 번호 틀림).
- show spanning-tree vlan 10 (TOR-01): Te1/1/2 Altn BLK = 두 번째 케이블이 고리 방지로 막힌 상태.
- show interfaces te1/1/1: txload 255/255 근처(빨강)면 그 길이 꽉 참.
- show etherchannel summary: `Po1(SU) LACP Te1/1/1(P) Te1/1/2(P)` 이면 정상. (s)는 반대편이 안 묶음, (D)는 꺼짐.
- MACFLAP 줄: `Host … in vlan 50 is flapping between port A and port B` → VLAN 50에 고리.

## 장애 유형별 점검 순서
### A. 부하 테스트 중 수강신청 느림 (업링크 포화 → LACP)
증상 예: "모의 부하 테스트를 시작했더니 수강신청 페이지가 엄청 느려졌어요! 그런데 APP-01 서버는 한가하대요." · 경보 "TOR-01 업링크 사용률 100% (포화)" (major, 폴링이라 조금 늦게 떠)
1. NMS 지도에서 빨간 선 찾기 → TOR-01 ↔ CORE-01 한 줄만 빨갛고, 옆의 다른 줄은 놀고 있어.
2. TOR-01에서 show spanning-tree vlan 10 → 두 번째 케이블 포트가 BLK. 케이블은 두 개인데 하나만 일하는 이유: 묶지 않은 두 줄은 고리라서 STP가 하나를 막아.
3. 해결 방향: 두 줄을 LACP로 묶기. TOR-01의 두 포트와 CORE-01의 두 포트에 같은 묶음 번호를 줘. 한쪽만 하면 멤버가 (s)로 빠지고 길이 CORE-02 쪽으로 돌아가서 여전히 느려.
4. show etherchannel summary 로 Po1(SU), 멤버 (P) 확인 → 사용률이 반으로(20G). 저장(write memory)도 양쪽에.
- STP를 끄거나 막힌 포트를 억지로 여는 건 답이 아니야(고리 → 스톰).

### B. 이름 찾기·캠퍼스 인터넷 먹통, 불빛 폭주 (루프 · 브로드캐스트 스톰)
증상 예: "갑자기 사이트 이름으로 접속이 안 되고, 캠퍼스 건물들 인터넷도 끊겼대요! 스위치 불빛이 전부 미친 듯이 깜빡여요." · 경보 "TOR-01 MAC 주소 이동 경고 반복 (MACFLAP)" (critical)
1. NMS: 여러 링크가 한꺼번에 빨강. 한 장비 문제가 아니야.
2. TOR-01/TOR-02 show logging → MACFLAP 줄에 VLAN 번호와 오가는 두 포트가 나와. 그 시각 근처 "Configured from console" = 누가 설정을 바꿈.
3. show spanning-tree vlan <그 VLAN> → "does not exist" 면 STP가 꺼진 거야. show interfaces status 로 원래 비어 있던 포트가 connected 인지도 봐(엉뚱한 케이블).
4. 해결 방향: 그 VLAN의 STP를 다시 켜기(설정 모드, VLAN별). 한쪽만 켜도 고리는 끊겨(반대편 포트가 bpduguard로 막히기도 해). 저장.
- 문제 포트만 꺼도 스톰은 멈추지만, STP가 꺼진 채면 다음 고리에 또 당해. 장애는 STP가 돌아와야 끝나.

### C. 컨테이너는 Up 인데 L4가 DOWN (포트 매핑)
증상 예: "새로 띄운 신청 앱 컨테이너는 실행 중(Up)이라는데… L4가 APP-01을 계속 DOWN으로 봐요." (warning, 실수했을 때만 생겨)
1. srv-new 에서 docker ps → PORTS 칸이 비었는지, 안쪽 번호가 뭔지.
2. docker logs 로 앱이 안에서 기다리는 번호 확인 → PORTS 의 안쪽 번호와 비교. 학생은 웹 기본 포트(80)로 와.
3. 이미 뜬 컨테이너는 포트를 못 바꿔서, 지우고 바깥 문과 안쪽 창구를 이어 다시 실행.

### D. 새 버전 배포 후 500 에러 (이미지 되돌리기)
증상 예: "방금 전까지 멀쩡했는데, 신청 버튼을 누르면 500 에러가 뜬대요!" · 경보 "APP-01 HTTP 500 응답 급증"
1. srv-new 에서 docker ps → IMAGE 태그가 아침과 다른지(동료가 새 버전으로 바꿈). CONTAINER ID도 새것.
2. docker logs → 500 에러. 그 버전에 버그.
3. 해결 방향: 아침에 쓰던 태그로 되돌리기(rollback). 컨테이너를 지우고 예전 태그로 같은 옵션(-p)까지 붙여 다시 실행. docker images 로 있는 태그 확인.

### E. DB 업데이트 후 신청 내역 0건 (볼륨 안 붙인 새 컨테이너)
증상 예: "DB 자동 업데이트가 끝났는데… 수강신청 내역이 전부 0건으로 보여요!"
1. srv-db 에서 docker ps → CONTAINER ID가 새것이고 VOLUME 이 `-`.
2. docker logs db → data dir 이 "(컨테이너 안 …)". docker volume ls → 아침의 볼륨은 그대로 있어(데이터 안전).
3. 해결 방향: 옛 컨테이너를 지우고, 그 볼륨을 data dir 폴더에 붙여 다시 실행(포트 3306도). 재시작으로는 안 돼.

### F. TOR-01 업링크 묶음 일부 빠짐 (서비스는 살아 있음)
증상 예: "관제 화면에 TOR-01 업링크 경보가 떴어요. 수강신청은 일단 열리는데…" · 경보 "TOR-01 업링크 묶음 멤버 이탈 (EC-5-UNBUNDLE)" (major)
1. TOR-01·CORE-01 show etherchannel summary → 빠진 멤버의 글자: (D) 꺼짐, (s) 반대편이 안 묶음.
2. show logging → 누가 설정을 바꿨는지(Configured from console), 어느 포트가 down/unbundle 됐는지.
3. 해결 방향: (D)면 그 포트를 다시 켜고, (s)면 반대편 장비의 짝 포트도 그 장비의 묶음에 다시 넣어. 저장.
- 지금은 폭이 반(10G). 부하 테스트 중이면 느려지고, 다음 고장엔 예비가 없어.

### G. 목표가 안 넘어감
- 설치 기록: srv-new 에서 deploy log (관리 PC에서 치면 기록이 없다고 나와).
- 이미지: 레시피 → 관리 PC에서 build → push. 레지스트리에 enroll:<태그>가 있어야 완료.
- 컨테이너: lb pool 에서 APP-01 UP 이어야 완료(-p 80:<앱 포트>).
- 볼륨: srv-db 에서 3306 포트가 열린 MySQL 컨테이너가 data dir 에 볼륨을 붙이고, 신청 내역이 있어야 완료.
- 묶음 확인: TOR-01 ↔ CORE-01 묶음(Po)에 케이블 두 줄이 다 (P) 로 묶여 있고, TOR-01·CORE-01 둘 다 저장(write memory)하고, show etherchannel summary 를 한 번 봐야 완료. 묶음 번호는 장비마다 따로 붙어서, 양쪽 번호가 달라도 돼.

## 힌트 줄 때 참고
- 포트 숫자(쌍이든 안쪽 번호 하나든), 볼륨 옵션(볼륨:폴더)·볼륨 이름·data dir 경로, 태그 이름, 포트 이름(Te1/1/2 같은), VLAN 번호("50번 VLAN"처럼 앞에 써도, INFRA 같은 이름으로도), 완성 IOS 명령(channel-group …, spanning-tree vlan …)은 말하지 마. "PORTS/VOLUME 칸을 봐", "로그가 말하는 번호와 비교해봐", "선 색을 봐", "STP 상태를 봐" 정도로.
- 밀키트 → 냉동고 → 한 끼, 사물함, 큰길·차선, 회전교차로 비유를 이어가.
- 플레이어는 서버를 처음 접하는 일반인이야. 컨테이너, 이미지, 레지스트리, 볼륨, 업링크, STP, LACP, rps 같은 말은 처음 쓸 때 쉬운 말로 한 번 풀어줘.
