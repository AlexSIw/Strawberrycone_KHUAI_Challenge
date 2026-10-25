// The command trees, one per mode. Each node has IOS help text and a Korean gloss (`ko`).
import { dim, green, yellow } from '../commands/types';
import { isIp } from '../net/basics';
import { resolve, reach } from '../net/reach';
import { log } from '../net/sync';
import type { IosLevel } from '../types';
import {
  channelGroup,
  createVlans,
  deleteVlans,
  dirty,
  eachIf,
  eachSvi,
  ensureVlan,
  enterInterface,
  go,
  ipAddress,
  isPoKey,
  isSviKey,
  noInterface,
  noIpAddress,
  noStandby,
  red,
  save,
  setTrunkAllowed,
  setVlanName,
  standby,
  vtySource,
} from './config';
import type { CNode, Ctx, Env } from './parse';
import {
  showCdpNeighbors,
  showCountersErrors,
  showIntTrunk,
  showEtherchannel,
  showInterfaces,
  showIntStatus,
  showIpIntBrief,
  showLogging,
  showRunningConfig,
  showSpanningTree,
  showStandbyBrief,
  showStartupConfig,
  showVlanBrief,
  macOf,
} from './show';

const num = (c: Ctx, k: string) => c.a[k] as number;
const str = (c: Ctx, k: string) => c.a[k] as string;
const list = (c: Ctx, k: string) => c.a[k] as number[];

// ---------- visibility ----------

const tgt = (e: Env) => e.mode.ifs ?? [];
/** Interface-kind checks are permissive when there is no target (canonicalizing text). */
const onSvi = (e: Env) => !tgt(e).length || tgt(e).every(isSviKey);
const onL2able = (e: Env) => !tgt(e).length || tgt(e).every((k) => !isSviKey(k));
const onPhys = (e: Env) => !tgt(e).length || tgt(e).every((k) => !isSviKey(k) && !isPoKey(k));
const priv = (e: Env) => e.mode.level !== 'user';

/** The interface exists (physical ports must; Po and Vlan interfaces are created on demand). */
const ifExistsOrCreatable = (v: unknown, e: Env) => {
  const k = v as string;
  if (!e.nd) return true;
  if (isSviKey(k)) return parseInt(k.slice(4), 10) >= 1 && parseInt(k.slice(4), 10) <= 4094;
  if (isPoKey(k)) return parseInt(k.slice(2), 10) >= 1 && parseInt(k.slice(2), 10) <= 48;
  return k in e.nd.ifs;
};
const ifExists = (v: unknown, e: Env) => {
  const k = v as string;
  if (!e.nd) return true;
  return isSviKey(k) ? parseInt(k.slice(4), 10) in e.nd.svis : k in e.nd.ifs;
};

// ---------- exec ----------

const IFNAME_HELP = { arg: 'ifname', id: 'if', label: 'interface', help: 'Interface name', ko: '포트 이름 (예: gi1/0/5, te1/1/1, po1, vlan 10)' } as const;

