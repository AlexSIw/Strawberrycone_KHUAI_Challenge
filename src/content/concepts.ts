// Concept cards: the 비유 사전 from the Notion design, one card per concept.

export interface Concept {
  id: string;
  name: string;
  analogy: string;
  definition: string;
}

export const CONCEPTS: Record<string, Concept> = {
  datacenter: { id: 'datacenter', name: '데이터센터', analogy: '컴퓨터들이 사는 아파트', definition: '서버가 24시간 일할 수 있게 전기·냉방·네트워크를 대신 공급하는 건물' },
  osi: { id: 'osi', name: 'OSI 7계층 · L1 물리', analogy: '7층짜리 우체국의 1층 = 실제 도로', definition: '통신을 7개 층으로 나눠 보는 모델. 맨 아래 L1(1층)은 데이터(0과 1)가 실제로 지나가는 케이블과 신호' },
  spof: { id: 'spof', name: '단일 장애점(SPOF) · 이중화', analogy: '다리가 하나뿐인 섬', definition: '하나만 고장 나도 전체가 멈추는 지점. 전원·장비를 두 개 이상 두어 대비한다(이중화)' },
  dhcp: { id: 'dhcp', name: 'DHCP', analogy: '주소 나눠주는 안내데스크', definition: '장비가 켜지면 IP 주소와 게이트웨이(밖으로 나가는 문) 주소를 자동으로 나눠주는 서버' },
  dns: { id: 'dns', name: 'DNS', analogy: '전화번호부', definition: 'web 같은 이름을 10.0.1.10 같은 IP 주소로 바꿔주는 장부' },
  ip: { id: 'ip', name: 'IP 주소 · 충돌', analogy: '도로명 주소 (같은 주소가 두 집이면 택배가 엉망)', definition: '네트워크에서 장비를 찾는 주소. 한 주소는 한 장비만 써야 한다. 손으로 정할 땐 이미 쓰는 주소가 아닌지 꼭 확인할 것 (라우터처럼 원래 고정 주소를 쓰는 장비도 있다)' },
  gateway: { id: 'gateway', name: '게이트웨이 · 라우터', analogy: '건물 밖으로 나가는 문 · 우편 분류소', definition: '다른 네트워크(인터넷)로 나갈 때 거치는 라우터 주소' },
  port: { id: 'port', name: '포트 (L4)', analogy: '건물 안 호실 번호', definition: '한 컴퓨터 안에서 어떤 프로그램에게 갈지 정하는 번호(7계층 중 4층, L4). 웹(HTTP)은 보통 80번' },
  socket: { id: 'socket', name: '소켓 · 멀티스레드 서버', analogy: '프로그램의 전화기 · 전화마다 도우미 한 명씩', definition: '서버는 소켓으로 연결을 받는다. 한 번에 한 명만 받으면 나머지는 줄을 선다. 연결마다 일꾼(스레드)을 따로 붙이면 여럿을 동시에 받는다(멀티스레드)' },
  tcp: { id: 'tcp', name: 'TCP vs UDP · 3-way handshake', analogy: '번호 매긴 등기우편 vs 엽서', definition: 'TCP는 "얘기할래?"(SYN) → "응, 너도?"(SYN-ACK) → "응!"(ACK) 세 번 인사한 뒤 순서와 도착을 챙긴다. UDP는 인사 없이 빠르게 던지지만 도착은 보장하지 않는다' },
  http: { id: 'http', name: 'HTTP · 상태 코드', analogy: '주문서와 번호표', definition: '요청(GET /enroll = "신청 페이지 주세요")을 보내면 응답과 상태 코드가 돌아온다. 200 OK = 성공, 404 Not Found = 그런 페이지 없음, 500 = 서버 안에서 처리하다 오류' },
  monolith: { id: 'monolith', name: '모놀리스 → MSA', analogy: '주방 하나인 큰 식당 → 매장들이 모인 푸드코트', definition: '모든 기능이 한 덩어리(모놀리스)면 하나가 죽을 때 다 죽는다. 기능별 작은 서비스로 나누면(MSA, 마이크로서비스 구조) 장애가 그 안에 갇힌다' },
  isolation: { id: 'isolation', name: '장애 격리 (Fault Isolation)', analogy: '리뷰 매장이 문 닫아도 주문은 된다', definition: '서비스를 나누면 한 서비스의 장애가 다른 서비스로 번지지 않는다' },
  scaling: { id: 'scaling', name: '독립 확장 (Independent Scaling)', analogy: '붐비는 매장만 직원 추가', definition: '바쁜 서비스만 골라 늘릴 수 있다. 다만 손으로 서버를 깔면 너무 느리다' },
  dbPerService: { id: 'dbPerService', name: 'DB는 서비스마다 따로', analogy: '남의 매장 창고에 몰래 들어가지 않기', definition: '다른 서비스의 DB(데이터 창고)를 직접 읽으면 다시 한 덩어리(분산 모놀리스)가 된다. 정해진 창구(API)로만 대화' },
  container: { id: 'container', name: '컨테이너 · 이미지', analogy: '밀키트 원본(이미지)과 그걸로 만든 한 끼(컨테이너)', definition: '앱과 실행 환경을 통째로 묶어 어느 서버에서나 똑같이 실행한다' },
  portMapping: { id: 'portMapping', name: '포트 매핑 (-p)', analogy: '길가 문 80번 → 주방 창구 8000번', definition: '컨테이너 안 포트를 바깥(호스트: 컨테이너가 돌아가는 서버) 포트와 이어야 밖에서 들어올 수 있다' },
  volume: { id: 'volume', name: '볼륨 (Volume)', analogy: '식당 전용 사물함', definition: '컨테이너 안에 저장한 데이터는 컨테이너와 함께 사라진다. 볼륨에 저장해야 남는다' },
  pod: { id: 'pod', name: 'Cluster · Node · Pod', analogy: '공항(클러스터) · 활주로(노드) · 비행기(pod)', definition: '여러 서버(노드)를 묶은 게 클러스터, 그 위에서 도는 가장 작은 실행 단위가 pod. pod 안에는 컨테이너가 들어 있다' },
  selfHealing: { id: 'selfHealing', name: '원하는 상태 · 자동 복구(Self-healing)', analogy: '"3명 유지" 근무표', definition: '원하는 상태를 적어두면 쿠버네티스가 실제 상태를 계속 맞춘다. 죽은 pod는 새로 뜬다' },
  service: { id: 'service', name: 'Service', analogy: '바뀌지 않는 대표 번호', definition: 'pod는 언젠가 죽고 IP도 바뀐다. Service 이름으로 부르면 살아 있는 pod로 연결된다' },
  reschedule: { id: 'reschedule', name: '재스케줄링 · 냉각', analogy: '쓰러진 직원 대신 다른 지점에서 대타 투입', definition: '노드(서버)가 죽으면 그 위의 pod는 사라지고, 살아 있는 노드에 새 pod(새 이름·새 IP)가 대신 뜬다(다른 자리에 다시 배치 = 재스케줄링). 하지만 냉각은 사람이 고쳐야 한다' },
  scaleOut: { id: 'scaleOut', name: 'Scale-out (옆으로 늘리기)', analogy: '숫자만 바꾸면 직원이 늘어나는 매장', definition: '원하는 pod 개수만 바꾸면 쿠버네티스가 알아서 늘린다' },
  rollback: { id: 'rollback', name: 'Rolling update · Rollback', analogy: '한 명씩 교대 · 문제 생기면 되돌리기', definition: '새 버전으로 하나씩 차례로 바꾸고(rolling update), 문제가 생기면 이전 버전으로 되돌린다(rollback). 그러려면 버전마다 :v1, :v2 같은 번호표(태그)가 있어야 한다. 늘 "latest(최신)" 한 이름만 쓰면 어디로 돌아갈지 모른다' },
  postmortem: { id: 'postmortem', name: '장애 보고서 (Postmortem)', analogy: '경기 끝나고 보는 리플레이', definition: '무슨 일이, 왜, 어떻게 고쳤고, 다음엔 어떻게 막을지 기록해 같은 장애를 반복하지 않는다' },
  // ---- v2 · D-5 물리 구축 ----
  rack: { id: 'rack', name: '랙 · U(유닛)', analogy: '서버 전용 책장과 책장 한 칸', definition: '서버와 네트워크 장비를 층층이 끼우는 표준 선반. 높이는 U(1U ≈ 4.45cm)로 센다. 랙 맨 위에는 그 랙 서버들을 묶는 스위치(ToR: Top of Rack)를 둔다. 실제로는 42U 랙이 흔하다' },
  pdu: { id: 'pdu', name: '이중 전원 A/B · PDU', analogy: '랙 전용 멀티탭 두 줄', definition: 'PDU는 랙 안에서 장비에 전기를 나눠주는 멀티탭. 서버에는 전원부(PSU)가 두 개 있어서 A줄·B줄에 하나씩 꽂으면 한 줄이 끊겨도 꺼지지 않는다' },
  ups: { id: 'ups', name: 'UPS · 발전기 · ATS', analogy: '비상 배터리 · 비상 발전기 · 자동 전환 스위치', definition: '정전되면 UPS 배터리가 몇 분 버티는 사이 발전기가 돈다. ATS(자동 절체 스위치)는 한전 전기가 끊기면 전기 길을 발전기 쪽으로 자동으로 바꾼다. 시설은 시설팀 담당이라 관제실(FMS)에서는 지켜보고 알리기만 한다' },
  epstps: { id: 'epstps', name: 'EPS실 · TPS실', analogy: '건물 속 전기 통로 · 통신선 통로', definition: '건물 층마다 전기 배선이 지나가는 작은 방(EPS실)과 통신 케이블이 지나가는 작은 방(TPS실)이 있다. 캠퍼스 건물의 네트워크 선은 TPS실을 타고 층마다 퍼지고, 데이터센터까지 이어진다' },
  portled: { id: 'portled', name: '포트 LED · CRC 오류', analogy: '신호등 · 찢어진 편지', definition: '포트 옆 불빛: 초록 = 연결됨, 꺼짐 = 연결 없음, 초록·주황 깜빡임 = 문제 있음. 케이블이 반쯤 망가지면 연결은 살아 있어도 깨진 데이터가 섞이는데, 받은 데이터의 검산이 안 맞은 횟수를 CRC 오류라고 센다' },
  // ---- v2 · D-4 네트워크 ----
  privateip: { id: 'privateip', name: '사설 IP 대역 · CIDR (/24, /16)', analogy: '아파트 단지 안에서만 쓰는 동·호수', definition: '10.x.x.x, 172.16~31.x.x, 192.168.x.x 세 대역은 건물 안에서만 쓰는 주소다(RFC 1918). /24는 앞 세 칸이 같은 주소끼리 한 동네(256개), /16은 앞 두 칸이 같은 큰 동네. 예전에는 A·B·C "클래스"로 나눴지만 1993년부터는 이렇게 / 숫자로 자른다(CIDR)' },
  vlan: { id: 'vlan', name: 'VLAN', analogy: '한 건물 안, 층마다 다른 회사', definition: '스위치 한 대를 여러 개의 논리 네트워크로 나눈다. 같은 VLAN끼리만 바로 대화하고, 다른 VLAN으로 가려면 게이트웨이(L3 장비)를 거친다. 포트마다 어느 VLAN인지 정해 준다(access 포트)' },
  l2l3: { id: 'l2l3', name: 'L2 스위치 vs L3 스위치', analogy: '층 안의 배달원 vs 층과 층을 잇는 안내원', definition: 'L2 스위치는 같은 VLAN 안에서 MAC 주소(문패)를 보고 배달한다. L3 스위치는 IP 주소를 보고 VLAN과 VLAN 사이 길도 찾아 준다(라우팅). 서버 랙 위 ToR는 L2, 데이터센터 가운데 코어는 L3. 실제로는 Cisco Catalyst 9300(ToR)·9500(코어) 같은 장비' },
  ios: { id: 'ios', name: 'IOS 명령 모드 · 설정 저장', analogy: '구경 → 직원 출입증 → 공사 모드', definition: '네트워크 장비의 명령 체계. 장비명> 는 보기만, enable 하면 장비명# (관리자), configure terminal 하면 (config)# 에서 설정을 바꾼다. 바꾼 설정은 지금 돌아가는 설정(running-config)에만 있어서, write memory로 재부팅 때 읽는 설정(startup-config)에 저장해야 남는다. 실제로는 Cisco IOS가 대표적' },
  syslog: { id: 'syslog', name: 'syslog (장비 로그)', analogy: '장비가 쓰는 일기장', definition: '장비가 "포트 내려감", "설정 바뀜", "포트 자동 차단" 같은 일을 시각과 함께 적어 두는 기록. show logging으로 보고, 관제 시스템(NMS)에도 모인다. %LINK-3-UPDOWN 처럼 "종류-심각도-이름" 모양이다' },
  hsrp: { id: 'hsrp', name: 'HSRP · 가상 게이트웨이', analogy: '대표 전화번호 하나를 두 직원이 이어 받기', definition: '게이트웨이 주소(.1)를 장비 한 대에 박지 않고, 두 L3 스위치가 함께 맡는 가상 주소로 둔다. 평소엔 Active 한 대가 받고, 고장 나면 Standby가 이어받는다. 짝이 없으면 show standby brief에 Standby가 unknown으로 나온다' },
  oob: { id: 'oob', name: 'OOB(대역 외) 관리망', analogy: '건물의 비상계단', definition: '서비스 트래픽이 다니는 길과 따로 깐, 장비 관리 전용 네트워크. 서비스 네트워크가 망가져도 관리 PC에서 장비에 접속해 고칠 수 있다. 여기서는 10.10.250.x 주소를 쓴다' },
  // ---- v2 · D-3 서비스 오픈 ----
  l4: { id: 'l4', name: 'L4 로드밸런서 · 헬스체크', analogy: '식당 입구 안내원과 "자리 있어요?" 순찰', definition: '학생들은 대표 주소(VIP) 하나로 오고, L4가 뒤의 서버 목록(풀)에 나눠 보낸다. 서버가 살아 있는지 정해진 경로·포트로 계속 물어보고(헬스체크), 대답이 없는 서버로는 손님을 보내지 않는다. 실제로는 F5 BIG-IP 같은 장비' },
  nms: { id: 'nms', name: 'NMS · SNMP 폴링', analogy: '정해진 간격으로 도는 순찰', definition: '관제 시스템(NMS)은 장비에게 상태를 주기적으로 물어본다(SNMP 폴링). 그래서 사용률·오류 숫자 같은 건 다음 순찰 때에야 경보가 된다. 장비가 먼저 알려 주는 트랩(trap)과 syslog는 바로 뜬다' },
  mttd: { id: 'mttd', name: 'MTTD · MTTR', analogy: '불난 걸 알아챈 시간 · 불을 끈 시간', definition: 'MTTD(평균 탐지 시간) = 장애 시작 → 경보 확인(ACK)까지, MTTR(평균 복구 시간) = 장애 시작 → 복구까지. 사용자 민원보다 먼저 경보를 보고 확인하는 게 관제의 일이다' },
  escalation: { id: 'escalation', name: '담당팀 이관 (에스컬레이션)', analogy: '우리 가게 일이 아니면 건물 관리실에 연락', definition: '내 담당이 아닌 시스템(다른 팀이 운영하는 교내 서비스 등)의 장애는 확인한 증상을 정리해 담당팀에 넘긴다. 직접 손대지 않고, 넘긴 뒤에도 해결될 때까지 지켜본다' },
  // ---- v2 · D-2 컨테이너 · 링크 ----
  oversubscription: { id: 'oversubscription', name: '업링크 · 오버서브스크립션', analogy: '골목 여러 개가 모이는 큰길 하나', definition: '랙의 서버들이 내보내는 트래픽은 랙 스위치(ToR)의 위쪽 길(업링크)로 모인다. 서버 쪽 포트를 다 합친 폭이 업링크 폭보다 크게 설계하는 걸 오버서브스크립션이라 하고, 평소엔 괜찮지만 몰리면 업링크가 먼저 막힌다. 관제 화면의 링크 사용률로 본다' },
  lacp: { id: 'lacp', name: 'LACP · 포트 묶음(EtherChannel)', analogy: '두 차선을 한 도로로 합치기', definition: '장비 사이 케이블 여러 줄을 하나의 논리 링크(Port-channel)로 묶는다. 폭이 합쳐지고 한 줄이 끊겨도 나머지로 버틴다. 양쪽 장비가 똑같이 묶어야 하고(LACP로 서로 확인), show etherchannel summary 에서 P = 묶여서 일하는 중, s = 묶음에서 빠져 멈춤(suspended: 상대가 같이 안 묶어 줌), D = 꺼짐' },
  stp: { id: 'stp', name: 'STP · 루프 · 브로드캐스트 스톰', analogy: '빙빙 도는 회전교차로에 차단봉 하나', definition: '스위치 사이 길이 고리(루프)를 이루면 방송(broadcast) 프레임이 끝없이 돌며 불어나 네트워크 전체가 마비된다(브로드캐스트 스톰). STP(Spanning Tree Protocol)는 고리마다 포트 하나를 막아(BLK) 나무 모양으로 만든다. VLAN별로 켜고 끈다' },
  // ---- v2 · D-1 점검 · 이중화 ----
  drain: { id: 'drain', name: 'cordon · drain (노드 비우기)', analogy: '매장 문에 "점검 중" 팻말 걸기', definition: 'cordon은 노드에 새 pod가 오지 못하게 막고, drain은 거기에 더해 있던 pod를 내보낸다(다른 노드에 새 pod로 다시 뜬다). 점검·고장 전에 노드를 미리 비울 때 쓰고, 끝나면 uncordon으로 다시 연다' },
  failover: { id: 'failover', name: '장애 조치(Failover) 훈련 · 숨은 SPOF', analogy: '소방 훈련: 비상구가 진짜 열리는지 직접 열어 보기', definition: '예비 장비가 있어도, 예비로 가는 길이 끝까지 이어져 있는지는 실제로 하나를 꺼 봐야 안다. trunk에 빠진 VLAN 하나 같은 작은 설정이 숨은 단일 장애점(SPOF)이 된다. 그래서 데이터센터는 정기적으로 하나를 일부러 꺼 보는 이중화 훈련(DR 훈련)을 한다' },
};
