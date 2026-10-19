import {
  addressOf,
  devicesWithIp,
  isIp,
  isLoopback,
  l1Path,
  linkUp,
  networkOf,
  onWire,
  ping,
  powered,
  resolveName,
  sameSubnet,
} from '../network';
import type { World } from '../types';
import { own } from '../util';
import type { CmdResult, Command } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

function requireL3(host: string, w: World) {
  return own(w.devices, host)?.l3 ? null : err(`${host}: 이 장비에는 IP 설정이 없어요.`);
}

/** Does this world model cabling for the device (so "can I reach it over the wire?" is a fair question)? */
function cabled(w: World, id: string): boolean {
  const d = own(w.devices, id);
  return !!d && Object.values(w.cables).some((c) => d.ports.some((p) => c.a === `${id}:${p}` || c.b === `${id}:${p}`));
}

/** Stages 2–3 have rack consoles to fall back on; later stages just say the network can't reach it. */
const sshTimeout = (target: string, console: boolean): CmdResult => ({
  lines: [
    red(`ssh: connect to host ${target} port 22: Connection timed out`),
    dim(console ? '(네트워크로는 닿지 않아요. 서버 랙 앞에 직접 가서 콘솔로 접속해 볼 수 있어요)' : '(네트워크로는 닿지 않아요)'),
  ],
});

const PING_VALUE_FLAGS = new Set(['-c', '-i', '-W', '-w', '-t', '-s']);

