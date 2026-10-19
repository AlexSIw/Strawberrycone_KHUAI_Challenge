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
- Service (비유: 바뀌지 않는 대표 번호) — pod 는 언젠가 죽고 새로 태어나면 IP 가 바뀌어. Service 이름으로 부르면 살아 있는 pod 로 알아서 연결돼. (Stage 2의 "IP 박아두지 마라"와 같은 교훈)
- 재스케줄링 · 냉각 (비유: 항공 관제사가 다른 활주로로 안내) — 노드가 죽으면 pod 를 살아 있는 노드로 옮겨. 하지만 더운 방을 식히는 건 사람 몫이야.
- Scale-out (비유: 숫자만 바꾸면 직원이 늘어나는 매장) — 원하는 개수만 바꾸면 몇 초 만에 늘어나. Stage 4에서 손으로 깔던 것과 비교해봐.
- Rolling update · Rollback (비유: 한 명씩 교대 · 문제 생기면 되돌리기) — 새 버전을 하나씩 교체하고, 문제가 생기면 이전 버전으로 돌아가. 버전 태그(:v1, :v2)가 있어야 가능해. :latest 금지.

## 쓸 수 있는 명령어 (kubectl 을 앞에 붙여도 돼)
| 명령 | 뜻 |
|---|---|
| pods (get pods) | pod 목록: NAME, STATUS, RESTARTS, NODE, VERSION, IP |
| nodes (get nodes) | 노드 상태: Ready/NotReady, RACK, TEMP(온도), PODS 개수 |
| deploys (get deploy) | 원하는 상태 목록: READY(실제/원하는 개수), UP-TO-DATE, IMAGE(배포 중이면 이전 → 새 버전) |
| svcs (get svc) | Service 목록과 연결된 pod IP들 |
| scale <앱> <개수> | 원하는 pod 개수 바꾸기 |
| rollout status <앱> / rollout history <앱> | 배포 진행 상황 / 이전 버전 기록 |
| rollout undo <앱> | 이전 버전으로 되돌리기 |
| set image <앱> <이미지:태그> | 새 버전 배포 (rolling update) |
| logs <pod 이름> | pod 로그 (에러 메시지) |
| env <앱> / env set <앱> KEY=VALUE | 앱 환경변수(설정) 보기 / 바꾸기 |
| ping, ssh, exit, hostname, help, clear, hint | 공통 |

## 결과 읽는 법
- pods STATUS: Running(초록) 정상, Pending(노랑) 뜨는 중 또는 자리 없음, CrashLoopBackOff(빨강) 계속 죽는 중.
- 새로 생긴 pod 는 이름이 처음 보는 이름이고 RESTARTS 0 이야.
- nodes TEMP: 32°C 이상 노랑, 40°C 이상 빨강. 45°C 를 넘으면 NotReady 가 되고, 35°C 아래로 내려와야 돌아와.
- deploys READY 가 `2/3` 처럼 노랑이면 아직 원하는 개수에 못 미친 것.
- svcs 에서 `(연결된 pod 없음)` 이면 그 대표 번호로 걸어도 받을 사람이 없어.

## 장애 유형별 점검 순서
### A. pod 하나가 죽음 (Self-healing 관찰)
1. `pods` 로 지금 목록을 봐. 정말 죽어 있어?
2. 원하는 상태의 개수(`deploys` 의 READY 오른쪽 숫자)와 실제 Running 개수를 비교.
3. 새 이름의 pod 가 이미 떠 있다면? 쿠버네티스가 먼저 맞춰 놓은 거야. 이 장애의 교훈은 "관찰"이야.

### B. 재배포 직후 신청 전부 실패 (IP 를 박아둔 설정)
1. 신청 pod 하나의 `logs` → 누구에게 연락하다 실패하는지 (course 호출 실패, 주소가 보여).
2. `env` 로 신청 앱 설정을 봐. 과목조회를 부르는 주소가 pod IP(숫자)로 적혀 있는지.
3. `svcs` 로 대표 번호 목록을 확인. 바뀌는 IP 대신 바뀌지 않는 이름으로 부르게 설정을 바꾸는 방향.

### C. 랙 온도 급상승 (냉각기 고장)
1. 대시보드 온도 그래프와 `nodes` → 어느 랙의 노드가 뜨겁고 NotReady 인지.
2. `pods` 의 NODE 칸 → 아픈 노드의 pod 들이 다른 노드로 옮겨졌는지(재스케줄링).
3. 근본 원인은 냉각. 쿠버네티스는 방을 식혀주지 못해 → 냉각실 항온항습기로 직접 가서 손봐야 해 (E, 수리 미니게임).

### D. 접속자 급증 (Scale-out)
1. 대시보드: 접속자(rps) 대비 처리량, "신청 pod 부족" 메모.
2. 필요한 pod 수 = 접속자 ÷ pod 하나 처리량(약 1000). 지금 Running 인 신청 pod 수와 비교.
3. 원하는 개수만 바꾸면 돼. 노드 자리가 모자라면 Pending 에 머물 수 있어.

### E. 새 버전 배포 중 에러율 급증 (Rollback)
1. 에러가 언제부터? `rollout status` 와 `pods` 의 VERSION 칸 → 새 버전 pod 가 늘어날수록 에러가 늘어?
2. 새 버전 pod 의 `logs` → 500 에러.
3. 고칠 때까지 학생을 기다리게 할 순 없어. 이전 버전 기록(`rollout history`)이 있으니 되돌리는 방향.

## 힌트 줄 때 참고
- 앱 이름과 숫자를 붙인 완성 명령, 정확한 설정 값(KEY=VALUE)은 말하지 마.
- "원하는 상태 vs 실제 상태"를 비교하게 하는 질문이 가장 좋은 힌트야.