const showNode: CNode = {
  kw: 'show',
  help: 'Show running system information',
  ko: '상태 보기 (줄여서 sh)',
  incomplete: '% Type "show ?" for a list of subcommands',
  kids: [
    {
      kw: 'interfaces',
      help: 'Interface status and configuration',
      ko: '포트 상세 상태 (사용률 txload, CRC 오류)',
      run: (c) => c.out.push(...showInterfaces(c.w, c.host, c.nd)),
      kids: [
        { kw: 'status', help: 'Show interface line status', ko: '포트 상태 한눈에 (connected/notconnect/err-disabled, VLAN)', run: (c) => c.out.push(...showIntStatus(c.w, c.host, c.nd)) },
        { kw: 'trunk', help: 'Show interface trunk information', ko: 'trunk 포트와 실어 나르는 VLAN', run: (c) => c.out.push(...showIntTrunk(c.w, c.host, c.nd)) },
        {
          kw: 'counters',
          help: 'Show interface counters',
          ko: '포트 카운터',
          kids: [{ kw: 'errors', help: 'Show interface error counters', ko: '포트별 오류 수 (CRC = 깨진 프레임)', run: (c) => c.out.push(...showCountersErrors(c.nd)) }],
        },
        { ...IFNAME_HELP, check: ifExists, run: (c) => c.out.push(...showInterfaces(c.w, c.host, c.nd, str(c, 'if'))) },
      ],
    },
    {
      kw: 'ip',
      help: 'IP information',
      ko: 'IP 정보',
      kids: [
        {
          kw: 'interface',
          help: 'IP interface status and configuration',
          ko: '포트별 IP',
          kids: [{ kw: 'brief', help: 'Brief summary of IP status and configuration', ko: '포트별 IP와 up/down 요약', run: (c) => c.out.push(...showIpIntBrief(c.w, c.host, c.nd)) }],
        },
      ],
    },
    {
      kw: 'vlan',
      help: 'VTP VLAN status',
      ko: 'VLAN 목록',
      run: (c) => c.out.push(...showVlanBrief(c.nd)),
      kids: [{ kw: 'brief', help: 'VTP all VLAN status in brief', ko: 'VLAN과 거기 속한 포트 요약', run: (c) => c.out.push(...showVlanBrief(c.nd)) }],
    },
    {
      kw: 'etherchannel',
      help: 'EtherChannel information',
      ko: '포트 묶음(LACP) 정보',
      kids: [{ kw: 'summary', help: 'One-line summary per channel-group', ko: '묶음별 한 줄 요약 (P = 묶여서 동작 중)', run: (c) => c.out.push(...showEtherchannel(c.w, c.host, c.nd)) }],
    },
    {
      kw: 'standby',
      help: 'Hot standby protocol information',
      ko: 'HSRP(게이트웨이 이중화) 상태',
      run: (c) => c.out.push(...showStandbyBrief(c.w, c.host, c.nd)),
      kids: [{ kw: 'brief', help: 'Brief output', ko: 'Active/Standby 한 줄 요약', run: (c) => c.out.push(...showStandbyBrief(c.w, c.host, c.nd)) }],
    },
    {
      kw: 'spanning-tree',
      help: 'Spanning tree topology',
      ko: '루프 방지(STP) 상태 (FWD 전달 / BLK 차단)',
      run: (c) => c.out.push(...showSpanningTree(c.w, c.host, c.nd)),
      kids: [
        {
          kw: 'vlan',
          help: 'VLAN Switch Spanning Trees',
          ko: '한 VLAN만 보기',
          kids: [{ arg: 'vlan', id: 'v', label: '<1-4094>', help: 'Spanning tree VLAN id', ko: 'VLAN 번호', run: (c) => c.out.push(...showSpanningTree(c.w, c.host, c.nd, num(c, 'v'))) }],
        },
      ],
    },
    {
      kw: 'version',
      help: 'System hardware and software status',
      ko: '장비 모델과 소프트웨어 버전',
      run: (c) => {
        const d = c.w.devices[c.host];
        const ports = Object.keys(c.nd.ifs).filter((k) => !isPoKey(k));
        c.out.push(
          'KHU NetOS Software, Version 17.9.4',
          'Copyright (c) KHU Data Center Lab (fictional device for training)',
          '',
          `${d.label} uptime is 23 weeks, 4 days, 7 hours, 12 minutes`,
          'System returned to ROM by Reload Command',
          '',
          `${c.nd.model} with 8388608K bytes of memory.`,
          `${ports.filter((k) => k.startsWith('Gi')).length} Gigabit Ethernet interfaces`,
          `${ports.filter((k) => k.startsWith('Te')).length} Ten Gigabit Ethernet interfaces`,
          `${ports.filter((k) => k.startsWith('Hu')).length} Hundred Gigabit Ethernet interfaces`,
          '',
          `Model Number                       : ${c.nd.model}`,
          `Base Ethernet MAC Address          : ${macOf(c.host)}`,
          'Configuration register is 0x102',
        );
      },
    },
    {
      kw: 'cdp',
      help: 'CDP information',
      ko: '옆에 연결된 네트워크 장비 정보',
      kids: [{ kw: 'neighbors', help: 'CDP neighbor entries', ko: '어느 포트에 어떤 장비가 꽂혔는지', run: (c) => c.out.push(...showCdpNeighbors(c.w, c.host, c.nd)) }],
    },
    { kw: 'logging', help: 'Show the contents of logging buffers', ko: '장비 로그(syslog) 보기', run: (c) => c.out.push(...showLogging(c.nd, c.day)) },
    {
      kw: 'running-config',
      help: 'Current operating configuration',
      ko: '지금 돌아가는 설정 전체',
      when: priv,
      run: (c) => c.out.push(...showRunningConfig(c.w.devices[c.host].label, c.nd)),
      kids: [
        {
          kw: 'interface',
          help: 'Show interface configuration',
          ko: '포트 하나의 설정만',
          kids: [{ ...IFNAME_HELP, check: ifExists, run: (c) => c.out.push(...showRunningConfig(c.w.devices[c.host].label, c.nd, str(c, 'if'))) }],
        },
      ],
    },
    {
      kw: 'startup-config',
      help: 'Contents of startup configuration',
      ko: '저장된 설정 (재부팅하면 이걸로 켜져요)',
      when: priv,
      run: (c) => c.out.push(...showStartupConfig(c.w.devices[c.host].label, c.nd)),
    },
  ],
};

