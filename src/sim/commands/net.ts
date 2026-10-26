import {
  addressOf,
  deviceByName,
  dnsServerFor,
  isIp,
  isLoopback,
  l1Path,
  linkUp,
  powered,
  reach,
  resolve,
  sameSubnet,
  utilization,
  vlanOf,
  type ReachResult,
} from '../network';
import type { World } from '../types';
import { own } from '../util';
import type { CmdResult, Command } from './types';
import { bold, dim, err, green, out, red, yellow } from './types';

/** Does this world model cabling for the device (so "can I reach it over the wire?" is a fair question)? */
function cabled(w: World, id: string): boolean {
  const d = own(w.devices, id);
  return !!d && Object.values(w.cables).some((c) => d.ports.some((p) => c.a === `${id}:${p}` || c.b === `${id}:${p}`));
}

const sshTimeout = (target: string): CmdResult => ({
  lines: [red(`ssh: connect to host ${target} port 22: Connection timed out`), dim('(기다려도 대답이 없어요. 네트워크로는 그 장비에 닿지 않아요)')],
});

const PING_VALUE_FLAGS = new Set(['-c', '-i', '-W', '-w', '-t', '-s', '-I']);
const PINGS = 5;

/** Routers along the way (what traceroute shows): cores, campus switches, firewalls, border routers. */
function isL3Hop(w: World, id: string): boolean {
  const d = own(w.devices, id);
  if (!d?.nd) return false;
  if (d.kind === 'router' || d.kind === 'firewall') return true;
  return d.kind === 'switch' && (Object.values(d.nd.svis).some((s) => s.ip) || Object.values(d.nd.ifs).some((f) => f.mode === 'routed'));
}

/** Hop labels and the device ids behind them, without the source. */
const l3Hops = (w: World, r: ReachResult) => r.hops.slice(1).filter((h, i, a) => isL3Hop(w, h) && a.indexOf(h) === i);

const label = (w: World, id: string) => (id === 'internet' ? 'internet' : (own(w.devices, id)?.label ?? id));

/** Round-trip time: a little per hop, a lot more when a link on the way is congested. */
function rtt(w: World, r: ReachResult, seq: number): string {
  const busy = r.links.some((k) => utilization(w, k) > 0.9);
  const base = 0.25 + 0.12 * r.hops.length + (busy ? 38 : 0);
  return (base + ((seq * 37) % 11) * 0.013 * (busy ? 40 : 1)).toFixed(busy ? 1 : 3);
}

/** Packets (1-based seq) that get no reply for a given loss. */
function lostSeqs(loss: number): Set<number> {
  const n = Math.round(Math.min(1, Math.max(0, loss)) * PINGS);
  const order = [2, 4, 1, 5, 3];
  return new Set(order.slice(0, n));
}

/** "Name or service not known" / "Temporary failure in name resolution" lines for a failed lookup. */
function nameError(prefix: string, target: string, failure: 'unknown_host' | 'dns_down'): string[] {
  return failure === 'dns_down'
    ? [red(`${prefix}: ${target}: Temporary failure in name resolution`), dim('(이름을 물어볼 DNS 서버에 닿지 않아요)')]
    : [red(`${prefix}: ${target}: Name or service not known`), dim('(DNS 장부에서 그 이름을 찾지 못했어요)')];
}

