# 운영 매뉴얼 — D-4 · 네트워크 (VLAN · 게이트웨이 · DHCP · DNS · IOS)

수강신청까지 4일. 어제 꽂은 서버 3대(WEB-01, WEB-02, DB-01)가 서로 대화하게 만드는 날이야.
서버마다 동네(VLAN)를 정하고, 동네 사이를 잇는 문(게이트웨이)을 코어 스위치에 달고, 이름표(DNS)를 붙이고, 저장해.
다른 VLAN, 코어의 다른 설정, 캠퍼스 건물 연결, DHCP·DNS 서버는 선배들이 이미 만들어 뒀어. 학생 접속은 아직 없지만, 캠퍼스 건물(도서관 와이파이 등)은 오늘도 우리 네트워크로 인터넷을 써.
터미널은 관제실 관리 PC(책상)에서 열어. 터미널은 관리 PC(ops)에서 시작해.

## 이번 날 목표
1. 관리 PC에서 TOR-01에 원격 접속 (ssh TOR-01)
2. TOR-01에 VLAN 10(WEB)·20(DB) 만들기
3. TOR-01 서버 포트 배정: Gi1/0/1·Gi1/0/2(WEB-01·02) → VLAN 10, Gi1/0/3(DB-01) → VLAN 20
4. CORE-01에 VLAN 10·20 게이트웨이 만들기: 자기 주소 .2 + 가상 게이트웨이(standby) .1
5. DNS 서버(ns1)에 web·db 이름 등록
6. DHCP 서버(dhcp01)에서 캠퍼스 주소 풀 확인 (dhcp pool list)
7. 오늘 바꾼 TOR-01·CORE-01 설정 저장 (write memory). 아침에 생기는 서버 연락 두절 장애를 해결한 뒤에 열려.

## 주소 계획 (설계 보드에도 있어)
| 대상 | 값 |
|---|---|
| 데이터센터 VLAN | 10 WEB · 20 DB · 30 L4 · 40 K8S · 50 INFRA(DNS·DHCP) · 100 NOC(관리 PC) |
| 주소 모양 | 10.10.(VLAN 번호).x /24 — 예: VLAN 10 = 10.10.10.0/24 |
| 게이트웨이 | 각 VLAN의 .1 = 가상 주소(HSRP). CORE-01 자기 주소 .2, CORE-02 자기 주소 .3 (다른 VLAN은 이미 짝이 있고, VLAN 10·20은 D-1에) |
| 서버 | WEB-01 10.10.10.11 · WEB-02 10.10.10.12 · DB-01 10.10.20.11 |
| TOR-01 포트 | Gi1/0/1 WEB-01 · Gi1/0/2 WEB-02 · Gi1/0/3 DB-01 (Gi1/0/4~8은 선배들 서버) |
| 인프라 | ns1 10.10.50.11 · ns2 10.10.50.12 · dhcp01 10.10.50.21 · 관리 PC 10.10.100.11 |
| 관리망(OOB) | 장비마다 10.10.250.x (TOR-01 .31, CORE-01 .21). 이름으로 ssh 해도 돼 |
| 캠퍼스 | 건물마다 10.20.x.0/24, DHCP 풀은 .100~.199 (공학관 유선 eng-wired · 중앙도서관 무선 lib-wifi · 본관 교직원 main-staff) |