function ping(c: Ctx): void {
  const target = str(c, 'host');
  const ip = isIp(target) ? target : resolve(c.w, target, c.host).ip;
  if (!ip) {
    c.out.push(red('% Unrecognized host or address, or protocol not running.'));
    return;
  }
  const r = reach(c.w, c.host, ip);
  const okN = r.ok ? Math.round(5 * (1 - r.loss)) : 0;
  // Deterministic pattern: losses spread out ('!.!!.')
  const marks = Array.from({ length: 5 }, (_, i) => (Math.floor(((i + 1) * okN) / 5) > Math.floor((i * okN) / 5) ? '!' : '.')).join('');
  c.out.push('Type escape sequence to abort.', `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`);
  c.out.push(okN === 5 ? green(marks) : okN === 0 ? yellow(marks) : marks);
  c.out.push(`Success rate is ${okN * 20} percent (${okN}/5)${okN ? ', round-trip min/avg/max = 1/1/2 ms' : ''}`);
}

function clearCounters(c: Ctx): void {
  const only = c.a.if as string | undefined;
  c.out.push(only ? `Clear "show interface" counters on this interface [confirm]` : 'Clear "show interface" counters on all interfaces [confirm]');
  for (const [k, f] of Object.entries(c.nd.ifs)) if (!only || k === only) f.crc = 0;
  log(c.w, c.host, 'CLEAR-5-COUNTERS', `Clear counter on ${only ? `interface ${only}` : 'all interfaces'} by admin on vty0${vtySource(c)}`);
}

const writeNode: CNode = {
  kw: 'write',
  help: 'Write running configuration to memory, network, or terminal',
  ko: '설정 저장 (줄여서 wr)',
  when: priv,
  run: (c) => save(c, false),
  kids: [{ kw: 'memory', help: 'Write to NV memory', ko: '저장 메모리에 쓰기 = 재부팅해도 남음', run: (c) => save(c, false) }],
};

const copyNode: CNode = {
  kw: 'copy',
  help: 'Copy from one file to another',
  ko: '설정 복사 (copy run start = 저장)',
  when: priv,
  kids: [
    {
      kw: 'running-config',
      help: 'Copy from current system configuration',
      ko: '지금 설정에서',
      kids: [{ kw: 'startup-config', help: 'Copy to startup configuration', ko: '저장된 설정으로', run: (c) => save(c, true) }],
    },
  ],
};

const pingNode: CNode = {
  kw: 'ping',
  help: 'Send echo messages',
  ko: '상대가 응답하는지 확인 (! 성공 . 실패)',
  kids: [{ arg: 'word', id: 'host', label: 'WORD', help: 'Ping destination address or hostname', ko: 'IP 주소', run: ping }],
};

const clearNode: CNode = {
  kw: 'clear',
  help: 'Reset functions',
  ko: '초기화',
  when: priv,
  kids: [
    {
      kw: 'counters',
      help: 'Clear counters on one or all interfaces',
      ko: '포트 카운터(CRC 등)를 0으로',
      run: clearCounters,
      kids: [{ ...IFNAME_HELP, check: ifExists, run: clearCounters }],
    },
  ],
};

const decoy = (kw: string, help: string): CNode => ({
  kw,
  help,
  ko: '(이 게임에서는 쓰지 않아요)',
  decoy: true,
  run: (c) => c.out.push(red(`% ${kw}: this command is not available on this device.`)),
});
const DECOYS = [
  decoy('send', 'Send a message to other tty lines'),
  decoy('setup', 'Run the SETUP command facility'),
  decoy('ssh', 'Open a secure shell client connection'),
  decoy('start-chat', 'Start a chat-script on a line'),
  decoy('systat', 'Display information about terminal lines'),
];

