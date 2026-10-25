# 운영 매뉴얼 — D-1 · 점검 · 이중화 (쿠버네티스 · HSRP · 화재 훈련)

수강신청 전날. 오늘은 리허설이라 학생 접속이 하루 종일 1초에 1,500건(1,500 rps: 1초에 들어오는 요청 수) 들어와.
신청 앱은 오늘부터 쿠버네티스(Kubernetes: 서버 여러 대를 대신 돌봐 주는 관리 프로그램)가 노드(일하는 서버) 4대 위에서 돌려. 아침엔 신청 pod가 0개라 사이트가 안 열려. 우리는 "원하는 상태"만 적으면 돼.
VLAN 10(WEB)·40(K8S) 게이트웨이는 아직 CORE-01 혼자 맡고 있어(show standby brief 에 Standby unknown). 오늘 CORE-02를 짝(Standby)으로 세워. D-4에 만든 VLAN 20 게이트웨이는 선배가 그사이 CORE-02 짝을 세워 뒀고, 다른 VLAN(30·50·100)도 이미 짝이 있어.
퇴근 전에 이중화 점검표(HSRP · 업링크 묶음 · 전원 A/B)를 확인해. 터미널은 관제실 관리 PC(책상)에서 열어. 터미널은 관리 PC(ops)에서 시작해.

## 이번 날 목표
1. 관제실 설계 보드에서 신청 서비스(enroll)의 "원하는 상태" 쓰기 (pod 2개 이상, 버전 enroll:v1)
2. 관리 PC 터미널에서 pods 로 신청 pod가 Running인지 확인
3. CORE-02에 VLAN 10·40 게이트웨이 짝 세우고 저장 (자기 주소 .3 · standby 1 ip .1 · priority 100 · preempt · no shutdown → write memory)
4. 냉각이 돌아오면 비웠던 노드를 다시 열기 (uncordon). 랙 온도 장애를 해결한 뒤에 열려.
5. 이중화 점검표: 코어에서 show standby brief · TOR-01에서 show etherchannel summary · 관제 화면 FMS에서 전원 A/B 보기
- 3번을 끝내고 조금 뒤에 첫 장애가, 5번을 끝내면 두 번째 장애가 와.

## 클러스터와 길
- 노드: K8S-01·02 (n1·n2, 2번 랙, TOR-01에 연결) · K8S-03·04 (n3·n4, 3번 랙, TOR-02에 연결). 모두 VLAN 40(K8S), 주소 10.10.40.11~14, 게이트웨이 10.10.40.1.
- 항온항습기(CRAC)는 1·2번 랙을 식혀. 2번 랙에 K8S-01·02가 있어.
- 앱(Deployment): login, course, enroll, notify. 대표 번호(Service): login-svc, course-svc, enroll-svc, notify-svc.
- 신청 pod 하나가 1초에 약 1,000건을 처리해. 노드 하나에 pod는 최대 6개.
- 학생 길: 인터넷 → 방화벽 → 코어 → L4(대표 주소 sugang) → 노드 4대의 30080번 문(NodePort: 어느 노드로 와도 신청 pod로 이어 주는 문) → 신청 pod.
- 네트워크실 1번 랙(net1): BR-01 · FW-01 · CORE-01 · L4-01. 2번 랙(net2): BR-02 · FW-02 · CORE-02 · L4-02. 짝끼리 다른 랙에 있어.
- 랙 스위치마다 코어 두 대로 길이 나 있어: TOR-01 → CORE-01(Po1 묶음, 20G) + CORE-02(Te1/1/3). TOR-02 → CORE-01(Te1/1/1) + CORE-02(Te1/1/3). 평소엔 CORE-01 쪽으로 다니고, CORE-02 쪽은 STP가 막아 둔 예비 길이야.

