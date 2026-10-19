import { addressOf, isIp, l1Path, linkUp, ping, powered, resolveName } from '../network';
import type { Command } from './types';
import { bold, dim, err, green, ok, out, red } from './types';

function requireL3(host: string, w: import('../types').World) {
  return w.devices[host]?.l3 ? null : err(`${host}: 이 장비에는 IP 설정이 없어요.`);
}

export const netCommands: Command[] = [
  {
    name: 'ip addr',
    maxStage: 3,
    aliases: ['ip a', 'ifconfig'],
    minStage: 2,
    usage: 'ip addr',
    summary: '이 장비의 IP 주소·게이트웨이·링크 상태 보기',
    run(_args, { w, host }) {
      const d = w.devices[host];
      if (!d) return err('알 수 없는 장비');
      const a = addressOf(w, host);
      const up = d.ports.some((p) => linkUp(w, host, p));
      return out(
        `${bold('eth0')}: link ${up ? green('UP') : red('DOWN')}`,
        `    inet    ${a.ip ? `${a.ip}/${a.mask}` : red('(주소 없음)')}`,
        `    gateway ${a.gw ?? red('(없음)')}`,
        `    mode    ${d.l3?.mode ?? '-'}`,
      );
    },
  },
  {
    name: 'ip set',
    maxStage: 3,
    minStage: 2,
    usage: 'ip set dhcp | ip set static <ip> | ip set gw <ip>',
    summary: 'IP를 DHCP로 받거나, 고정 IP·게이트웨이를 직접 설정',
    run(args, { w, host }) {
      const bad = requireL3(host, w);
      if (bad) return bad;
      const l3 = w.devices[host].l3!;
      const [what, value] = args;
      if (what === 'dhcp') {
        l3.mode = 'dhcp';
        l3.ip = null;
        return { lines: [green('DHCP 모드로 바꿨어요. 안내데스크(DHCP 서버)에서 주소를 받아요.')], events: [`ip_dhcp:${host}`] };
      }
      if (what === 'static' && value && isIp(value)) {
        l3.mode = 'static';
        l3.ip = value;
        return ok(`고정 IP ${value} 로 설정했어요.`);
      }
      if ((what === 'gw' || what === 'gateway') && value && isIp(value)) {
        l3.gw = value;
        return { lines: [green(`게이트웨이를 ${value} 로 설정했어요.`)], events: [`gw_set:${host}`] };
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
      const target = args[0];
      if (!target) return err('사용법: ping <이름 또는 IP>');
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
          lines.push(`--- ${target} ping statistics ---`, red('3 packets transmitted, 0 received, 100% packet loss'));
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
        return ok('DHCP 서버를 껐어요.');
      }
      const leases = Object.entries(w.net.dhcpLeases)
        .filter(([id]) => w.devices[id]?.l3?.mode === 'dhcp' && w.devices[id]?.l3?.ip)
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
      if (!w.net || !name || !ip || !isIp(ip)) return err('사용법: dns add <이름> <IP>');
      w.net.dns[name] = ip;
      return { lines: [green(`등록했어요: ${name} → ${ip}`)], events: [`dns_add:${name}`] };
    },
  },
  {
    name: 'dns del',
    maxStage: 3,
    minStage: 2,
    usage: 'dns del <이름>',
    summary: 'DNS 장부에서 이름 지우기',
    run(args, { w }) {
      if (!w.net || !args[0] || !(args[0] in w.net.dns)) return err('그런 이름은 장부에 없어요.');
      delete w.net.dns[args[0]];
      return ok(`${args[0]} 를 지웠어요.`);
    },
  },
  {
    name: 'ssh',
    minStage: 2,
    usage: 'ssh <장비이름>',
    summary: '다른 장비에 원격 접속',
    run(args, { w, host, stage }) {
      const target = args[0];
      if (!target) return err('사용법: ssh <장비이름>');
      const id = Object.keys(w.devices).find((k) => k === target) ?? null;
      if (!id) return err(`ssh: Could not resolve hostname ${target}`);
      if (id === host) return out(dim('이미 그 장비에 있어요.'));
      if (stage <= 3) {
        const p = ping(w, host, resolveName(w, target) ?? target);
        if (!powered(w, id)) return err(`ssh: ${target} 전원이 꺼져 있어요.`);
        if (!p.ok && !l1Path(w, host, id)) return err(`ssh: connect to host ${target} port 22: Connection timed out`);
      }
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