const leave = (c: Ctx) => {
  c.next = null;
  c.out.push(dim(`Connection to ${c.w.devices[c.host].label} closed.`));
};

const EXEC_COMMON: CNode[] = [
  { kw: 'exit', help: 'Exit from the EXEC', ko: '장비에서 나가기 (관리 PC로)', run: leave },
  { kw: 'logout', help: 'Exit from the EXEC', ko: '장비에서 나가기 (관리 PC로)', run: leave },
  { kw: 'end', help: 'End', ko: '', exact: true, run: () => {} },
  pingNode,
  showNode,
  ...DECOYS,
];

const USER_ROOT: CNode[] = [{ kw: 'enable', help: 'Turn on privileged commands', ko: '관리자 모드(#)로 들어가기 (줄여서 en)', run: (c) => go(c, 'exec') }, ...EXEC_COMMON];

const EXEC_ROOT: CNode[] = [
  { kw: 'enable', help: 'Turn on privileged commands', ko: '관리자 모드(#)로 들어가기', run: () => {} },
  { kw: 'disable', help: 'Turn off privileged commands', ko: '일반 모드(>)로 돌아가기', run: (c) => go(c, 'user') },
  {
    kw: 'configure',
    help: 'Enter configuration mode',
    ko: '설정 모드로 들어가기 (conf t)',
    run: enterConfig,
    kids: [{ kw: 'terminal', help: 'Configure from the terminal', ko: '이 터미널에서 설정', run: enterConfig }],
  },
  writeNode,
  copyNode,
  clearNode,
  ...EXEC_COMMON,
];

function enterConfig(c: Ctx): void {
  c.out.push('Enter configuration commands, one per line.  End with CNTL/Z.');
  go(c, 'config');
}

/** Exec commands that make sense after `do` (no mode changes). */
const DOABLE = new Set(['show', 'write', 'copy', 'ping', 'clear']);
const DO_KIDS = EXEC_ROOT.filter((n) => n.kw && DOABLE.has(n.kw));

// ---------- config ----------

const doNode: CNode = { kw: 'do', help: 'To run exec commands in config mode', ko: '설정 모드에서 # 명령 실행 (예: do show vlan brief)', kids: DO_KIDS };
const endNode: CNode = { kw: 'end', help: 'Exit from configure mode', ko: '관리자 모드(#)로 바로 돌아가기 (Ctrl+Z)', run: (c) => go(c, 'exec') };

const vlanCfg: CNode = {
  kw: 'vlan',
  help: 'Vlan commands',
  ko: 'VLAN 만들기 / 설정하러 들어가기',
  kids: [
    {
      arg: 'vlanList',
      id: 'vs',
      label: 'WORD',
      help: 'ISL VLAN IDs 1-4094 (e.g. 10 or 10,20,30-32)',
      ko: 'VLAN 번호 (여러 개: 10,20,30-32)',
      run: (c) => createVlans(c, list(c, 'vs')),
      no: (c) => deleteVlans(c, list(c, 'vs')),
    },
  ],
};

const interfaceCfg: CNode = {
  kw: 'interface',
  help: 'Select an interface to configure',
  ko: '포트(인터페이스) 설정하러 들어가기 (줄여서 int)',
  kids: [
    {
      kw: 'range',
      help: 'interface range command',
      ko: '여러 포트를 한 번에 설정 (예: range gi1/0/1 - 4)',
      kids: [
        {
          arg: 'ifrange',
          id: 'ifs',
          label: 'LINE',
          help: 'Interfaces, e.g. GigabitEthernet1/0/1 - 4 , GigabitEthernet1/0/7',
          ko: '포트 범위',
          check: (v, e) => !e.nd || (v as string).split(',').every((k) => ifExists(k, e)),
          run: (c) => go(c, 'config-if', { ifs: str(c, 'ifs').split(',') }),
        },
      ],
    },
    { ...IFNAME_HELP, check: ifExistsOrCreatable, run: (c) => enterInterface(c, str(c, 'if')), no: (c) => noInterface(c, str(c, 'if')) },
  ],
};