## 핵심 개념
- Cluster · Node · Pod (비유: 공항 · 활주로 · 비행기) — 클러스터 = 노드들의 묶음, 노드 = 일하는 서버, pod = 앱이 도는 가장 작은 단위(컨테이너를 담은 그릇).
- 원하는 상태 · Self-healing (비유: "3명 유지" 근무표) — 개수와 버전을 적어 두면 쿠버네티스가 실제를 계속 맞춰. pod가 죽으면 사람이 손대기 전에 새 pod(새 이름·새 IP)를 띄워.
- 재스케줄링 · 냉각 (비유: 쓰러진 직원 대신 다른 지점에서 대타) — 노드가 쓰러지면(NotReady) 그 위 pod는 사라지고 살아 있는 노드에 새 pod가 떠. 하지만 더운 방을 식히는 건 사람(시설팀) 몫. 노드는 랙이 45°C를 넘으면 NotReady, 35°C 아래로 내려와야 돌아와.
- cordon · drain (비유: 매장 문에 "점검 중" 팻말) — cordon = 새 pod 금지, drain = 새 pod 금지 + 있던 pod 내보내기(다른 노드에 새로 뜸). 점검이 끝나면 uncordon 으로 팻말을 떼.
- Service (비유: 바뀌지 않는 대표 번호) — pod IP는 바뀌어. Service 이름으로 부르면 살아 있는 pod로 연결돼.
- Rolling update · Rollback (비유: 한 명씩 교대 · 문제 생기면 되돌리기) — 새 버전 pod를 하나씩 바꾸고, 문제가 생기면 이전 버전으로. 그러려면 버전 이름표(태그 :v1, :v2)가 있어야 해.
- HSRP Active · Standby (비유: 대표 전화번호를 두 직원이 이어 받기) — 게이트웨이 .1은 두 코어가 함께 맡는 가상 주소. 우선순위(priority)가 높은 쪽이 Active(CORE-01 110), 낮은 쪽이 Standby(CORE-02 100). Active가 죽으면 Standby가 이어받아(로그 "Standby -> Active"). preempt는 "내 우선순위가 더 높으면 Active를 되찾기"라서, 돌아오는 쪽(CORE-01)에 켜져 있어야 자리를 되찾아(show standby brief 의 P). 짝(CORE-02)에도 똑같이 켜 두면 나중에 우선순위를 바꿔도 같은 규칙으로 움직여. 그룹 번호는 양쪽이 같아야 해(1).
- trunk 와 허용 VLAN — 스위치끼리 잇는 trunk 포트는 실어 나를 VLAN 목록(allowed vlan)을 가져. 목록에 없는 VLAN은 케이블이 멀쩡해도 그 길로 못 가.
- 이중화 점검 vs 장애 조치(Failover) 훈련 (비유: 소방 훈련) — 점검표로 "둘 다 있다"는 볼 수 있지만, "하나가 죽어도 된다"는 실제로 꺼 봐야 알아. 예비로 가는 길 어딘가 설정 하나가 빠지면 그게 숨은 단일 장애점(SPOF)이야.

## 쓸 수 있는 명령어
### 관리 PC (쿠버네티스, kubectl 을 앞에 붙여도 돼)
| 명령 | 뜻 |
|---|---|
| pods (get pods) | pod 목록: NAME, STATUS, RESTARTS, AGE, NODE, VERSION, IP |
| nodes (get nodes) | 노드: Ready/NotReady(,SchedulingDisabled = 점검 중), RACK, TEMP, PODS |
| deploys (get deploy) | 원하는 상태: READY(실제/원하는), IMAGE |
| svcs (get svc) | Service와 연결된 pod IP |
| drain <노드> / cordon <노드> / uncordon <노드> | 노드 비우기 / 새 pod 막기 / 다시 열기 |
| scale <앱> <개수> | 원하는 pod 개수 바꾸기 |
| rollout status/history/undo <앱> | 배포 진행 / 이전 버전 기록 / 되돌리기 |
| set image <앱> <앱:태그> | 다른 버전 배포 (레지스트리에 있는 태그만) |
| logs <pod 이름 또는 앱 이름> | pod 로그 |
| env <앱> / env set <앱> KEY=VALUE | 앱 설정(환경변수) 보기 / 바꾸기 |
| ssh, exit, ping, traceroute, nslookup, curl, help, clear, hint | 공통 |

### 스위치·코어 (IOS: ssh CORE-02, ssh TOR-02 …)
| 명령 | 뜻 |
|---|---|
| show standby brief | HSRP: VLAN마다 우선순위, P(preempt), State(Active/Standby/Init), Active 주소, Standby 주소, 가상 IP |
| show ip interface brief | VLAN 인터페이스(SVI)마다 주소와 up/down |
| show etherchannel summary | 묶음 상태 (P 묶여서 일함 · s 묶음에서 빠져 멈춤(suspended) · D 꺼짐) |
| show interfaces trunk | trunk 포트마다 실어 나르는 VLAN 목록 (Vlans allowed on trunk) |
| show spanning-tree vlan <N> | 그 VLAN의 포트별 FWD(전달)/BLK(차단) |
| show logging | 장비 일기장 (HSRP 전환, 링크 down/up) |
| interface vlan <N> → ip address <주소> 255.255.255.0 → standby 1 ip <가상 주소> → standby 1 priority <값> → standby 1 preempt → no shutdown | 게이트웨이(SVI)와 HSRP 설정 |
| interface <포트> → switchport trunk allowed vlan add <N> | trunk에 VLAN 더하기 (add 없이 쓰면 목록이 통째로 바뀌니 조심) |
| write memory | 저장 |

