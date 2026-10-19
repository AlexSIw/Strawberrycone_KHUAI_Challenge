# 운영 매뉴얼 — Stage 6 · 자동으로 버티는 데이터센터 (Kubernetes 개념)

노드 4대, 컨테이너 수십 개. 사람이 손으로 관리하는 건 불가능해서 "항공 관제사" 쿠버네티스를 들였어.
우리는 "원하는 상태"만 적고, 쿠버네티스가 실제 상태를 계속 맞춰.

## 이번 단계 목표
1. 관제실 설계 보드에서 신청 서비스(enroll)의 "원하는 상태" 작성 (몇 개를, 어떤 버전으로)
2. 관리 PC 터미널에서 pods 로 pod가 뜬 것 확인
3. 그다음 장애가 연달아 와.

## 클러스터 구성
- 노드(일하는 서버) n1~n4, 각각 rack1~rack4 에 있어. 항온항습기(CRAC)는 rack1·rack2 만 식혀.
- 앱(Deployment): login, course, enroll, notify. 각 앱의 대표 번호(Service): login-svc, course-svc, enroll-svc, notify-svc.
- 신청 pod 하나가 대략 1000 rps 를 처리해. 노드 하나에 pod 는 최대 6개까지.

## 핵심 개념
- Cluster · Node · Pod — 클러스터 = 노드들의 묶음, 노드 = 일하는 서버, pod = 가장 작은 실행 단위(컨테이너를 담은 그릇).
- 원하는 상태 · Self-healing (비유: "3명 유지" 근무표) — 원하는 개수와 버전을 적어두면 쿠버네티스가 실제를 계속 맞춰. pod 가 죽으면 사람이 손대기 전에 새로 띄워.
- Service (비유: 바뀌지 않는 대표 번호) — pod 는 언젠가 죽고 새로 태어나면 IP 가 바뀌어. Service 이름으로 부르면 살아 있는 pod 로 알아서 연결돼. (Stage 2에서 숫자 대신 이름(DNS)으로 찾던 것과 같은 원리)
- 재스케줄링 · 냉각 (비유: 쓰러진 직원 대신 다른 지점에 대타 투입) — 노드가 죽으면 그 위의 pod 는 사라지고, 살아 있는 노드에 새 pod(새 이름·새 IP)를 띄워. pod 를 "옮기는" 게 아니야. 하지만 더운 방을 식히는 건 사람 몫이야.
- Scale-out (비유: 숫자만 바꾸면 직원이 늘어나는 매장) — 원하는 개수만 바꾸면 몇 초 만에 늘어나. Stage 4에서 손으로 깔던 것과 비교해봐.
- Rolling update · Rollback (비유: 한 명씩 교대 · 문제 생기면 되돌리기) — 새 버전 pod 를 하나 띄우고, 그 pod 가 Running(준비 완료)이 된 뒤에야 옛 pod 하나를 내려. 그래서 개수가 줄지 않고, 버그 있는 버전도 한 개씩 퍼져. 문제가 생기면 이전 버전으로 돌아가. 버전 태그(:v1, :v2)가 있어야 가능해. :latest 금지.

## 쓸 수 있는 명령어 (kubectl 을 앞에 붙여도 돼)
| 명령 | 뜻 |
|---|---|
| pods (get pods, get pod) | pod 목록: NAME, STATUS, RESTARTS, AGE(태어난 지 얼마나), NODE, VERSION, IP |
| nodes (get nodes, get node) | 노드 상태: Ready/NotReady, RACK, TEMP(온도), PODS 개수(그 노드에 실제로 놓인 pod) |
| deploys (get deploy, get deployment) | 원하는 상태 목록: READY(실제/원하는 개수), UP-TO-DATE, IMAGE(배포 중이면 이전 → 새 버전) |
| svcs (get svc, get service) | Service 목록과 연결된 pod IP들 |
| scale <앱> <개수> | 원하는 pod 개수 바꾸기 |
| rollout status <앱> / rollout history <앱> | 배포 진행 상황 / 이전 버전 기록 |
| rollout undo <앱> | 이전 버전으로 되돌리기 |
| set image <앱> <앱:태그> | 다른 버전 배포 (rolling update). 레지스트리에 있는 태그만 돼 (없는 태그는 ErrImagePull 로 거절) |
| logs <pod 이름> | pod 로그 (에러 메시지). `logs deploy/<앱>` 처럼 앱 이름으로도 돼 |
| env <앱> / env set <앱> KEY=VALUE | 앱 환경변수(설정) 보기 / 바꾸기 |
| ssh, exit, hostname, help, clear, hint | 공통 (ping 은 이 단계에선 안 써. 노드 상태는 nodes 로 봐) |

- 진짜 kubectl 모양도 받아: `scale deployment <앱> --replicas=N`, `rollout undo deployment <앱>`, `set image deployment/<앱> <앱>=<앱:태그>`, `set env deployment/<앱> KEY=VALUE`.
- 배포 중에 `set image` 로 다른 버전(예전 버전 포함)을 주면 진행 중인 배포의 목표가 그 버전으로 바뀌어. 이미 그 버전이면 "바뀐 것 없음"이라고 알려줘.

