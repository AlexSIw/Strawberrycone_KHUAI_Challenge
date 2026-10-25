import {
  addressOf,
  isIp,
  isLoopback,
  l1Path,
  linkUp,
  ping,
  powered,
  resolveName,
} from '../network';
import type { World } from '../types';
import { own } from '../util';
import type { CmdResult, Command } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

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
    aliases: ['ip a', 'ifconfig'],
    minStage: 1,
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
    name: 'ping',
    minStage: 1,
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
    name: 'dns list',
    aliases: ['dns'],
    minStage: 1,
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
    minStage: 1,
    usage: 'dns add <이름> <IP>',
    summary: 'DNS 장부에 이름 등록',
    run(args, { w }) {
      const [name, ip] = args;
      const net = w.net;
      if (!net || !name || !/^[a-z0-9][a-z0-9.-]*$/i.test(name) || !ip || !isIp(ip)) return err('사용법: dns add <이름> <IP>');
      net.dns[name] = ip;
      const lines = [green(`등록했어요: ${name} → ${ip}`)];
      return { lines, events: [`dns_add:${name}`] };
    },
  },
  {
    name: 'dns del',
    minStage: 1,
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
    minStage: 1,
    usage: 'ssh <이름 또는 IP>',
    summary: '다른 장비에 원격 접속 (멀리서 들어가 조작하기)',
    run(args, { w, host }) {
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
        if (!p.ok || !p.targetId) return sshTimeout(target, true);
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
      // Network gear answers with its IOS login: user mode (Switch>), `enable` for privileged.
      if (w.devices[id].nd?.os === 'ios') {
        return { lines: [green(`${w.devices[id].label} 에 접속했어요. (돌아가려면 exit)`), ''], host: id, mode: { level: 'user' }, events: [`ssh:${id}`] };
      }
      return { lines: [green(`${target} 에 접속했어요. (돌아가려면 exit)`)], host: id, mode: null, events: [`ssh:${id}`] };
    },
  },
  {
    name: 'exit',
    aliases: ['logout'],
    minStage: 1,
    usage: 'exit',
    summary: '관리 PC(ops)로 돌아가기',
    run(_a, { host }) {
      if (host === 'ops') return out(dim('이미 관리 PC(ops)예요.'));
      return { lines: [dim('연결을 끊었어요.')], host: 'ops', mode: null };
    },
  },
  {
    name: 'hostname',
    aliases: ['whoami'],
    minStage: 0,
    usage: 'hostname',
    summary: '지금 어느 장비에 있는지',
    run(_a, { host }) {
      return out(host);
    },
  },
];
