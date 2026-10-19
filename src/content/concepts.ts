// Concept cards: the 비유 사전 from the Notion design, one card per concept.

export interface Concept {
  id: string;
  name: string;
  analogy: string;
  definition: string;
}

export const CONCEPTS: Record<string, Concept> = {
  datacenter: { id: 'datacenter', name: '데이터센터', analogy: '컴퓨터들이 사는 아파트', definition: '서버가 24시간 일할 수 있게 전기·냉방·네트워크를 대신 공급하는 건물' },
  osi: { id: 'osi', name: 'OSI 7계층 · L1 물리', analogy: '7층짜리 우체국의 1층 = 실제 도로', definition: '통신을 7단계로 나눈 모델. L1은 비트가 실제로 지나가는 케이블과 신호' },
  spof: { id: 'spof', name: '단일 장애점(SPOF) · 이중화', analogy: '다리가 하나뿐인 섬', definition: '하나만 고장 나도 전체가 멈추는 지점. 전원·장비를 두 개 이상 두어 대비한다' },
  dhcp: { id: 'dhcp', name: 'DHCP', analogy: '주소 나눠주는 안내데스크', definition: '장비가 켜지면 IP 주소·게이트웨이를 자동으로 나눠주는 서버' },
  dns: { id: 'dns', name: 'DNS', analogy: '전화번호부', definition: 'web 같은 이름을 10.0.1.10 같은 IP 주소로 바꿔주는 장부' },
  ip: { id: 'ip', name: 'IP 주소 · 충돌', analogy: '도로명 주소 (같은 주소가 두 집이면 택배가 엉망)', definition: '네트워크에서 장비를 찾는 주소. 한 주소는 한 장비만 써야 한다. 손으로 정할 땐 이미 쓰는 주소가 아닌지 꼭 확인할 것 (라우터처럼 원래 고정 주소를 쓰는 장비도 있다)' },
  gateway: { id: 'gateway', name: '게이트웨이 · 라우터', analogy: '건물 밖으로 나가는 문 · 우편 분류소', definition: '다른 네트워크(인터넷)로 나갈 때 거치는 라우터 주소' },
  port: { id: 'port', name: '포트 (L4)', analogy: '건물 안 호실 번호', definition: '한 컴퓨터 안에서 어떤 프로그램에게 갈지 정하는 번호. HTTP는 80' },
  socket: { id: 'socket', name: '소켓 · 멀티스레드 서버', analogy: '프로그램의 전화기 · 전화마다 도우미 한 명씩', definition: '서버는 소켓으로 연결을 받는다. 한 번에 한 명만 받으면 나머지는 줄을 선다' },
  tcp: { id: 'tcp', name: 'TCP vs UDP · 3-way handshake', analogy: '번호 매긴 등기우편 vs 엽서', definition: 'TCP는 SYN → SYN-ACK → ACK 인사 후 순서와 도착을 보장해요. UDP는 인사 없이 빠르게 보내지만 보장은 없어요' },
  http: { id: 'http', name: 'HTTP · 상태 코드', analogy: '주문서와 번호표', definition: '요청(GET /enroll)을 보내면 응답(200 OK, 404 Not Found)이 돌아온다' },
  monolith: { id: 'monolith', name: '모놀리스 → MSA', analogy: '주방 하나인 큰 식당 → 매장들이 모인 푸드코트', definition: '모든 기능이 한 덩어리면 하나가 죽을 때 다 죽는다. 기능별로 나누면 장애가 격리된다' },
  isolation: { id: 'isolation', name: '장애 격리 (Fault Isolation)', analogy: '리뷰 매장이 문 닫아도 주문은 된다', definition: '서비스를 나누면 한 서비스의 장애가 다른 서비스로 번지지 않는다' },
  scaling: { id: 'scaling', name: '독립 확장 (Independent Scaling)', analogy: '붐비는 매장만 직원 추가', definition: '바쁜 서비스만 골라 늘릴 수 있다. 다만 손으로 서버를 깔면 너무 느리다' },
  dbPerService: { id: 'dbPerService', name: 'DB는 서비스마다 따로', analogy: '남의 매장 창고에 몰래 들어가지 않기', definition: '다른 서비스의 DB를 직접 읽으면 다시 한 덩어리(분산 모놀리스)가 된다. API로만 대화' },
  container: { id: 'container', name: '컨테이너 · 이미지', analogy: '밀키트 원본(이미지)과 그걸로 만든 한 끼(컨테이너)', definition: '앱과 실행 환경을 통째로 묶어 어느 서버에서나 똑같이 실행한다' },
  portMapping: { id: 'portMapping', name: '포트 매핑 (-p)', analogy: '길가 문 80번 → 주방 창구 8000번', definition: '컨테이너 안 포트를 바깥(호스트) 포트와 연결해야 밖에서 들어올 수 있다' },
  volume: { id: 'volume', name: '볼륨 (Volume)', analogy: '식당 전용 사물함', definition: '컨테이너 안에 저장한 데이터는 컨테이너와 함께 사라진다. 볼륨에 저장해야 남는다' },
  pod: { id: 'pod', name: 'Cluster · Node · Pod', analogy: '공항(클러스터) · 활주로(노드) · 비행기(pod)', definition: '여러 서버(노드)를 묶은 게 클러스터, 그 위에서 도는 가장 작은 실행 단위가 pod. pod 안에는 컨테이너가 들어 있어요' },
  selfHealing: { id: 'selfHealing', name: '원하는 상태 · Self-healing', analogy: '"3명 유지" 근무표', definition: '원하는 상태를 적어두면 쿠버네티스가 실제 상태를 계속 맞춘다. 죽은 pod는 새로 뜬다' },
  service: { id: 'service', name: 'Service', analogy: '바뀌지 않는 대표 번호', definition: 'pod는 언젠가 죽고 IP도 바뀐다. Service 이름으로 부르면 살아 있는 pod로 연결된다' },
  reschedule: { id: 'reschedule', name: '재스케줄링 · 냉각', analogy: '쓰러진 직원 대신 다른 지점에서 대타 투입', definition: '노드가 죽으면 그 위의 pod는 사라지고, 살아 있는 노드에 새 pod(새 이름·새 IP)가 대신 떠요. 하지만 냉각은 사람이 고쳐야 해요' },
  scaleOut: { id: 'scaleOut', name: 'Scale-out', analogy: '숫자만 바꾸면 직원이 늘어나는 매장', definition: '원하는 pod 개수만 바꾸면 쿠버네티스가 알아서 늘린다' },
  rollback: { id: 'rollback', name: 'Rolling update · Rollback', analogy: '한 명씩 교대 · 문제 생기면 되돌리기', definition: '새 버전을 하나씩 교체하고, 문제가 생기면 이전 버전으로 되돌린다. :latest 금지' },
  postmortem: { id: 'postmortem', name: '장애 보고서 (Postmortem)', analogy: '경기 끝나고 보는 리플레이', definition: '무슨 일이, 왜, 어떻게 고쳤고, 다음엔 어떻게 막을지 기록해 같은 장애를 반복하지 않는다' },
};
