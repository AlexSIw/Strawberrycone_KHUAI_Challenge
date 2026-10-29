// Korean gloss lines printed dim after IOS output and errors: what to look at and what the key words
// mean. Generic on purpose: never an address, a port name or a VLAN number, never an incident's answer
// (tests/ios.test.ts runs every show command on every day's world and checks).
import { dim } from '../commands/types';
import { maskToDotted } from '../net/basics';

/** After each show command (not when the output is filtered with `| include …`). */
export const SHOW_GLOSS = {
  intStatus: [
    '(Status 칸: connected 연결돼 동작 중 · notconnect 상대 신호 없음 · disabled 설정으로 꺼 둠 · err-disabled 스위치가 이상을 감지해 스스로 막아 둠 · inactive 없는 VLAN에 넣음)',
    '(Vlan 칸: 그 포트가 속한 VLAN 번호 · trunk = 스위치끼리 잇는 포트라 VLAN 여러 개를 실어 나름 · routed = VLAN 대신 자기 IP 주소를 가진 포트)',
  ],
  ipIntBrief: [
    '(Status·Protocol 칸: 둘 다 up 이면 정상 · down 신호 없음 · administratively down 설정으로 꺼 둠)',
    '(IP-Address 칸: 그 인터페이스에 붙인 주소, unassigned 는 주소 없음 · Vlan 으로 시작하는 줄 = VLAN마다 만든 가상 인터페이스(SVI))',
  ],
  vlanBrief: [
    '(VLAN마다 번호·이름과, 그 VLAN에 들어 있는 access 포트(서버·PC를 꽂는 포트)가 보여요)',
    '(default = 처음부터 있는 기본 VLAN, VLAN을 아직 안 정한 포트가 여기 있어요 · trunk 포트는 여기 안 나와요: show interfaces trunk)',
  ],
  standby: [
    '(State = 이 장비가 맡은 역할: Active 지금 게이트웨이를 맡음 · Standby 예비로 대기 · Init 아직 시작 못 함 · Pri 높은 쪽이 Active · P = preempt(되찾아 오기))',
    '(Active·Standby 칸 = 그 역할을 맡은 장비, local 은 이 장비 자신 · Standby unknown = 짝이 없음 = 예비 없음 · Virtual IP = 모두가 쓰는 공용 게이트웨이 주소)',
  ],
  stp: [
    '(Role 칸: Root 루트 스위치 쪽으로 가는 포트 · Desg 내보내는 포트 · Altn 예비 길 · Sts 칸: FWD 전달 중 · BLK 차단 = 길이 빙 도는 루프를 막으려고 일부러 막은 포트)',
    '(VLAN마다 표가 따로 나와요 · Root ID = 그 VLAN의 중심(루트) 스위치, This bridge is the root 면 이 장비가 루트)',
  ],
  stpNoVlan: ['(이 VLAN에는 지금 루프 방지(STP)가 돌고 있지 않다는 뜻이에요. 이 장비에 그 VLAN이 아예 없을 때도 이렇게 나와요)'],
  stpNone: ['(이 장비에는 지금 루프 방지(STP)가 도는 VLAN이 하나도 없다는 뜻이에요)'],
  etherchannel: [
    '(포트 옆 괄호: P = 묶여서 함께 일함 · s = 묶음에서 빠져 쉬는 중 (맞은편 장비의 포트도 같은 묶음으로 묶어야 일해요) · D = 꺼짐 · I = 묶이지 않고 혼자 동작)',
    '(Po 옆 괄호: S = 스위치 포트(L2) · U = 사용 중, SU 면 정상 · D 가 붙으면 묶음 전체가 내려감)',
    '(Group = 묶음 번호, 장비마다 따로 매겨요 · 이미 쓰는 번호로 묶으면 그 묶음에 들어가요 · 한 묶음에는 같은 상대 장비로 가는 포트만 넣어요)',
  ],
  interfaces: [
    '(txload·rxload = 보내기·받기 사용률, 255/255 면 꽉 참 · BW = 이 포트의 최대 속도 · line protocol up = 실제로 통신할 수 있음)',
    '(input errors·CRC = 깨진 채 도착한 데이터 수 · 숫자는 계속 쌓이니까, 잠시 뒤 다시 봐서 늘어나는지 확인해요)',
  ],
  countersErrors: [
    '(FCS-Err = 깨진 채 도착한 데이터(CRC 오류) 수 · Rcv-Err = 받다가 생긴 오류 전체 · 0 이면 깨끗)',
    '(숫자는 계속 쌓여요: 잠시 뒤 다시 봐서 늘어나는 포트가 지금 문제인 곳 · clear counters 로 0부터 다시 셀 수 있어요)',
  ],
  trunk: [
    '(trunk = 스위치끼리 잇는 포트, VLAN 여러 개를 실어 날라요 · Vlans allowed on trunk = 이 포트로 지나가도 되는 VLAN 목록)',
    '(allowed and active = 그중 이 스위치에 실제로 있는 VLAN · forwarding = 루프 방지(STP)에 막히지 않고 지금 실제로 지나가는 VLAN)',
    '(꺼진 포트는 표에 안 나와요 · forwarding 이 none 이면 지금은 다른 길이 일하고 이 길은 예비로 쉬는 중일 수 있어요: show spanning-tree 로 확인)',
  ],
  trunkNone: ['(지금 동작 중인 trunk 포트가 없어요)'],
  logging: [
    '(한 줄 읽는 법: 시각 · %장비기능-심각도-종류 · 내용. 예) %LINK-3-UPDOWN = 포트 연결(LINK)이 켜지거나 꺼짐, 심각도 3)',
    '(심각도는 0 가장 심각 ~ 7 참고용 · 맨 아래가 가장 최근 · CONFIG_I = 설정이 바뀜, vty = 원격 접속, 괄호 안 = 접속한 곳의 주소)',
    '(MACFLAP = 같은 기기 주소(MAC)가 두 포트에서 번갈아 보인다는 알림 · BPDUGUARD = 스위치가 수상한 신호를 받은 포트를 스스로 막았다는 알림)',
  ],
  running: [
    '(지금 이 장비에서 돌아가는 설정 전체예요 · ! 는 구분선 · 한 칸 들여 쓴 줄은 바로 위 interface·vlan 의 설정)',
    '(write memory 로 저장하기 전에는 장비를 재부팅하면 사라져요 · 저장된 설정은 show startup-config)',
  ],
  startup: ['(저장된 설정이에요: 장비를 재부팅하면 이걸로 켜져요 · 지금 설정(show running-config)과 다르면 아직 저장 안 한 게 있는 것)'],
  startupNone: ['(아직 한 번도 저장(write memory)하지 않았어요)'],
  cdp: [
    '(Device ID = 옆에 연결된 네트워크 장비 · Local Intrfce = 내 쪽 포트 · Port ID = 상대 쪽 포트)',
    '(CDP = 네트워크 장비끼리 서로 이름을 알려 주는 기능이라 서버·PC는 안 나와요 · Capability 칸: R 라우터 · S 스위치)',
  ],
  version: ['(장비 모델, 소프트웨어 버전, 켜진 지 얼마나 됐는지(uptime), 포트 수를 보여줘요)'],
} as const satisfies Record<string, readonly string[]>;