## 핵심 개념
- 사설 IP · CIDR (비유: 아파트 단지 안에서만 쓰는 동·호수) — 10.x.x.x, 172.16~31.x.x, 192.168.x.x는 건물 안에서만 쓰는 주소(RFC 1918). /24는 앞 세 칸이 같은 주소끼리 한 동네(256개). 옛날엔 A·B·C 클래스로 나눴지만 지금은 / 숫자로 잘라(CIDR).
- VLAN (비유: 한 건물 안, 층마다 다른 회사) — 스위치 한 대를 여러 논리 네트워크로 나눠. 같은 VLAN끼리만 바로 대화하고, 다른 VLAN으로 가려면 게이트웨이를 거쳐야 해. 서버 포트는 access 포트로, 포트마다 VLAN 하나를 정해줘.
- L2 vs L3 스위치 (비유: 층 안의 배달원 vs 층과 층을 잇는 안내원) — TOR-01(L2)은 같은 VLAN 안에서 배달하고, CORE-01(L3)은 VLAN과 VLAN 사이 길을 찾아줘. 코어의 "VLAN 인터페이스"(SVI, interface vlan 10)가 그 VLAN의 문이야.
- HSRP · 가상 게이트웨이 (비유: 대표 전화번호 하나를 두 직원이 이어 받기) — 서버들은 게이트웨이를 .1로 알고 있어. .1은 코어 한 대에 박힌 주소가 아니라 standby로 만든 가상 주소야. 다른 VLAN은 CORE-02가 이미 짝(Standby)이지만, 오늘 만든 VLAN 10·20은 CORE-01 혼자 맡아서 show standby brief의 그 두 줄에 짝(Standby)이 unknown으로 나와. 단일 장애점이고, D-1에 CORE-02를 짝으로 붙여.
- IOS 명령 모드 (비유: 구경 → 직원 출입증 → 공사 모드) — 장비명> (보기만) → enable → 장비명# (관리자, show 가능) → configure terminal → 장비명(config)# (설정) → interface ... → (config-if)# (그 포트 설정). end 로 # 로 돌아와.
- running-config vs startup-config — 바꾼 설정은 지금 돌아가는 설정에만 있어. write memory(줄여서 wr)로 저장해야 재부팅 후에도 남아.
- syslog (비유: 장비의 일기장) — 포트 up/down, 설정 변경, 포트 자동 차단 같은 일이 시각과 함께 남아. show logging 으로 봐.
- OOB 관리망 (비유: 건물 비상계단) — 장비 관리용 길(10.10.250.x)은 서비스 길과 따로라서, 서비스 네트워크가 망가져도 관리 PC에서 장비에 접속할 수 있어.
- DHCP (비유: 주소 나눠주는 안내데스크) — 캠퍼스 기기들은 dhcp01에서 주소를 받아. 건물마다 나눠줄 주소 묶음(풀)이 있고, 풀이 바닥나면 새 기기는 주소를 못 받아 169.254로 시작하는 임시 주소를 스스로 붙여(밖으로 못 나감). 데이터센터 서버는 손으로 정한 고정 주소라 DHCP를 안 써.
- DNS (비유: 전화번호부) — web, db 같은 이름을 숫자 주소로 바꿔주는 장부. ns1이 장부를 갖고 있어.

## 쓸 수 있는 명령어
### 관리 PC·서버 (리눅스)
| 명령 | 뜻 |
|---|---|
| ssh <이름 또는 IP> / exit | 다른 장비에 원격 접속 / 관리 PC로 돌아오기. 스위치에 들어가면 장비명> 프롬프트가 떠 |
| ping <이름 또는 IP> | 상대가 대답하는지 확인 |
| traceroute <이름 또는 IP> | 가는 길에 거치는 장비 목록 |
| nslookup <이름> | 이름이 어떤 숫자 주소로 바뀌는지 (DNS에 물어보기) |
| ip addr / hostname | 이 장비의 주소·게이트웨이 / 지금 어느 장비인지 |
| help, clear, hint | 명령 목록, 화면 지우기, 쿠사수 부르기 |

### DNS 서버 (ssh ns1 한 뒤)
| 명령 | 뜻 |
|---|---|
| dns list | 장부 보기 (이름 → IP) |
| dns add <이름> <IP> | 이름 등록 |
| dns del <이름> | 이름 지우기 |

### DHCP 서버 (ssh dhcp01 한 뒤)
| 명령 | 뜻 |
|---|---|
| dhcp pool list | 풀마다 크기·사용 중·남은 칸·묵은 임대(stale)·주소 못 받은 기기 수(starving) |
| dhcp pool show <풀> | 풀 하나 자세히 (범위, 게이트웨이, DNS) |
| dhcp pool set <풀> range <시작 주소> <끝 주소> | 풀의 주소 범위 바꾸기 (같은 /24 안에서) |
| dhcp leases <풀> | 그 풀에서 나간 주소(임대) 목록 |
| dhcp leases clear <풀> | 이미 떠난 기기가 남긴 묵은 임대 정리 |