### 관제 화면
- NMS: 꺼진 장비는 회색. 장비를 누르면 포트·로그. 경보 목록의 확인(ACK).
- SMS: 수강신청, 앱(login/course/enroll/notify) 상태, NotReady 노드.
- FMS: 랙 온도·습도, 항온항습기 상태, 전원 A/B(PDU 전류), UPS. "📞 시설팀 통보" 버튼 = 시설 경보를 확인하고 시설팀에 알림.

## 결과 읽는 법
- pods: Running(초록) 정상, Pending(노랑) 준비 중. NODE `<none>` = 들어갈 노드 자리가 없어 기다림. AGE 몇 초짜리 = 방금 새로 뜬 pod.
- nodes TEMP: 32°C 이상 노랑, 40°C 이상 빨강. Ready,SchedulingDisabled = cordon/drain 된 노드.
- deploys READY `2/3` 노랑 = 아직 원하는 개수에 못 미침. IMAGE `enroll:v1 → enroll:v2` = 배포 중.
- show standby brief (CORE-02, 정상): `Vl10 1 100 P Standby 10.10.10.2 local 10.10.10.1`. Standby가 `unknown`이면 짝이 없음. State `Init` = 그 SVI가 down.
- show interfaces trunk: "Vlans allowed on trunk" 줄에서 포트마다 VLAN 목록. 끊긴(notconnect) 포트는 목록에 안 나와. 필요한 VLAN(노드 포트의 Vlan 칸)이 그 목록에 있는지 확인해.
- logs 의 `ERROR course 호출 실패` = 과목조회 주소 문제, `500 Internal Server Error` = 그 버전 버그, `WARN … pod IP로 직접` = 지금은 되지만 위험.

## 장애 유형별 점검 순서
### A. 랙 온도 급상승 (항온항습기 멈춤 → drain + 시설팀)
증상 예: "서버실 1·2번 랙 쪽이 후끈해요! 온도가 계속 오르고 있어요." · 경보 "랙 온도 급상승 (랙 1·2)" (critical, 폴링이라 조금 늦게 떠. FMS 시설 경보)
1. FMS: 어느 랙이 뜨거운지, 항온항습기 상태. nodes: 그 랙의 노드 TEMP·STATUS.
2. pods 의 NODE·AGE: 뜨거운 노드의 pod가 사라지고 다른 노드에 새 pod가 떴는지(재스케줄링). 보통은 알람을 볼 즈음 노드가 이미 NotReady가 되고, 쿠버네티스가 pod를 옮겨 둔 상태야. 그래도 drain 으로 "점검 중" 팻말을 걸어 둬야 냉각이 불안한 동안 새 pod가 그 노드로 다시 가지 않아.
3. 우리 몫: 뜨거운 랙의 노드마다 drain(새 pod 금지 + 남은 pod 내보내기). 그리고 FMS에서 시설팀 통보 — 냉각은 시설팀 몫.
4. 뜨거운 노드가 모두 비워지고(점검 중) 신청 pod가 다른 노드에서 원하는 개수만큼 Running이면 해결. 시설팀이 항온항습기를 고치고, 온도가 35°C 아래로 내려가면 노드가 Ready로 돌아와. 그때 uncordon 으로 다시 열어(4번 목표).
- 항온항습기를 직접 고치는 건 우리 일이 아니야(시설은 지켜보고 알리기만).