export type ShowGloss = keyof typeof SHOW_GLOSS;

/** The dim lines for one show command. */
export const showGloss = (k: ShowGloss): string[] => SHOW_GLOSS[k].map((s) => dim(s));

/** After other IOS output and after errors (one dim line, right under the error). */
export const TIP = {
  configure: '(설정 모드예요: 한 줄에 명령 하나씩 · 다 하면 end (CNTL/Z = Ctrl+Z) 로 # 모드로 나가요)',
  saved: '(저장했어요: 이제 장비를 재부팅해도 이 설정이 남아요)',
  invalid: '(^ 표시한 곳부터 이 모드에선 모르는 말이에요. ? 를 쳐서 쓸 수 있는 말을 보세요)',
  incomplete: '(명령이 덜 끝났어요. 한 칸 띄고 ? 를 치면 뒤에 올 말이 보여요)',
  showIncomplete: '(무엇을 볼지 뒤에 더 써야 해요. show ? 로 목록을 보세요)',
  ambiguous: '(줄임말이 너무 짧아서 여러 명령과 겹쳐요. 글자를 더 쳐 주세요. 끝에 ? 를 붙이면 후보가 보여요)',
  unrecognized: '(이 모드에는 그 글자로 시작하는 명령이 없어요. 글자를 지우고 ? 만 쳐 보세요)',
  pipe: '(| 뒤에는 include · exclude · begin · section 중 하나와 찾을 말을 써요)',
  doShow: '(설정 모드에서는 show 앞에 do 를 붙여요. 예) do show vlan brief · 또는 end 로 나가서 show)',
  doWrite: '(설정 모드에서는 바로 저장이 안 돼요. end 로 나와서 write memory (또는 do write memory))',
  doExec: '(이 명령은 관리자 모드(#)에서 써요. end 로 나오거나, 앞에 do 를 붙여요)',
  inConfig: '(이미 설정 모드 안이에요. # 모드로 돌아가려면 end)',
  noDo: '(do 는 설정 모드에서만 붙여요. 여기서는 do 없이 그냥 쳐요)',
  noSuchPort: '(이 장비에는 그런 포트가 없어요. show interfaces status 로 포트 이름을 확인해요)',
  needEnable: '(이 명령은 관리자 모드(#)에서 써요. 먼저 enable)',
  needConfig: '(이 명령은 설정 모드에서 써요. 먼저 configure terminal (conf t))',
  needConfigUser: '(이 명령은 설정 모드에서 써요. enable → configure terminal (conf t) 다음에)',
  needIf: '(이 명령은 포트 설정 모드에서 써요. configure terminal → interface <포트> 로 들어간 다음에)',
  needIfUser: '(이 명령은 포트 설정 모드에서 써요. enable → configure terminal → interface <포트> 로 들어간 다음에)',
  pickIf: '(이 명령은 포트 설정 모드에서 써요. 먼저 interface <포트> 로 설정할 포트를 고르세요)',
  needVlan: '(이 명령은 VLAN 설정 모드에서 써요. configure terminal → vlan <번호> 로 들어간 다음에)',
  needVlanUser: '(이 명령은 VLAN 설정 모드에서 써요. enable → configure terminal → vlan <번호> 로 들어간 다음에)',
  pickVlan: '(이 명령은 VLAN 설정 모드에서 써요. 먼저 vlan <번호> 로 VLAN을 고르세요)',
  needSvi: '(이 명령은 VLAN 인터페이스(interface vlan <번호>)에서 써요. 지금 고른 인터페이스에서는 못 써요)',
  needPort: '(이 명령은 실제 포트(interface <포트>)에서 써요. 지금 고른 인터페이스에서는 못 써요)',
  ssh: '(스위치 안에서는 ssh 를 못 써요. exit 로 관리 PC(ops)에 돌아가서 ssh 하세요)',
  linux: '(여기는 스위치(IOS)예요. 관리 PC 명령은 exit 로 관리 PC(ops)에 돌아가서 쓰세요)',
  help: '(스위치에서는 help 대신 ? 를 쳐요)',
  decoy: '(이 게임에서는 쓰지 않는 명령이에요. ? 로 쓸 수 있는 명령을 보세요)',
  unknownHost: '(그런 이름이나 주소를 찾지 못했어요)',
  l2NoIp: '(이 포트는 스위치 포트(L2)라 IP 주소를 못 붙여요. VLAN의 주소는 VLAN 인터페이스(interface vlan <번호>)에 붙여요)',
  badMask: '(마스크가 올바르지 않아요. /24 라면 255.255.255.0 이에요)',
  overlap: '(이 장비의 다른 인터페이스가 이미 같은 대역을 쓰고 있어요. VLAN마다 대역이 달라야 해요)',
  vipEqualsIp: '(자기 주소(ip address)와 가상 게이트웨이 주소(standby … ip)는 서로 달라야 해요)',
  vipSubnet: '(가상 게이트웨이 주소는 이 인터페이스 주소와 같은 대역 안이어야 해요)',
  vlanOne: '(처음부터 있는 기본 VLAN(default)은 지우거나 이름을 바꿀 수 없어요)',
  physical: '(실제 포트는 지울 수 없어요. 지울 수 있는 건 VLAN 인터페이스와 포트 묶음(Po)이에요)',
  vlanName: '(이름은 VLAN 하나씩 붙여요. vlan <번호> 로 하나만 골라서 들어가요)',
  vlanCreated: '(없는 VLAN이라 새로 만들었어요. 이름은 vlan <번호> → name <이름> 으로 붙여요)',
  poCreated: '(포트 묶음(Port-channel, 줄여서 Po)을 새로 만들었어요: 이 번호로 묶은 포트들을 장비는 한 줄로 봐요 · 맞은편 장비의 포트도 묶어야 함께 일해요)',
  dnsHost: '(DNS 장부 명령은 DNS 서버 ns1 안에서 써요. exit 로 관리 PC에 돌아간 뒤 ssh ns1)',
  dhcpHost: '(주소 풀 명령은 DHCP 서버 dhcp01 안에서 써요. exit 로 관리 PC에 돌아간 뒤 ssh dhcp01)',
  lbHost: '(lb 명령은 L4 장비 안에서 써요. exit 로 관리 PC에 돌아간 뒤 ssh L4-01)',
  fwHost: '(fw 명령은 방화벽 안에서 써요. exit 로 관리 PC에 돌아간 뒤 ssh FW-01)',
} as const;