const stpGlobal: CNode = {
  kw: 'spanning-tree',
  help: 'Spanning Tree Subsystem',
  ko: '루프 방지(STP) 설정',
  kids: [
    {
      kw: 'vlan',
      help: 'VLAN Switch Spanning Tree',
      ko: 'VLAN별로 STP 켜기 (no 를 붙이면 끄기)',
      kids: [
        {
          arg: 'vlanList',
          id: 'vs',
          label: 'WORD',
          help: 'vlan range, example: 1,3-5,7,9-11',
          ko: 'VLAN 번호',
          run: (c) => {
            c.nd.stpOff = c.nd.stpOff.filter((v) => !list(c, 'vs').includes(v));
            dirty(c);
          },
          no: (c) => {
            c.nd.stpOff = [...new Set([...c.nd.stpOff, ...list(c, 'vs')])].sort((a, b) => a - b);
            dirty(c);
          },
        },
      ],
    },
  ],
};

/** Config-level commands that also take `no`. */
const CONFIG_NOABLE: CNode[] = [interfaceCfg, vlanCfg, stpGlobal];

const CONFIG_ROOT: CNode[] = [
  doNode,
  endNode,
  { kw: 'exit', help: 'Exit from configure mode', ko: '한 단계 위로 (# 모드)', run: (c) => go(c, 'exec') },
  ...CONFIG_NOABLE,
  { kw: 'no', help: 'Negate a command or set its defaults', ko: '설정 되돌리기 (예: no shutdown)', kids: CONFIG_NOABLE },
];

// ---------- config-if ----------