export const netCommands: Command[] = [
  {
    name: 'ip addr',
    aliases: ['ip a', 'ifconfig'],
    minStage: 1,
    usage: 'ip addr',
    summary: '이 장비의 IP 주소·게이트웨이·VLAN·링크 상태 보기',
    run(_args, { w, host }) {
      const d = own(w.devices, host);
      if (!d) return err('알 수 없는 장비');
      const a = addressOf(w, host);
      const nic = d.ports[0] ?? 'eth0';
      const up = d.ports.some((p) => linkUp(w, host, p));
      const gw = d.kind === 'router' ? dim('(라우터 자신)') : (a.gw ?? red('(없음)'));
      const mode = d.l3?.mode;
      const modeNote = mode === 'dhcp' ? dim('  (자동으로 받은 주소)') : mode === 'static' ? dim('  (손으로 정한 고정 주소)') : '';
      const vlan = w.net ? vlanOf(w, host) : null;
      return out(
        `${bold(nic)}: link ${up ? green('UP') : red('DOWN')}${dim('  (케이블 연결 상태)')}`,
        `    inet    ${a.ip ? `${a.ip}/${a.mask}` : red('(주소 없음)')}${dim('  (이 장비의 IP 주소)')}`,
        `    gateway ${gw}${d.kind === 'router' ? '' : dim('  (다른 네트워크로 나가는 문)')}`,
        ...(w.net ? [`    vlan    ${vlan ?? dim('-')}${dim('  (꽂힌 스위치 포트가 정한 VLAN)')}`] : []),
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
      if (!powered(w, host)) return err('장비 전원이 꺼져 있어요.');
      const events = (res: string) => [`ping:${target}:${res}`];
      const name = resolve(w, target, host);
      if (!name.ip) return { lines: nameError('ping', target, name.failure ?? 'unknown_host'), events: events(name.failure ?? 'unknown_host') };
      const ip = name.ip;
      const r = reach(w, host, ip);
      const ev = events(r.ok ? 'ok' : (r.failure ?? 'fail'));
      const a = addressOf(w, host);
      if (r.failure === 'no_ip') return { lines: [red('ping: connect: Network is unreachable'), dim('(이 장비에 IP 주소가 없어요)')], events: ev };
      // No route at all (off-subnet with no usable gateway configured): Linux refuses to send.
      if (r.failure === 'gateway' && a.ip && !sameSubnet(a.ip, ip, a.mask) && (!a.gw || !sameSubnet(a.ip, a.gw, a.mask))) {
        return { lines: [red('ping: connect: Network is unreachable'), dim('(밖으로 나가는 문(게이트웨이)이 없어요)')], events: ev };
      }
      const lines = [`PING ${target} (${ip}) 56(84) bytes of data.`];
      const stats = (rx: number, errs = 0) => {
        const loss = Math.round((1 - rx / PINGS) * 100);
        const s = `${PINGS} packets transmitted, ${rx} received, ${errs ? `+${errs} errors, ` : ''}${loss}% packet loss, time ${PINGS - 1}00${PINGS}ms`;
        lines.push('', `--- ${target} ping statistics ---`, rx === PINGS ? s : rx === 0 ? red(s) : yellow(s));
      };
      if (!r.ok) {
        // Unreachable (nobody answers ARP on the way) is reported by the last router reached, or by this host.
        // (If the request got there and only the reply is lost, nobody reports anything: plain silence.)
        const arrived = r.hops[r.hops.length - 1] === r.targetId;
        const unreachable = !arrived && (r.failure === 'link' || r.failure === 'vlan' || r.failure === 'gateway');
        if (unreachable) {
          const routers = l3Hops(w, r);
          // A router answers from its own address in our VLAN (its real SVI address, not the shared VIP).
          const v = vlanOf(w, host);
          const from = routers.length ? ((v !== null && own(w.devices, routers[0])?.nd?.svis[v]?.ip) || a.gw || a.ip) : a.ip;
          for (let i = 1; i <= PINGS; i++) lines.push(red(`From ${from} icmp_seq=${i} Destination Host Unreachable`));
          stats(0, PINGS);
          lines.push(dim('(가는 길에서 상대를 찾지 못했어요: 상대나 중간 장비가 대답하지 않아요)'));
        } else {
          stats(0);
          lines.push(dim(r.failure === 'storm' ? '(보낸 신호가 하나도 안 돌아왔어요. 네트워크가 꽉 막힌 것 같아요)' : '(보낸 신호가 하나도 안 돌아왔어요)'));
        }
        return { lines, events: ev };
      }
      const lost = r.failure === 'conflict' ? new Set([2, 4]) : lostSeqs(r.loss);
      const ttl = 64 - l3Hops(w, r).filter((h) => h !== r.targetId).length;
      for (let i = 1; i <= PINGS; i++) if (!lost.has(i)) lines.push(`64 bytes from ${ip}: icmp_seq=${i} ttl=${ttl} time=${rtt(w, r, i)} ms`);
      stats(PINGS - lost.size);
      if (r.failure === 'conflict') lines.push(dim('(응답이 들쭉날쭉해요… 같은 주소를 쓰는 장비가 둘?)'));
      else if (lost.size) lines.push(dim('(신호 일부가 가는 길에 사라졌어요)'));
      else lines.push(dim('(0% packet loss = 보낸 신호가 모두 돌아왔어요 · time = 갔다 오는 데 걸린 시간)'));
      return { lines, events: ev };
    },
  },
  {
    name: 'traceroute',
    aliases: ['trace', 'tracert', 'tracepath'],
    minStage: 1,
    usage: 'traceroute <이름 또는 IP>',
    summary: '상대까지 가는 길에 거치는 장비(라우터) 보기',
    run(args, { w, host }) {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) return err('사용법: traceroute <이름 또는 IP>');
      if (!powered(w, host)) return err('장비 전원이 꺼져 있어요.');
      const name = resolve(w, target, host);
      if (!name.ip) return { lines: nameError('traceroute', target, name.failure ?? 'unknown_host'), events: [`trace:${target}:${name.failure}`] };
      const ip = name.ip;
      const r = reach(w, host, ip);
      const lines = [`traceroute to ${target} (${ip}), 30 hops max, 60 byte packets`];
      if (r.failure === 'no_ip') return { lines: [red('connect: Network is unreachable'), dim('(이 장비에 IP 주소가 없어요)')], events: [`trace:${target}:no_ip`] };
      const hops = l3Hops(w, r).filter((h) => h !== r.targetId);
      const t = (n: number) => [0, 1, 2].map((k) => `${(0.3 + n * 0.21 + k * 0.04).toFixed(3)} ms`).join('  ');
      hops.forEach((h, i) => lines.push(` ${String(i + 1).padStart(2)}  ${label(w, h)}  ${t(i + 1)}`));
      if (r.ok) {
        lines.push(` ${String(hops.length + 1).padStart(2)}  ${r.targetId === 'internet' ? ip : `${label(w, r.targetId ?? ip)} (${ip})`}  ${t(hops.length + 1)}`);
        lines.push(dim(`(${hops.length}개 장비를 거쳐 도착했어요)`));
      } else {
        for (let i = 1; i <= 3; i++) lines.push(red(` ${String(hops.length + i).padStart(2)}  * * *`));
        lines.push(dim(hops.length ? `(${label(w, hops[hops.length - 1])} 다음부터 대답이 없어요)` : '(첫 구간부터 대답이 없어요)'));
      }
      lines.push(dim('(한 줄 = 가는 길에 거치는 장비(라우터) 하나 · ms 세 개 = 세 번 재 본 왕복 시간 · * * * = 대답 없음)'));
      return { lines, events: [`trace:${target}:${r.ok ? 'ok' : r.failure}`] };
    },
  },
  {
    name: 'nslookup',
    aliases: ['dig', 'host'],
    minStage: 1,
    usage: 'nslookup <이름>',
    summary: 'DNS 서버에 이름의 IP 주소 물어보기',
    run(args, { w, host }) {
      const name = args.find((a) => !a.startsWith('-'));
      if (!name) return err('사용법: nslookup <이름>');
      const events = [`nslookup:${name}`];
      const server = dnsServerFor(w, host);
      if (!server) return { lines: [red(';; connection timed out; no servers could be reached'), dim('(DNS 서버에 닿지 않아요)')], events };
      const sip = addressOf(w, server).ip!;
      const lines = [`Server:\t\t${sip}`, `Address:\t${sip}#53`, ''];
      const dns = w.net!.dns;
      if (isIp(name)) {
        const hit = Object.entries(dns).find(([, ip]) => ip === name);
        if (!hit) return { lines: [...lines, red(`** server can't find ${name.split('.').reverse().join('.')}.in-addr.arpa: NXDOMAIN`), dim('(DNS 장부에 그 주소의 이름이 없어요)')], events };
        return { lines: [...lines, `${name.split('.').reverse().join('.')}.in-addr.arpa\tname = ${hit[0]}.`, dim('(거꾸로 찾기: name = 그 IP 주소로 등록된 이름)')], events };
      }
      const key = Object.keys(dns).find((k) => k.toLowerCase() === name.toLowerCase());
      if (!key) return { lines: [...lines, red(`** server can't find ${name}: NXDOMAIN`), dim('(DNS 장부에 없는 이름이에요)')], events };
      return { lines: [...lines, `Name:\t${key}`, `Address: ${dns[key]}`, dim('(위 Server = 물어본 DNS 서버, #53 은 DNS의 문 번호 · 아래 Name / Address 가 답: 그 이름의 IP 주소)')], events };
    },
  },
  {
    name: 'dns list',
    aliases: ['dns'],
    minStage: 1,
    usage: 'dns list',
    summary: 'DNS 장부(이름 → IP 전화번호부) 보기 (DNS 서버에서)',
    run(_a, { w, host }) {
      if (!w.net) return err('DNS 없음');
      if (!w.net.dnsServers.includes(host)) return err('DNS 서버(ns1)에 접속해서 하세요. (ssh ns1)');
      const rows = Object.entries(w.net.dns).map(([n, ip]) => `  ${n.padEnd(14)} ${ip}`);
      return out(bold('이름            IP'), ...(rows.length ? rows : [dim('  (비어 있음)')]));
    },
  },
  {
    name: 'dns add',
    minStage: 1,
    usage: 'dns add <이름> <IP>',
    summary: 'DNS 장부에 이름 등록 (DNS 서버에서)',
    run(args, { w, host }) {
      const [name, ip] = args;
      const net = w.net;
      if (net && !net.dnsServers.includes(host)) return err('DNS 서버(ns1)에 접속해서 하세요. (ssh ns1)');
      if (!net || !name || !/^[a-z0-9][a-z0-9.-]*$/i.test(name) || !ip || !isIp(ip)) return err('사용법: dns add <이름> <IP>');
      // Names are case-insensitive: re-adding "Web" replaces "web".
      const old = Object.keys(net.dns).find((k) => k.toLowerCase() === name.toLowerCase());
      if (old) delete net.dns[old];
      net.dns[name] = ip;
      return { lines: [green(`등록했어요: ${name} → ${ip}`)], events: [`dns_add:${name}`] };
    },
  },
  {
    name: 'dns del',
    minStage: 1,
    usage: 'dns del <이름>',
    summary: 'DNS 장부에서 이름 지우기 (DNS 서버에서)',
    run(args, { w, host }) {
      const name = args[0];
      if (w.net && !w.net.dnsServers.includes(host)) return err('DNS 서버(ns1)에 접속해서 하세요. (ssh ns1)');
      const key = name && Object.keys(w.net?.dns ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
      if (!w.net || !key) return err('그런 이름은 장부에 없어요.');
      delete w.net.dns[key];
      return { lines: [green(`${key} 를 지웠어요.`)], events: [`dns_del:${key}`] };
    },
  },
  {
    name: 'ssh',
    minStage: 1,
    usage: 'ssh <이름 또는 IP>',
    summary: '다른 장비에 원격 접속 (멀리서 들어가 조작하기)',
    run(args, { w, host }) {
      // "ssh admin@CORE-01", "ssh -l admin CORE-01": the user name doesn't matter here.
      const raw = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-l' && args[i - 1] !== '-p');
      if (!raw) return err('사용법: ssh <이름 또는 IP>');
      const target = raw.includes('@') ? raw.slice(raw.indexOf('@') + 1) : raw;
      if (isLoopback(target)) return out(dim('이미 그 장비에 있어요.'));
      if (!powered(w, host)) return err('장비 전원이 꺼져 있어요.');
      let id: string;
      if (w.net) {
        // Gear names → their management address (the 관리 PC's hosts file); other names go through DNS.
        const name = resolve(w, target, host);
        if (!name.ip) {
          const why = name.failure === 'dns_down' ? 'Temporary failure in name resolution' : 'Name or service not known';
          return { lines: [red(`ssh: Could not resolve hostname ${target}: ${why}`), dim(name.failure === 'dns_down' ? '(이름을 물어볼 DNS 서버에 닿지 않아요)' : '(DNS 장부에 없는 이름이에요)')] };
        }
        const r = reach(w, host, name.ip, { port: 22 });
        if (r.failure === 'no_ip') return { lines: [red('ssh: connect to host ' + target + ' port 22: Network is unreachable'), dim('(이 장비에 IP 주소가 없어요)')] };
        if (!r.ok || !r.targetId) return sshTimeout(target);
        if (r.targetId === 'internet' || !own(w.devices, r.targetId)) {
          return { lines: [red(`ssh: connect to host ${target} port 22: Connection refused`), dim('(우리 데이터센터 장비가 아니라서 들어갈 수 없어요)')] };
        }
        id = r.targetId;
      } else {
        // No addresses in this world: machines are reached by name.
        const d = deviceByName(w, target);
        if (!d || d.kind === 'internet') return err(`ssh: Could not resolve hostname ${target}: Name or service not known`);
        id = d.id;
        if (id !== host && cabled(w, id) && cabled(w, host)) {
          if (!powered(w, id) || !l1Path(w, host, id)) return sshTimeout(target);
        }
      }
      if (id === host) return out(dim('이미 그 장비에 있어요.'));
      const d = w.devices[id];
      // Network gear answers with its IOS login: user mode (Switch>), `enable` for privileged.
      if (d.nd?.os === 'ios') {
        return { lines: [green(`${d.label} 에 접속했어요. (돌아가려면 exit)`), ''], host: id, mode: { level: 'user' }, events: [`ssh:${id}`] };
      }
      return { lines: [green(`${d.label} 에 접속했어요. (돌아가려면 exit)`)], host: id, mode: null, events: [`ssh:${id}`] };
    },
  },
  {
    name: 'exit',
    aliases: ['logout'],
    minStage: 1,
    os: ['linux', 'lb', 'fw'],
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
    os: ['linux', 'lb', 'fw'],
    usage: 'hostname',
    summary: '지금 어느 장비에 있는지',
    run(_a, { host }) {
      return out(host);
    },
  },
];