export const tip = (k: keyof typeof TIP): string => dim(TIP[k]);

/** `ip address <IP> /24` (or `<IP>/24`): IOS writes the mask out. */
export const maskTip = (n: number): string =>
  dim(`(IOS는 /${n} 대신 마스크로 써요: /${n} = ${maskToDotted(n)} · 예) ip address <IP> ${maskToDotted(n)})`);

/**
 * One plain-Korean line for a syslog entry (the NOC device pane prints it under the raw line), or null.
 * It restates the line; it never says why it happened.
 */
export function syslogGloss(tag: string, msg: string): string | null {
  const kind = tag.split('-').slice(2).join('-');
  const fac = tag.split('-')[0];
  if (kind === 'CONFIG_I') {
    const from = /\(([^)]+)\)\s*$/.exec(msg)?.[1];
    return `설정이 바뀌었어요${from ? ` · 바꾼 곳(접속한 주소): ${from}` : ''}`;
  }
  if (kind === 'UPDOWN' || kind === 'CHANGED') {
    const what = fac === 'LINEPROTO' ? '포트의 통신' : '포트 연결';
    if (/administratively down/.test(msg)) return '포트를 설정으로 껐어요 (shutdown)';
    if (/to up\b/.test(msg)) return `${what}이 켜졌어요`;
    if (/to down\b/.test(msg)) return `${what}이 끊겼어요`;
    return null;
  }
  if (kind === 'MACFLAP_NOTIF') return '같은 기기 주소(MAC)가 두 포트에서 번갈아 보여요';
  if (kind === 'BLOCK_BPDUGUARD') return '스위치가 이 포트에서 다른 스위치의 신호(BPDU)를 받아서 포트를 막았어요';
  if (kind === 'ERR_DISABLE') return '스위치가 이상을 감지해 포트를 스스로 막았어요 (err-disabled)';
  if (kind === 'BUNDLE') return '포트가 포트 묶음(Po)에 들어갔어요';
  if (kind === 'UNBUNDLE') return '포트가 포트 묶음(Po)에서 빠졌어요';
  if (kind === 'STATECHANGE') return /-> Active/.test(msg) ? '이 장비가 게이트웨이(HSRP Active)를 맡았어요' : '이 장비가 게이트웨이(HSRP Active)에서 물러났어요';
  if (kind === 'COUNTERS') return '오류 숫자를 0부터 다시 세기 시작했어요';
  return null;
}