const switchportNode: CNode = {
  kw: 'switchport',
  help: 'Set switching mode characteristics',
  ko: '스위치 포트(L2) 설정 (줄여서 sw)',
  when: onL2able,
  run: (c) =>
    eachIf(c, (f) => {
      if (f.mode === 'routed') {
        f.mode = 'access';
        delete f.ip;
      }
    }),
  no: (c) =>
    eachIf(c, (f) => {
      f.mode = 'routed';
    }),
  kids: [
    {
      kw: 'mode',
      help: 'Set trunking mode of the interface',
      ko: '포트 종류 정하기',
      kids: [
        { kw: 'access', help: 'Set trunking mode to ACCESS unconditionally', ko: 'access: VLAN 하나만 (서버·PC 연결용)', run: (c) => eachIf(c, (f) => (f.mode = 'access'), true) },
        { kw: 'trunk', help: 'Set trunking mode to TRUNK unconditionally', ko: 'trunk: 여러 VLAN을 실어 나름 (스위치끼리)', run: (c) => eachIf(c, (f) => (f.mode = 'trunk'), true) },
      ],
    },
    {
      kw: 'access',
      help: 'Set access mode characteristics of the interface',
      ko: 'access 포트 설정',
      kids: [
        {
          kw: 'vlan',
          help: 'Set VLAN when interface is in access mode',
          ko: '이 포트를 어느 VLAN에 넣을지',
          no: (c) => eachIf(c, (f) => (f.accessVlan = 1), true),
          kids: [
            {
              arg: 'vlan',
              id: 'v',
              label: '<1-4094>',
              help: 'VLAN ID of the VLAN when this port is in access mode',
              ko: 'VLAN 번호',
              run: (c) => {
                ensureVlan(c, num(c, 'v'), true);
                eachIf(c, (f) => (f.accessVlan = num(c, 'v')), true);
              },
            },
          ],
        },
      ],
    },
    {
      kw: 'trunk',
      help: 'Set trunking characteristics of the interface',
      ko: 'trunk 포트 설정',
      kids: [
        {
          kw: 'allowed',
          help: 'Set allowed VLAN characteristics when interface is in trunking mode',
          ko: '실어 나를 VLAN 목록',
          kids: [
            {
              kw: 'vlan',
              help: 'Set allowed VLANs when interface is in trunking mode',
              ko: '허용 VLAN',
              no: (c) => setTrunkAllowed(c, 'all'),
              kids: [
                { arg: 'vlanList', id: 'vs', label: 'WORD', help: 'VLAN IDs of the allowed VLANs when this port is in trunking mode', ko: '이 목록으로 바꾸기 (예: 10,20)', run: (c) => setTrunkAllowed(c, 'set', list(c, 'vs')) },
                {
                  kw: 'add',
                  help: 'add VLANs to the current list',
                  ko: '목록에 더하기',
                  kids: [{ arg: 'vlanList', id: 'vs', label: 'WORD', help: 'VLAN IDs', ko: 'VLAN 번호', run: (c) => setTrunkAllowed(c, 'add', list(c, 'vs')) }],
                },
                {
                  kw: 'remove',
                  help: 'remove VLANs from the current list',
                  ko: '목록에서 빼기',
                  kids: [{ arg: 'vlanList', id: 'vs', label: 'WORD', help: 'VLAN IDs', ko: 'VLAN 번호', run: (c) => setTrunkAllowed(c, 'remove', list(c, 'vs')) }],
                },
                { kw: 'all', help: 'all VLANs', ko: '모든 VLAN', run: (c) => setTrunkAllowed(c, 'all') },
                { kw: 'none', help: 'no VLANs', ko: '아무 VLAN도 안 실음', run: (c) => setTrunkAllowed(c, 'none') },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const channelNode: CNode = {
  kw: 'channel-group',
  help: 'Etherchannel/port bundling configuration',
  ko: '여러 포트를 하나로 묶기 (LACP)',
  when: onPhys,
  no: (c) =>
    eachIf(c, (f) => {
      delete f.group;
      delete f.chMode;
    }),
  kids: [
    {
      arg: 'int',
      id: 'n',
      min: 1,
      max: 48,
      label: '<1-48>',
      help: 'Channel group number',
      ko: '묶음 번호 (Port-channel 번호)',
      kids: [
        {
          kw: 'mode',
          help: 'Etherchannel Mode of the interface',
          ko: '묶는 방식',
          kids: [
            { kw: 'active', help: 'Enable LACP unconditionally', ko: 'LACP로 먼저 협상 (보통 이것)', run: (c) => channelGroup(c, num(c, 'n'), 'active') },
            { kw: 'passive', help: 'Enable LACP only if a LACP device is detected', ko: '상대가 협상하면 응함', run: (c) => channelGroup(c, num(c, 'n'), 'passive') },
            { kw: 'on', help: 'Enable Etherchannel only', ko: '협상 없이 강제로 묶기', run: (c) => channelGroup(c, num(c, 'n'), 'on') },
          ],
        },
      ],
    },
  ],
};

const ipIfNode: CNode = {
  kw: 'ip',
  help: 'Interface Internet Protocol config commands',
  ko: 'IP 설정',
  kids: [
    {
      kw: 'address',
      help: 'Set the IP address of an interface',
      ko: '이 인터페이스의 IP 주소',
      no: noIpAddress,
      kids: [
        {
          arg: 'ip',
          id: 'ip',
          label: 'A.B.C.D',
          help: 'IP address',
          ko: 'IP 주소',
          kids: [{ arg: 'mask', id: 'mask', label: 'A.B.C.D', help: 'IP subnet mask', ko: '서브넷 마스크 (예: 255.255.255.0 = /24)', run: (c) => ipAddress(c, str(c, 'ip'), str(c, 'mask')) }],
        },
      ],
    },
    {
      kw: 'helper-address',
      help: 'Specify a destination address for UDP broadcasts',
      ko: 'DHCP 요청을 DHCP 서버로 전달 (릴레이)',
      when: onSvi,
      no: (c) => eachSvi(c, (s) => delete s.helper),
      kids: [{ arg: 'ip', id: 'ip', label: 'A.B.C.D', help: 'IP destination address', ko: 'DHCP 서버 주소', run: (c) => eachSvi(c, (s) => (s.helper = str(c, 'ip'))) }],
    },
  ],
};

const standbyNode: CNode = {
  kw: 'standby',
  help: 'HSRP interface configuration commands',
  ko: 'HSRP: 두 장비가 게이트웨이 주소 하나를 나눠 맡기',
  when: onSvi,
  kids: [
    {
      arg: 'int',
      id: 'g',
      min: 0,
      max: 255,
      label: '<0-255>',
      help: 'group number',
      ko: '그룹 번호 (양쪽이 같아야 함)',
      no: (c) => noStandby(c, num(c, 'g')),
      kids: [
        {
          kw: 'ip',
          help: 'Enable HSRP and set the virtual IP address',
          ko: '가상 게이트웨이 주소(VIP)',
          no: (c) => standby(c, num(c, 'g'), { vip: '' }),
          kids: [{ arg: 'ip', id: 'vip', label: 'A.B.C.D', help: 'Virtual IP address', ko: '가상 IP', run: (c) => standby(c, num(c, 'g'), { vip: str(c, 'vip') }) }],
        },
        {
          kw: 'priority',
          help: 'Priority level',
          ko: '우선순위 (높은 쪽이 Active, 기본 100)',
          no: (c) => standby(c, num(c, 'g'), { priority: 100 }),
          kids: [{ arg: 'int', id: 'p', min: 0, max: 255, label: '<0-255>', help: 'Priority value', ko: '우선순위 값', run: (c) => standby(c, num(c, 'g'), { priority: num(c, 'p') }) }],
        },
        {
          kw: 'preempt',
          help: 'Overthrow lower priority Active routers',
          ko: '우선순위가 높으면 Active를 되찾아 옴',
          run: (c) => standby(c, num(c, 'g'), { preempt: true }),
          no: (c) => standby(c, num(c, 'g'), { preempt: false }),
        },
      ],
    },
  ],
};

const shutdownNode: CNode = {
  kw: 'shutdown',
  help: 'Shutdown the selected interface',
  ko: '포트 끄기 (no shutdown = 켜기)',
  run: (c) => {
    eachIf(c, (f) => {
      f.shutdown = true;
      // shut clears err-disable (then no shut brings it back)
      f.errDisabled = null;
    });
    eachSvi(c, (s) => (s.shutdown = true));
  },
  no: (c) => {
    eachIf(c, (f) => (f.shutdown = false));
    eachSvi(c, (s) => (s.shutdown = false));
  },
};

const stpIfNode: CNode = {
  kw: 'spanning-tree',
  help: 'Spanning Tree Subsystem',
  ko: '이 포트의 STP 옵션',
  when: onL2able,
  kids: [
    {
      kw: 'bpduguard',
      help: "Don't accept BPDUs on this interface",
      ko: '스위치가 꽂히면 포트를 꺼버림 (서버용 포트 보호)',
      no: (c) => eachIf(c, (f) => (f.bpduguard = false)),
      kids: [
        { kw: 'enable', help: 'Enable BPDU guard for this interface', ko: '켜기', run: (c) => eachIf(c, (f) => (f.bpduguard = true)) },
        { kw: 'disable', help: 'Disable BPDU guard for this interface', ko: '끄기', run: (c) => eachIf(c, (f) => (f.bpduguard = false)) },
      ],
    },
  ],
};

const descNode: CNode = {
  kw: 'description',
  help: 'Interface specific description',
  ko: '포트 메모 (어디에 연결됐는지)',
  when: onL2able,
  no: (c) => eachIf(c, (f) => delete f.desc),
  kids: [{ arg: 'line', id: 'text', label: 'LINE', help: 'Up to 200 characters describing this interface', ko: '메모 내용', run: (c) => eachIf(c, (f) => (f.desc = str(c, 'text').slice(0, 200))) }],
};

const IF_NOABLE: CNode[] = [channelNode, descNode, ipIfNode, shutdownNode, stpIfNode, standbyNode, switchportNode];

const exitToConfig: CNode = { kw: 'exit', help: 'Exit from interface configuration mode', ko: '한 단계 위로 (config 모드)', run: (c) => go(c, 'config') };

const IF_ROOT: CNode[] = [
  doNode,
  endNode,
  exitToConfig,
  ...IF_NOABLE,
  { kw: 'no', help: 'Negate a command or set its defaults', ko: '설정 되돌리기 (예: no shutdown)', kids: IF_NOABLE },
];

// ---------- config-vlan ----------

const nameNode: CNode = {
  kw: 'name',
  help: 'Ascii name of the VLAN',
  ko: 'VLAN 이름 붙이기',
  no: (c) => setVlanName(c, null),
  kids: [{ arg: 'word', id: 'name', label: 'WORD', help: 'The ascii name for the VLAN', ko: '이름 (띄어쓰기 없이)', run: (c) => setVlanName(c, str(c, 'name')) }],
};

const VLAN_ROOT: CNode[] = [
  doNode,
  endNode,
  { kw: 'exit', help: 'Apply changes, bump revision number, and exit mode', ko: '한 단계 위로 (config 모드)', run: (c) => go(c, 'config') },
  nameNode,
  { kw: 'no', help: 'Negate a command or set its defaults', ko: '되돌리기', kids: [nameNode] },
];

export const ROOTS: Record<IosLevel, CNode[]> = {
  user: USER_ROOT,
  exec: EXEC_ROOT,
  config: CONFIG_ROOT,
  'config-if': IF_ROOT,
  'config-vlan': VLAN_ROOT,
};