export const netCommands: Command[] = [
  {
    name: 'ip addr',
    maxStage: 3,
    aliases: ['ip a', 'ifconfig'],
    minStage: 2,
    usage: 'ip addr',
    summary: '이 장비의 IP 주소·게이트웨이·링크 상태 보기',
    run(_args, { w, host }) {
      const d = own(w.devices, host);
      if (!d) return err('알 수 없는 장비');
      const a = addressOf(w, host);
      const up = d.ports.some((p) => linkUp(w, host, p));
      // The router sits on both sides (inside network and internet), so it has no gateway of its own.
      const gw = d.kind === 'router' ? dim('(라우터 자신 · 인터넷과 직접 연결)') : (a.gw ?? red('(없음)'));
      const mode = d.l3?.mode;
      const modeNote = mode === 'dhcp' ? dim('  (자동으로 받은 주소)') : mode === 'static' ? dim('  (손으로 정한 고정 주소)') : '';
      return out(
        `${bold('eth0')}: link ${up ? green('UP') : red('DOWN')}${dim('  (케이블 연결 상태)')}`,
        `    inet    ${a.ip ? `${a.ip}/${a.mask}` : red('(주소 없음)')}${dim('  (이 장비의 IP 주소)')}`,
        `    gateway ${gw}${d.kind === 'router' ? '' : dim('  (밖으로 나가는 문)')}`,
        `    mode    ${mode ?? '-'}${modeNote}`,
      );
    },
  },
  {
    name: 'ip set',
    maxStage: 3,
    minStage: 2,
    usage: 'ip set dhcp | ip set static <ip> | ip set gw <ip>',
    summary: 'IP를 DHCP로 자동으로 받거나, 고정 IP·게이트웨이(밖으로 나가는 문)를 직접 설정',
    run(args, { w, host }) {
      const bad = requireL3(host, w);
      if (bad) return bad;
      const d = w.devices[host];
      if (d.kind === 'router') {
        return err('라우터 주소는 네트워크 전체의 "출입문"이라 여기서는 바꾸지 않아요. 서버 쪽 설정을 확인해 보세요.');
      }
      const l3 = d.l3!;
      const [what, value] = args;
      if (what === 'dhcp') {
        // Asking for a new lease drops the old address and gateway until the DHCP server answers.
        l3.mode = 'dhcp';
        l3.ip = null;
        l3.gw = null;
        const lines = [green('DHCP 모드로 바꿨어요. 안내데스크(DHCP 서버)에서 주소를 받아요.')];
        if (!w.net?.dhcpServer) lines.push(dim('(그런데 지금 DHCP 서버가 꺼져 있어서 주소를 못 받아요)'));
        return { lines, events: [`ip_dhcp:${host}`] };
      }
      if (what === 'static' && value && isIp(value)) {
        l3.mode = 'static';
        l3.ip = value;
        const lines = [green(`고정 IP ${value} 로 설정했어요.`)];
        const net = w.net;
        if (net && !sameSubnet(value, net.routerIp, net.mask)) {
          lines.push(dim(`(주의: 이 네트워크는 ${networkOf(net.routerIp, net.mask)} 예요. 그 밖의 주소면 라우터가 이 장비로 오는 길을 몰라요)`));
        }
        if (devicesWithIp(w, value).some((o) => o.id !== host && onWire(w, o))) {
          lines.push(yellow('(경고: 이 주소를 이미 쓰고 있는 장비가 있어요. 주소 충돌!)'));
        }
        return { lines, events: [`ip_static:${host}`] };
      }
      if ((what === 'gw' || what === 'gateway') && value && isIp(value)) {
        l3.gw = value;
        const lines = [green(`게이트웨이를 ${value} 로 설정했어요.`)];
        if (l3.mode === 'dhcp' && w.net?.dhcpServer) lines.push(dim('(DHCP 모드라서 안내데스크가 준 값으로 곧 다시 바뀌어요)'));
        return { lines, events: [`gw_set:${host}`] };
      }
      return err('사용법: ip set dhcp | ip set static <ip> | ip set gw <ip>');
    },
  },
  {
    name: 'ping',
    minStage: 2,
    usage: 'ping <이름 또는 IP>',
    summary: '상대에게 신호를 보내 응답이 오는지 확인',
    run(args, { w, host }) {
      // "ping -c 3 web": skip flags and the value of flags that take one.
      const target = args.find((a, i) => !a.startsWith('-') && !PING_VALUE_FLAGS.has(args[i - 1]));
      if (!target) return err('사용법: ping <이름 또는 IP>');
      if (!w.net && !isLoopback(target)) {
        // Later stages don't model addresses; send the player to the tool that shows machine health there.
        const tool = w.k8s ? '노드 상태는 nodes, pod 상태는 pods' : '서버·컨테이너 상태는 docker ps';
        return {
          lines: [yellow('ping: 이 단계에서는 장비 IP 주소를 직접 다루지 않아요.'), dim(`(${tool} 로 확인해요)`)],
          events: [`ping:${target}:n/a`],
        };
      }
      const r = ping(w, host, target);
      const ip = r.targetIp ?? resolveName(w, target) ?? target;
      const lines = [`PING ${target} (${ip}): 56 data bytes`];
      const events = [`ping:${target}:${r.ok ? 'ok' : r.failure}`];
      switch (r.failure) {
        case 'unknown_host':
          return { lines: [red(`ping: cannot resolve ${target}: Unknown host`), dim('(이름을 IP 주소로 바꾸지 못했어요)')], events };
        case 'no_ip':
          return { lines: [red('ping: sendto: No route to host'), dim('(이 장비에 IP 주소가 없어요)')], events };
        case 'no_power':
          return { lines: [red('장비 전원이 꺼져 있어요.')], events };
        case 'no_route':
          for (let i = 0; i < 3; i++) lines.push(red(`Request timeout for icmp_seq ${i}`));
          lines.push(dim('(그 주소를 가진 장비를 찾지 못했어요)'));
          return { lines, events };
        case 'link':
        case 'gateway':
          for (let i = 0; i < 3; i++) lines.push(red(`Request timeout for icmp_seq ${i}`));
          lines.push(`--- ${target} ping statistics ---`, red('3 packets transmitted, 0 received, 100% packet loss'), dim('(보낸 신호 3개가 하나도 안 돌아왔어요)'));
          return { lines, events };
      }
      const received = r.failure === 'conflict' ? [0, 2] : [0, 1, 2];
      for (let i = 0; i < 3; i++) {
        if (received.includes(i)) lines.push(`64 bytes from ${ip}: icmp_seq=${i} ttl=64 time=${(0.3 + i * 0.07).toFixed(2)} ms`);
        else lines.push(red(`Request timeout for icmp_seq ${i}`));
      }
      const loss = Math.round((1 - received.length / 3) * 100);
      lines.push(`--- ${target} ping statistics ---`, `3 packets transmitted, ${received.length} received, ${loss}% packet loss`);
      if (r.failure === 'conflict') lines.push(dim('(응답이 들쭉날쭉해요… 같은 주소를 쓰는 장비가 둘?)'));
      return { lines, events };
    },
  },
  {
    name: 'dhcp',
    maxStage: 3,
    minStage: 2,
    usage: 'dhcp status | dhcp on | dhcp off',
    summary: 'DHCP 서버(주소 나눠주는 안내데스크) 켜기·끄기',
    run(args, { w }) {
      if (!w.net) return err('이 데이터센터에는 아직 네트워크 설정이 없어요.');
      const sub = args[0] ?? 'status';
      if (sub === 'on') {
        w.net.dhcpServer = true;
        return { lines: [green('DHCP 서버 시작! 이제 DHCP 모드 장비들이 자동으로 주소를 받아요.')], events: ['dhcp_enabled'] };
      }
      if (sub === 'off') {
        w.net.dhcpServer = false;
        return out(green('DHCP 서버를 껐어요.'), dim('(이미 받은 주소는 그대로 써요. 새로 주소를 받으려는 장비만 못 받아요)'));
      }
      if (sub !== 'status') return err('사용법: dhcp status | dhcp on | dhcp off');
      const leases = Object.entries(w.net.dhcpLeases)
        .filter(([id]) => own(w.devices, id)?.l3?.mode === 'dhcp' && own(w.devices, id)?.l3?.ip)
        .map(([id, ip]) => `  ${id.padEnd(8)} ${ip}`);
      return out(`DHCP 서버: ${w.net.dhcpServer ? green('ON') : red('OFF')}`, '나눠준 주소:', ...(leases.length ? leases : [dim('  (없음)')]));
    },
  },
  {
    name: 'dns list',
    maxStage: 3,
    aliases: ['dns'],
    minStage: 2,
    usage: 'dns list',
    summary: 'DNS 장부(이름 → IP 전화번호부) 보기',
    run(_a, { w }) {
      if (!w.net) return err('DNS 없음');
      const rows = Object.entries(w.net.dns).map(([n, ip]) => `  ${n.padEnd(12)} ${ip}`);
      return out(bold('이름          IP'), ...(rows.length ? rows : [dim('  (비어 있음)')]));
    },
  },
  {
    name: 'dns add',
    maxStage: 3,
    minStage: 2,
    usage: 'dns add <이름> <IP>',
    summary: 'DNS 장부에 이름 등록',
    run(args, { w }) {
      const [name, ip] = args;
      const net = w.net;
      if (!net || !name || !/^[a-z0-9][a-z0-9.-]*$/i.test(name) || !ip || !isIp(ip)) return err('사용법: dns add <이름> <IP>');
      net.dns[name] = ip;
      const lines = [green(`등록했어요: ${name} → ${ip}`)];
      // A friendly sanity check for addresses inside our own network.
      if (sameSubnet(ip, net.routerIp, net.mask)) {
        const users = devicesWithIp(w, ip).filter((d) => onWire(w, d));
        if (users.length === 0) lines.push(dim(`(참고: 지금 ${ip} 를 쓰는 장비는 없어요)`));
        else if (!users.some((d) => d.id === name)) lines.push(dim(`(참고: ${ip} 는 지금 ${users.map((d) => d.id).join(', ')} 장비의 주소예요)`));
      }
      return { lines, events: [`dns_add:${name}`] };
    },
  },
  {
    name: 'dns del',
    maxStage: 3,
    minStage: 2,
    usage: 'dns del <이름>',
    summary: 'DNS 장부에서 이름 지우기',
    run(args, { w }) {
      const name = args[0];
      if (!w.net || !name || own(w.net.dns, name) === undefined) return err('그런 이름은 장부에 없어요.');
      delete w.net.dns[name];
      return ok(`${name} 를 지웠어요.`);
    },
  },
  {
    name: 'ssh',
    minStage: 2,
    usage: 'ssh <이름 또는 IP>',
    summary: '다른 장비에 원격 접속 (멀리서 들어가 조작하기)',
    run(args, { w, host, stage }) {
      const target = args[0];
      if (!target) return err('사용법: ssh <이름 또는 IP>');
      if (isLoopback(target)) return out(dim('이미 그 장비에 있어요.'));
      let id: string;
      if (w.net) {
        // ssh goes over the network exactly like ping: name → DNS → address → the machine that answers.
        const p = ping(w, host, target);
        if (p.failure === 'unknown_host') return { lines: [red(`ssh: Could not resolve hostname ${target}`), dim('(DNS 장부에 없는 이름이에요)')] };
        if (p.failure === 'no_ip') return { lines: [red('ssh: connect: No route to host'), dim('(이 장비에 IP 주소가 없어요)')] };
        if (p.failure === 'no_power') return err('장비 전원이 꺼져 있어요.');
        if (p.targetId && !powered(w, p.targetId)) return err(`ssh: ${target} 전원이 꺼져 있어요.`);
        if (!p.ok || !p.targetId) return sshTimeout(target, stage <= 3);
        if (own(w.devices, p.targetId)?.kind === 'internet') return err(`ssh: ${target} 는 우리 장비가 아니라서 접속할 수 없어요.`);
        id = p.targetId;
      } else {
        // No addresses in this world: machines are reached by name.
        const d = own(w.devices, target);
        if (!d || d.kind === 'internet') return err(`ssh: Could not resolve hostname ${target}`);
        id = d.id;
        // Where the world models cabling, a machine you can't reach over the wire can't be logged into.
        if (id !== host && cabled(w, id) && cabled(w, host)) {
          if (!powered(w, id)) return err(`ssh: ${target} 전원이 꺼져 있어요.`);
          if (!l1Path(w, host, id)) return sshTimeout(target, false);
        }
      }
      if (id === host) return out(dim('이미 그 장비에 있어요.'));
      return { lines: [green(`${target} 에 접속했어요. (돌아가려면 exit)`)], host: id, events: [`ssh:${id}`] };
    },
  },
  {
    name: 'exit',
    aliases: ['logout'],
    minStage: 2,
    usage: 'exit',
    summary: '관리 PC(ops)로 돌아가기',
    run(_a, { host }) {
      if (host === 'ops') return out(dim('이미 관리 PC(ops)예요.'));
      return { lines: [dim('연결을 끊었어요.')], host: 'ops' };
    },
  },
  {
    name: 'hostname',
    aliases: ['whoami'],
    minStage: 1,
    usage: 'hostname',
    summary: '지금 어느 장비에 있는지',
    run(_a, { host }) {
      return out(host);
    },
  },
];