## 결과 읽는 법
- pods STATUS: Running(초록) 정상, Pending(노랑) 아직 준비 안 됨. Pending 인데 NODE 가 `<none>` 이면 들어갈 노드 자리가 없어서 기다리는 중(목록 아래에 "0/4 nodes are available" 설명이 붙어).
- AGE: 다른 pod 들은 몇 시간(h)인데 몇 초(s)짜리가 있으면 방금 새로 태어난 pod 야. 이름도 처음 보는 이름이고 IP 도 새것.
- RESTARTS: 같은 pod 안에서 컨테이너가 다시 켜진 횟수. 이 단계 장애에선 pod 가 통째로 새로 태어나니까 0 부터 시작해.
- nodes TEMP: 32°C 이상 노랑, 40°C 이상 빨강. 45°C 를 넘으면 NotReady 가 되고, 35°C 아래로 내려와야 돌아와.
- deploys READY 가 `2/3` 처럼 노랑이면 아직 원하는 개수에 못 미친 것.
- svcs 에서 `(연결된 pod 없음)` 이면 그 대표 번호로 걸어도 받을 사람이 없어.

## 장애 유형별 점검 순서
### A. pod 하나가 죽음 (Self-healing 관찰)
1. `pods` 로 지금 목록을 봐. 정말 죽어 있어?
2. 원하는 상태의 개수(`deploys` 의 READY 오른쪽 숫자)와 실제 Running 개수를 비교.
3. AGE 가 몇 초뿐인 새 이름의 pod 가 이미 떠 있다면? 쿠버네티스가 먼저 맞춰 놓은 거야. 이 장애의 교훈은 "관찰"이야.
- 고칠 건 없어. pods / deploys / svcs / 신청 pod logs / 대시보드 중 아무거나로 확인하면 해결돼. 아무것도 안 봐도 잠시 뒤 저절로 닫혀(그게 self-healing).
- 장애 알림의 "죽었다"는 증상이야. 원인은 일부러 안 알려줘.

### B. 재배포 직후 신청 전부 실패 (IP 를 박아둔 설정)
1. 신청 pod 하나의 `logs` → 누구에게 연락하다 실패하는지 (course 호출 실패, 주소가 보여).
2. `env` 로 신청 앱 설정을 봐. 과목조회를 부르는 주소가 pod IP(숫자)로 적혀 있는지.
3. `svcs` 로 대표 번호 목록을 확인. 바뀌는 IP 대신 바뀌지 않는 이름으로 부르게 설정을 바꾸는 방향.
- 주소는 이름만, `이름:8000`, `http://이름` 어느 모양이든 돼 (포트를 안 쓰면 앱이 8000 을 붙여). 다른 포트(예: :80)는 logs 에 "refused".
- 다른 앱의 Service 를 넣으면 logs 에 404 와 "이 Service는 '<앱>' 앱 pod들로 연결돼요"가 떠.
- 지금 살아 있는 과목조회 pod 의 IP 를 넣으면 당장은 되지만 장애는 안 닫혀. 대시보드에 "pod 하나의 IP로 직접 연결 중" 메모가 뜨고 logs 에 WARN 이 떠. 그 pod 가 바뀌면 또 끊기니까 대표 번호로 바꾸게 이끌어.

### C. 랙 온도 급상승 (항온항습기 고장)
1. 대시보드 온도 그래프와 `nodes` → 어느 랙의 노드가 뜨겁고 NotReady 인지.
2. `pods` 의 NODE·AGE 칸 → 아픈 노드에 있던 pod 들은 사라지고, 살아 있는 노드에 새 이름의 pod 가 떴는지(재스케줄링).
3. 근본 원인은 냉각. 쿠버네티스는 방을 식혀주지 못해 → 냉각실 항온항습기로 직접 가서 손봐야 해 (E, 수리 미니게임).
- 해결 조건: 항온항습기가 고쳐지고, 항온항습기가 식히는 랙(rack1·rack2)의 노드가 Ready 로 돌아오면 끝.

### D. 접속자 급증 (Scale-out)
1. 대시보드: 접속자(rps) 대비 처리량, "신청 pod 부족" 메모.
2. 필요한 pod 수 = 접속자 ÷ pod 하나 처리량(약 1000). 지금 Running 인 신청 pod 수와 비교.
3. 원하는 개수만 바꾸면 돼. 노드 자리가 모자라면 새 pod 가 Pending(NODE `<none>`)에 머물러.

### E. 신청 에러 급증 — 새 버전 배포 중 (Rollback)
1. 에러가 언제부터? `rollout status` 와 `pods` 의 VERSION 칸 → 새 버전 pod 가 늘어날수록 에러가 늘어? (새 pod 가 준비될 때마다 옛 pod 하나씩 교체돼서, 10개면 20초쯤 걸려)
2. 새 버전 pod 의 `logs` → 500 에러.
3. 고칠 때까지 학생을 기다리게 할 순 없어. 이전 버전 기록(`rollout history`)이 있으니 되돌리는 방향. 되돌리기 명령도, 예전 버전으로 다시 배포하는 것도 다 정답이야(배포 도중이어도 돼).

## 힌트 줄 때 참고
- 앱 이름과 숫자를 붙인 완성 명령, 정확한 설정 값(KEY=VALUE)은 말하지 마. B 장애에서는 넣어야 할 Service 이름 자체도 말하지 말고 "Service 목록을 봐"까지만.
- "원하는 상태 vs 실제 상태"를 비교하게 하는 질문이 가장 좋은 힌트야.