### 스위치 (IOS, ssh TOR-01 / ssh CORE-01 한 뒤)
| 명령 (줄임말) | 모드 | 뜻 |
|---|---|---|
| enable (en) | > | 관리자 모드(#)로 |
| configure terminal (conf t) | # | 설정 모드로 |
| show vlan brief (sh vlan br) | # | VLAN 목록과 VLAN마다 속한 포트 |
| show interfaces status (sh int status) | # | 포트마다 연결 상태(connected / notconnect / disabled / err-disabled)와 VLAN |
| show ip interface brief (sh ip int br) | # | 인터페이스마다 주소와 상태(up / down / administratively down) |
| show standby brief (sh standby br) | # | 가상 게이트웨이(HSRP): 누가 Active, 누가 Standby |
| show logging (sh log) | # | 장비 일기장(syslog) |
| show running-config (sh run) | # | 지금 돌아가는 설정 전체 |
| write memory (wr) / copy running-config startup-config | # | 설정 저장 |
| vlan <번호> → name <이름> | (config) | VLAN 만들기 · 이름 붙이기 |
| interface <포트> (int gi1/0/1) | (config) | 그 포트 설정 모드로 |
| switchport access vlan <번호> | (config-if) | 이 포트를 그 VLAN에 넣기 |
| interface vlan <번호> | (config) | 코어의 VLAN 인터페이스(SVI) 설정 모드로 |
| ip address <주소> <마스크> | (config-if) | 인터페이스 주소 (/24 = 255.255.255.0) |
| standby 1 ip <가상 주소> | (config-if) | HSRP 가상 게이트웨이 주소 |
| shutdown / no shutdown | (config-if) | 인터페이스 끄기 / 켜기 |
| exit / end | 설정 모드 | 한 단계 위로 / # 로 바로 |
| do <show 명령> | 설정 모드 | 설정 모드에서 show 하기 |
- ? 를 치면 그 자리에 올 수 있는 말이 나오고, Tab 은 줄임말을 채워줘. 처음엔 전체 이름으로 치고, 익숙해지면 줄임말을 써.
- 새로 만든 VLAN 인터페이스는 꺼진 채로 생길 수 있어. 주소를 넣은 뒤 no shutdown 으로 켜줘.
- 오류 줄은 % 로 시작해: "% Invalid input" = 그 자리에 올 수 없는 말(^ 표시 위치를 봐), "% Incomplete command" = 뒤에 더 써야 함, "% Ambiguous command" = 줄임말이 여러 명령과 겹침.

## 결과 읽는 법
- show vlan brief: VLAN 번호 · 이름 · 상태 · 그 VLAN에 속한 포트들. 포트가 엉뚱한 VLAN 줄에 있으면 배정이 틀린 것.
- show interfaces status: connected = 연결됨, notconnect = 케이블 없음/상대 꺼짐, disabled = 관리자가 끔(shutdown), err-disabled = 스위치가 위험을 보고 스스로 막음.
- show ip interface brief: Status/Protocol 이 up/up 이면 정상, administratively down = 누가 shutdown 해둠, down = 연결이나 VLAN이 없어서 내려감.
- show standby brief: State Active = 지금 게이트웨이를 맡음. Standby 칸이 unknown = 짝이 없음(단일 장애점).
- show logging 에서 자주 보는 줄:
  - %SYS-5-CONFIG_I: Configured from ... = 누군가 설정을 바꿈 (누가·어디서 접속했는지도 나와)
  - %LINK-3-UPDOWN / %LINEPROTO-5-UPDOWN = 포트·인터페이스가 올라오거나 내려감
  - %SPANTREE-2-BLOCK_BPDUGUARD / %PM-4-ERR_DISABLE = 서버 포트에 스위치 신호가 들어와서 포트를 막음
- ping: 성공 = 5개 보내서 5개 돌아옴(0% packet loss). 0 received · 100% packet loss = 길이 막힘 (Destination Host Unreachable 줄이 같이 나오기도 해). "Name or service not known" = DNS 장부에 그 이름이 없음, "Temporary failure in name resolution" = 이름을 물어볼 DNS 서버에 닿지 않음.
- dhcp pool list: free(남은 칸)가 0이고 starving(주소 못 받은 기기)이 0보다 크면 풀이 바닥난 것. stale(묵은 임대)이 많으면 떠난 기기의 흔적이 칸을 차지한 것.

## 장애 유형별 점검 순서
### A. 서버 하나가 다른 서버들과 연락 두절 (포트 VLAN이 바뀜)
증상 예: "서버 한 대가 갑자기 다른 서버들이랑 연락이 안 된대요. 전원도 케이블도 멀쩡하다는데요?" · 경보 "DB-01 응답 없음 (ping 감시)"
1. 관리 PC에서 그 서버로 ping (이름과 숫자 둘 다). 둘 다 안 되면 이름 문제가 아니라 길 문제.
2. 관제 화면 NMS에서 그 서버 포트 불빛: 초록이면 L1(케이블)은 정상 → 위층(VLAN)을 의심.
3. TOR-01에서 show vlan brief (또는 show interfaces status): 그 서버 포트가 어느 VLAN 줄에 있는지 주소 계획과 비교.
4. show logging: %SYS-5-CONFIG_I 줄이 있으면 누군가 설정을 바꾼 것. 시각을 봐.
5. 해결 방향: 그 포트 설정 모드로 들어가서 원래 VLAN으로 되돌리고, 저장.
- 교훈: VLAN이 바뀌면 케이블·불빛은 멀쩡해도 다른 동네로 이사 간 셈이라 대화가 끊겨.

### B. 도서관 와이파이 새 접속자만 인터넷 불가 (DHCP 풀 고갈)
증상 예: "중앙도서관 와이파이에 새로 접속한 사람들이 인터넷이 안 된대요. 먼저 와 있던 사람들은 괜찮고요." · 경보 "dhcp01 주소 풀 사용률 100%"
1. "새로 온 기기만" 안 된다 → 새 기기가 접속할 때 하는 일 = 주소 받기(DHCP). 먼저 온 기기는 이미 주소가 있어서 괜찮아.
2. ssh dhcp01 → dhcp pool list: 그 건물 풀의 size(크기) · used(사용 중) · free(남은 칸) · stale(묵은 임대) · starving(주소 못 받은 기기).
3. 왜 찼는지 판단:
   - stale 이 크다 → 이미 떠난 기기들의 묵은 임대가 칸을 차지. 묵은 임대를 정리하는 명령이 있어.
   - stale 은 0인데 기기 수가 풀 크기보다 많다 → 진짜로 사람이 많음. 풀의 범위를 같은 동네(/24) 안에서 넓혀야 해. 게이트웨이 주소(.1)와 겹치지 않게.
4. 다시 dhcp pool list: starving 이 0이면 해결.
- 교훈: 풀이 바닥나면 새 기기는 169.254 임시 주소를 붙이고 밖으로 못 나가. 진짜 사람 vs 묵은 흔적을 구분해서 고르는 게 핵심.

### C. web 서버가 이름으로 db를 못 찾음 (DNS 장부)
증상 예: "web 서버에서 db 서버로 연결이 안 된대요! IP 주소를 직접 넣으면 된다는데요?"
1. web에서 이름(db)으로 ping, 숫자 주소로 ping. 숫자는 되고 이름은 안 되면 길은 멀쩡, 전화번호부 문제.
2. nslookup db: 이름을 못 찾는지, 엉뚱한 숫자로 바뀌는지 봐.
3. ssh ns1 → dns list: db 줄이 없거나, 주소 계획과 다른 숫자가 적혀 있는지.
4. db의 진짜 주소는 주소 계획표, 또는 db 서버에서 ip addr 로 확인. 틀린 줄은 지우고 다시 등록.
- 주소를 짐작해서 적으면 안 돼. 다른 장비의 주소를 적으면 "db"가 엉뚱한 장비로 가.

### D. 예비 서버가 네트워크에서 사라짐 (err-disabled · bpduguard)
증상 예: "예비로 두던 서버 한 대가 갑자기 네트워크에서 사라졌대요. 전원은 켜져 있다는데요?" · 경보 "TOR-01 포트 하나가 err-disabled"
1. TOR-01에서 show interfaces status: 그 서버 포트 상태가 err-disabled 인지 (그냥 notconnect·disabled 와 달라).
2. show logging: %SPANTREE-2-BLOCK_BPDUGUARD 줄 = 서버 자리 포트에 스위치 신호(BPDU)가 들어왔다는 뜻. 누군가 서버 자리에 스위치를 꽂았던 것. 스위치끼리 주고받는 신호(BPDU)가 서버 포트로 들어온 거야. 서버 포트에는 bpduguard(스위치가 꽂히면 포트를 막는 안전장치)가 켜져 있어.
3. 원인 장비가 이미 빠졌는지 확인 (이 장애에선 이미 빠졌어).
4. 해결 방향: 그 포트 설정 모드에서 한 번 껐다가 다시 켜면 err-disabled 가 풀려. 그다음 저장.
- 교훈: bpduguard 는 네트워크에 고리(루프)가 생기는 걸 막는 안전장치. 원인을 치운 뒤 포트를 다시 살려.

### E. 웹 서버 ↔ DB 서버 연결 끊김 (코어 VLAN 인터페이스 꺼짐)
증상 예: "웹 서버에서 DB 서버로 가는 연결이 끊겼대요. 서버들은 다 켜져 있고 불빛도 정상이래요." · 경보 "CORE-01 인터페이스 하나가 down"
1. 같은 VLAN끼리(예: WEB-01 ↔ WEB-02)는 되는지, VLAN을 건너갈 때만 안 되는지 비교.
2. 서버에서 자기 게이트웨이(.1)로 ping. 안 되면 문(게이트웨이)이 닫힌 것.
3. CORE-01에서 show ip interface brief: VLAN 인터페이스 중 administratively down 이 있는지. show standby brief, show logging 도 같이.
4. 해결 방향: 그 VLAN 인터페이스 설정 모드에서 다시 켜고 저장.
- 교훈: 지금은 VLAN 10·20의 게이트웨이를 CORE-01 혼자 맡아서 여기가 단일 장애점. D-1에 짝(CORE-02)을 붙이면 이런 고장에도 버텨.

### F. 목표가 안 넘어감
- ssh: 관리 PC에서 ssh TOR-01 로 들어가야 해(랙 콘솔로 들어간 건 인정 안 됨).
- VLAN: TOR-01에서 vlan 10, vlan 20 을 만들었는지 (show vlan brief).
- 포트: 세 포트 모두 맞는 VLAN인지 (show vlan brief). WEB-01·02 는 10, DB-01 은 20.
- 게이트웨이: CORE-01의 interface vlan 10 과 20 각각에 ip address 10.10.N.2 255.255.255.0, standby 1 ip 10.10.N.1, 그리고 켜져 있는지(no shutdown).
- DNS: ns1 장부에 web 과 db 가 주소 계획대로 있는지 (dns list).
- DHCP: dhcp01 에 접속해서 dhcp pool list 를 쳐야 해.
- 저장: 아침의 연락 두절 장애를 해결한 뒤에 열려. TOR-01·CORE-01 둘 다 write memory. 장애를 고치면서 설정을 또 바꿨다면 다시 저장해.

## 힌트 줄 때 참고
- 장애 힌트에서는 고칠 포트 이름, VLAN 번호, IP 주소, 완성된 명령(값 포함)을 말하지 마. "어떤 show 명령으로 무엇을 비교할지"를 알려줘.
- 목표(미션) 도움은 주소 계획표에 있는 값이니 알려줘도 돼. 모드 이동(enable, configure terminal, end)과 저장(write memory)은 언제든 알려줘도 돼.
- IOS 는 처음이야. 프롬프트 끝 글자(> # (config)#)로 지금 어느 모드인지 읽는 법부터 알려주면 좋아.
- 늘 "이름 vs 숫자", "같은 VLAN vs 다른 VLAN", "먼저 온 기기 vs 새 기기"처럼 비교 실험을 권해.