### B. 네트워크실 1번 랙 화재 · 전원 차단 (HSRP 전환 + 숨은 단일 장애점)
증상 예: "네트워크실 1번 랙에서 연기가 나서 자동 소화 설비가 작동했어요! 불은 꺼졌는데 랙 전원이 내려갔대요." · 경보 "CORE-02 HSRP 상태 변경 (Standby → Active)" (critical)
1. NMS: 1번 랙 장비(CORE-01·BR-01·FW-01·L4-01)가 꺼짐. 짝(CORE-02·BR-02·FW-02·L4-02)이 일하는지. CORE-02 show standby brief → 모든 VLAN Active 인지(오늘 세운 짝 덕분).
2. nodes / SMS: 그런데 일부 노드(TOR-02 쪽)가 NotReady. 관리 PC에서 그 노드로 ping 도 안 가. 같은 VLAN인데 TOR-01 쪽 노드는 멀쩡해.
3. 끊긴 노드들이 꽂힌 스위치(TOR-02)에서 show interfaces trunk → 살아남은 코어(CORE-02)로 가는 업링크가 그 노드들의 VLAN(K8S)을 실어 나르는지. 같은 스위치의 show interfaces status 에서 끊긴 노드 포트의 Vlan 칸(그 노드들의 VLAN)을 보고, trunk 의 "Vlans allowed on trunk" 목록에 그 번호가 있는지 비교해.
4. 해결 방향: 그 업링크 포트의 허용 VLAN 목록에 빠진 VLAN을 더하기(add — 그냥 쓰면 다른 VLAN이 지워져). 저장. 노드가 Ready로 돌아오고 신청이 정상이면 해결. 그 뒤 시설팀이 1번 랙 전원을 되살리고, CORE-01이 preempt 로 Active를 되찾아.
- 교훈: 짝 장비가 있어도 그 짝까지 가는 길이 끝까지 이어져야 이중화. 꺼 봐야 안다.

### C. 신청 에러 급증 — 새 버전 배포 중 (Rollback)
증상 예: "신청 버튼을 누르면 500 에러가 뜬다는 제보가 들어오기 시작했어요!" · 경보 "수강신청 HTTP 500 응답 증가"
1. rollout status / deploys / pods 의 VERSION → 새 버전 pod가 늘어날수록 에러.
2. 새 버전 pod의 logs → 500 에러.
3. rollout history 로 이전 버전 확인 → 되돌리기(rollout undo, 또는 예전 버전으로 set image). 배포 도중이어도 돼.

### D. 과목조회 재배포 후 신청 전부 실패 (pod IP를 박아 둔 설정)
증상 예: "과목조회 pod들이 재배포된 직후부터 신청이 전부 실패해요!" · 경보 "수강신청 응답 실패율 증가"
1. 신청 pod logs → 과목조회 호출 실패, 주소가 보여.
2. env enroll → 과목조회 주소가 pod IP(숫자)로 적혀 있는지.
3. svcs 로 대표 번호 확인 → 바뀌지 않는 이름으로 부르게 설정 바꾸기. (이름만, 이름:8000, http://이름 어느 모양이든 돼. 지금 살아 있는 pod IP를 넣으면 당장은 되지만 장애는 안 닫혀)

### E. 목표가 안 넘어감
- 원하는 상태: 설계 보드에서 버전(enroll:v1)과 2개 이상. :latest 는 거절돼.
- pods 확인: pods 를 한 번 치고, 신청 pod 2개 이상이 Running이면 완료.
- 게이트웨이 짝: CORE-02의 interface vlan 10, interface vlan 40 각각 주소 10.10.N.3/24, standby 1 ip 10.10.N.1, priority 는 CORE-01(110)보다 낮게(100), preempt, no shutdown, 그리고 write memory. show standby brief 에서 Standby/local 로 보여야 해. priority 를 CORE-01보다 높게 주면 CORE-02가 Active를 뺏어가서 인정 안 돼.
- 노드 다시 열기: 노드가 Ready(온도 35°C 아래)이고 cordon 이 풀려야 완료.
- 점검표: 코어 둘 중 하나에서 show standby brief, TOR-01에서 show etherchannel summary, 관제 화면 FMS 탭 열기.

## 힌트 줄 때 참고
- 노드 이름을 붙인 완성 명령(drain n1 같은, "n1, n2를 drain"도), 포트 이름, VLAN 번호("40번 VLAN"처럼 앞에 써도, K8S VLAN 같은 이름으로도), IP, 완성 IOS 명령(switchport trunk allowed vlan add …, standby …)은 말하지 마. "그 랙의 노드 상태를 봐", "살아남은 코어로 가는 길을 따라가 봐", "trunk가 실어 나르는 목록을 비교해봐" 정도로.
- 원하는 상태 vs 실제 상태, "둘 있다" vs "하나가 죽어도 된다"를 비교하게 하는 질문이 좋은 힌트야.
- 시설(냉각·전원)은 시설팀 몫이라는 걸 잊지 않게 해줘. 우리는 일을 옮기고, 알리고, 지켜봐.
- 플레이어는 서버를 처음 접하는 일반인이야. 노드, pod, drain, HSRP, trunk, failover 같은 말은 처음 쓸 때 쉬운 말로 한 번 풀어줘.
