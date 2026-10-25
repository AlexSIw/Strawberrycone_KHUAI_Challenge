// Appliance CLIs: the DHCP server (dhcp01), the L4 load balancers (L4-01/02) and the firewalls (FW-01/02).
// Syntax is fixed in docs/v2-contract.md. Output = a realistic table + a short dim Korean gloss.
import { intToIp, ipToInt, isIp, maskBits, networkOf, sameSubnet } from '../net/basics';
import { dhcpView, fwBlocksCidr, lbView, STUDENT_BLOCKS, STUDENT_SHARE } from '../net/services';
import type { DhcpPool, FwRule, World } from '../types';
import { own } from '../util';
import type { CmdResult, Command } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

const pad = (s: string, n: number, color?: (x: string) => string) => (color ? color(s) : s) + ' '.repeat(Math.max(1, n - s.length));
const rpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s;
/** Width-aware pad for Korean labels (two cells per Hangul character). */
const wide = (s: string) => [...s].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? 2 : 1), 0);
const padW = (s: string, n: number) => s + ' '.repeat(Math.max(1, n - wide(s)));

// ---------- DHCP (dhcp01) ----------

function dhcpHost(w: World, host: string): CmdResult | null {
  const server = w.net?.dhcp.server ?? 'dhcp01';
  if (!w.net) return err('dhcp: 이 날에는 DHCP 서버가 없어요.');
  if (host !== server) return { lines: [red(`dhcp: command not found on ${host}`), dim(`(DHCP 서버 설정은 ${server}에 접속해서 하세요)`)] };
  return null;
}

function poolOr(w: World, name: string | undefined): DhcpPool | CmdResult {
  if (!name) return err('사용법: dhcp pool show <풀 이름>  (풀 이름은 dhcp pool list)');
  const p = own(w.net?.dhcp.pools, name);
  if (!p) return { lines: [red(`dhcp: no such pool '${name}'`), dim('(풀 이름은 dhcp pool list 로 확인해요)')] };
  return p;
}
const isPool = (x: DhcpPool | CmdResult): x is DhcpPool => 'network' in x;

/** a.b.c.N for a pool's last-octet number */
const addrIn = (p: DhcpPool, n: number) => intToIp((ipToInt(p.network) & maskBits(p.mask)) + n);

/** Fixed addresses inside a range that something else already uses (gateways, SVIs, VIPs, servers). */
function staticUsers(w: World, p: DhcpPool, lo: number, hi: number): string[] {
  const hits: string[] = [];
  const check = (ip: string | null | undefined, who: string) => {
    if (!ip || !sameSubnet(ip, p.network, p.mask)) return;
    const n = ipToInt(ip) - (ipToInt(p.network) & maskBits(p.mask));
    if (n >= lo && n <= hi) hits.push(`${ip} (${who})`);
  };
  check(p.gw, '게이트웨이');
  for (const d of Object.values(w.devices)) {
    check(d.l3?.ip, d.label);
    for (const [v, s] of Object.entries(d.nd?.svis ?? {})) {
      check(s.ip, `${d.label} Vlan${v}`);
      check(s.hsrp?.vip, `${d.label} Vlan${v} 가상 게이트웨이`);
    }
  }
  return [...new Set(hits)];
}

const dhcpCommands: Command[] = [
  {
    name: 'dhcp pool list',
    aliases: ['dhcp pool', 'dhcp'],
    minStage: 1,
    usage: 'dhcp pool list',
    summary: 'DHCP 주소 풀(나눠 줄 주소 묶음)과 남은 주소 보기',
    run(_a, { w, host }) {
      const bad = dhcpHost(w, host);
      if (bad) return bad;
      const net = w.net!;
      const lines = [`${pad('POOL', 12)}${padW('LABEL', 18)}${pad('NETWORK', 16)}${pad('RANGE', 11)}${rpad('SIZE', 5)}${rpad('USED', 6)}${rpad('FREE', 6)}${rpad('STALE', 7)}${rpad('STARVING', 10)}`];
      for (const p of Object.values(net.dhcp.pools)) {
        const v = dhcpView(w, p.name);
        const starving = v.starving > 0 ? ' '.repeat(Math.max(0, 10 - String(v.starving).length)) + red(String(v.starving)) : rpad('0', 10);
        const free = v.free === 0 ? ' '.repeat(Math.max(0, 6 - 1)) + red('0') : rpad(String(v.free), 6);
        lines.push(`${pad(p.name, 12)}${padW(p.label, 18)}${pad(`${p.network}/${p.mask}`, 16)}${pad(`.${p.start}-.${p.end}`, 11)}${rpad(String(v.size), 5)}${rpad(String(v.used), 6)}${free}${rpad(String(v.stale), 7)}${starving}`);
      }
      if (!net.dhcp.running) lines.push(yellow('dhcpd is not running'), dim('(DHCP 서비스가 멈춰 있어요)'));
      lines.push(dim('(SIZE 나눠 줄 수 있는 주소 수 · USED 빌려준 주소 · STALE 떠난 기기가 아직 쥐고 있는 주소 · STARVING 주소를 못 받은 기기)'));
      return out(...lines);
    },
  },
  {
    name: 'dhcp pool show',
    minStage: 1,
    usage: 'dhcp pool show <풀>',
    summary: '풀 하나의 범위·게이트웨이·DNS 보기',
    run(args, { w, host }) {
      const bad = dhcpHost(w, host);
      if (bad) return bad;
      const p = poolOr(w, args[0]);
      if (!isPool(p)) return p;
      const v = dhcpView(w, p.name);
      const clients = Object.values(w.net!.clients).filter((c) => c.pool === p.name);
      return out(
        `${bold('pool')} ${p.name}  ${dim(`(${p.label})`)}`,
        `  network     ${p.network}/${p.mask}`,
        `  range       ${addrIn(p, p.start)} - ${addrIn(p, p.end)}  ${dim('(이 범위의 주소를 빌려줘요)')}`,
        `  gateway     ${p.gw}  ${dim('(받은 기기가 밖으로 나가는 문)')}`,
        `  dns         ${p.dns.join(', ')}`,
        `  leases      ${v.used}/${v.size} used, ${v.free} free, ${v.stale} stale`,
        v.starving > 0 ? `  starving    ${red(String(v.starving))}  ${dim('(주소를 못 받은 기기 → 169.254.x.x 로 떨어져 인터넷이 안 돼요)')}` : '  starving    0',
        ...clients.map((c) => `  clients     ${c.label}: ${c.count} devices on ${c.switch} ${c.port}`),
      );
    },
  },
  {
    name: 'dhcp pool set',
    minStage: 1,
    usage: 'dhcp pool set <풀> range <시작 IP> <끝 IP>',
    summary: '풀이 나눠 줄 주소 범위 바꾸기',
    run(args, { w, host }) {
      const bad = dhcpHost(w, host);
      if (bad) return bad;
      const usage = err('사용법: dhcp pool set <풀> range <시작 IP> <끝 IP>   예) range 10.20.12.100 10.20.12.199');
      const [name, kw, a, b] = args;
      if (!name || kw !== 'range' || !a || !b) return usage;
      const p = poolOr(w, name);
      if (!isPool(p)) return p;
      if (!isIp(a) || !isIp(b)) return usage;
      if (!sameSubnet(a, p.network, p.mask) || !sameSubnet(b, p.network, p.mask)) {
        return { lines: [red(`dhcp: range must be inside ${p.network}/${p.mask}`), dim('(이 풀의 대역 밖 주소예요)')] };
      }
      const base = ipToInt(p.network) & maskBits(p.mask);
      const lo = ipToInt(a) - base;
      const hi = ipToInt(b) - base;
      const last = 2 ** (32 - p.mask) - 1;
      if (lo > hi) return { lines: [red('dhcp: start address is after end address'), dim('(시작 주소가 끝 주소보다 커요)')] };
      if (lo < 1 || hi >= last) return { lines: [red('dhcp: range includes the network or broadcast address'), dim('(맨 앞 .0 과 맨 끝 주소는 쓸 수 없어요)')] };
      const clash = staticUsers(w, p, lo, hi);
      if (clash.length) {
        return { lines: [red(`dhcp: range overlaps fixed addresses: ${clash.slice(0, 3).join(', ')}${clash.length > 3 ? ' …' : ''}`), dim('(이미 고정으로 쓰는 주소와 겹쳐요. 겹치면 주소 충돌이 나요)')] };
      }
      p.start = lo;
      p.end = hi;
      const v = dhcpView(w, p.name);
      return { lines: [green(`pool ${p.name}: range ${addrIn(p, lo)} - ${addrIn(p, hi)} (${v.size} addresses, ${v.free} free)`)], events: [`dhcp:range:${p.name}`] };
    },
  },
  {
    name: 'dhcp leases',
    minStage: 1,
    usage: 'dhcp leases <풀>',
    summary: '풀에서 주소를 빌려 간 기기 목록',
    run(args, { w, host }) {
      const bad = dhcpHost(w, host);
      if (bad) return bad;
      const p = poolOr(w, args[0]);
      if (!isPool(p)) return p;
      const v = dhcpView(w, p.name);
      const active = v.used - v.stale;
      const lines = [`${pad('ADDRESS', 16)}${pad('MAC', 19)}${pad('STATE', 9)}ENDS`];
      const total = v.used;
      const show = Math.min(total, 12);
      for (let i = 0; i < show; i++) {
        const stale = i >= active;
        const mac = `a4:5e:60:${(p.name.length * 7 + i).toString(16).padStart(2, '0').slice(-2)}:${((i * 37) & 255).toString(16).padStart(2, '0')}:${((i * 101 + 17) & 255).toString(16).padStart(2, '0')}`;
        lines.push(`${pad(addrIn(p, p.start + i), 16)}${pad(mac, 19)}${stale ? pad('expired', 9, yellow) : pad('active', 9)}${stale ? dim('(기기는 떠났는데 주소를 아직 쥐고 있음)') : `${1 + (i % 8)}h${(i * 13) % 60}m`}`);
      }
      if (total > show) lines.push(dim(`… 총 ${total}개 (active ${active}, expired ${v.stale})`));
      if (!total) lines.push(dim('(빌려준 주소가 없어요)'));
      lines.push(dim('(expired 주소는 dhcp leases clear 로 회수할 수 있어요)'));
      return out(...lines);
    },
  },
  {
    name: 'dhcp leases clear',
    minStage: 1,
    usage: 'dhcp leases clear <풀>',
    summary: '떠난 기기가 쥐고 있던(expired) 주소 회수',
    run(args, { w, host }) {
      const bad = dhcpHost(w, host);
      if (bad) return bad;
      const p = poolOr(w, args[0]);
      if (!isPool(p)) return p;
      const n = p.stale;
      p.stale = 0;
      return { lines: [green(`reclaimed ${n} expired lease${n === 1 ? '' : 's'} in ${p.name}`), dim('(회수한 주소는 다시 나눠 줄 수 있어요)')], events: [`dhcp:clear:${p.name}`] };
    },
  },
];

// ---------- L4 (L4-01 / L4-02) ----------

function lbOr(w: World): NonNullable<NonNullable<World['net']>['lb']> | CmdResult {
  return w.net?.lb ?? err('lb: load balancer is not configured');
}
const isLb = (x: unknown): x is NonNullable<NonNullable<World['net']>['lb']> => !!x && typeof x === 'object' && 'vip' in x;

function findMember(w: World, name: string | undefined) {
  const lb = w.net?.lb;
  if (!lb || !name) return null;
  const n = name.toLowerCase();
  return lb.members.find((m) => m.name.toLowerCase() === n || m.host.toLowerCase() === n || own(w.devices, m.host)?.label.toLowerCase() === n) ?? null;
}

const lbCommands: Command[] = [
  {
    name: 'lb status',
    aliases: ['lb'],
    minStage: 2,
    os: ['lb'],
    usage: 'lb status',
    summary: 'VIP·지금 일하는 장비·세션 수 보기',
    run(_a, { w, host }) {
      const lb = lbOr(w);
      if (!isLb(lb)) return lb;
      const v = lbView(w);
      const healthy = v.members.filter((m) => m.healthy).length;
      const standby = lb.pair.find((id) => id !== v.active) ?? '-';
      const sess = v.sessions >= lb.maxConn ? red(`${v.sessions}`) : String(v.sessions);
      return out(
        `${pad('VIP', 14)}${lb.vip}:${lb.port}  (public ${lb.publicIp})`,
        `${pad('Active unit', 14)}${v.active ? (v.active === host ? green(`${v.active} (this unit)`) : v.active) : red('none')}    standby ${standby}`,
        `${pad('Sessions', 14)}${sess} / ${lb.maxConn}`,
        `${pad('Pool', 14)}${v.members.length} members, ${healthy === v.members.length ? green(`${healthy} healthy`) : red(`${healthy} healthy`)}`,
        `${pad('Health check', 14)}${lb.health.proto.toUpperCase()} ${lb.health.proto === 'http' ? `GET ${lb.health.path} ` : ''}port ${lb.health.port}`,
        dim('(VIP = 학생들이 접속하는 대표 주소. L4가 요청을 건강한 서버들에게 나눠 줘요)'),
      );
    },
  },
  {
    name: 'lb pool',
    minStage: 2,
    os: ['lb'],
    usage: 'lb pool',
    summary: '요청을 나눠 받을 서버(멤버) 목록과 건강 상태',
    run(_a, { w }) {
      const lb = lbOr(w);
      if (!isLb(lb)) return lb;
      const v = lbView(w);
      const lines = [`${pad('NAME', 10)}${pad('HOST', 10)}${pad('ADDRESS', 16)}${pad('PORT', 7)}${pad('ADMIN', 10)}HEALTH`];
      for (const m of v.members) {
        const ip = own(w.devices, m.host)?.l3?.ip ?? '-';
        const health = !m.enabled ? dim('-') : m.healthy ? green('UP') : red('DOWN');
        lines.push(`${pad(m.name, 10)}${pad(m.host, 10)}${pad(ip, 16)}${pad(String(m.port), 7)}${pad(m.enabled ? 'enabled' : 'disabled', 10, m.enabled ? undefined : yellow)}${health}`);
      }
      if (!v.members.length) lines.push(dim('(멤버가 없어요)'));
      lines.push(dim('(HEALTH DOWN = 상태 검사에 실패해서 요청을 안 보내는 서버)'));
      return out(...lines);
    },
  },
  {
    name: 'lb pool add',
    minStage: 2,
    os: ['lb'],
    usage: 'lb pool add <서버> <포트>',
    summary: '멤버 추가',
    run(args, { w }) {
      const lb = lbOr(w);
      if (!isLb(lb)) return lb;
      const [name, portS] = args;
      const port = Number(portS);
      if (!name || !Number.isInteger(port) || port < 1 || port > 65535) return err('사용법: lb pool add <서버> <포트>   예) lb pool add n1 30080');
      const dev = Object.values(w.devices).find((d) => d.id.toLowerCase() === name.toLowerCase() || d.label.toLowerCase() === name.toLowerCase());
      if (!dev || dev.kind !== 'server') return { lines: [red(`lb: unknown server '${name}'`), dim('(서버 이름을 확인해요)')] };
      if (findMember(w, dev.id)) return { lines: [red(`lb: ${dev.id} is already in the pool`), dim('(이미 멤버예요)')] };
      lb.members.push({ name: dev.id, host: dev.id, port, enabled: true });
      return { lines: [green(`풀에 추가했어요: ${dev.id}:${port}`)], events: [`lb:add:${dev.id}`] };
    },
  },
  {
    name: 'lb pool del',
    minStage: 2,
    os: ['lb'],
    usage: 'lb pool del <서버>',
    summary: '멤버 빼기',
    run(args, { w }) {
      const lb = lbOr(w);
      if (!isLb(lb)) return lb;
      const m = findMember(w, args[0]);
      if (!m) return err(`lb: no such member '${args[0] ?? ''}'  (lb pool 로 목록 확인)`);
      lb.members = lb.members.filter((x) => x !== m);
      return { lines: [green(`removed ${m.name} from the pool`)], events: [`lb:del:${m.host}`] };
    },
  },
  ...(['enable', 'disable'] as const).map(
    (op): Command => ({
      name: `lb pool ${op}`,
      minStage: 2,
      os: ['lb'],
      usage: `lb pool ${op} <서버>`,
      summary: op === 'enable' ? '멤버에게 다시 요청 보내기' : '멤버에게 요청 그만 보내기 (점검용)',
      run(args, { w }) {
        const lb = lbOr(w);
        if (!isLb(lb)) return lb;
        const m = findMember(w, args[0]);
        if (!m) return err(`lb: no such member '${args[0] ?? ''}'  (lb pool 로 목록 확인)`);
        m.enabled = op === 'enable';
        return { lines: [green(`${m.name}: ${op}d`)], events: [`lb:${op}:${m.host}`] };
      },
    }),
  ),
  {
    name: 'lb health',
    minStage: 2,
    os: ['lb'],
    usage: 'lb health',
    summary: '상태 검사(health check) 설정 보기',
    run(_a, { w }) {
      const lb = lbOr(w);
      if (!isLb(lb)) return lb;
      const h = lb.health;
      const v = lbView(w);
      return out(
        `${pad('protocol', 10)}${h.proto.toUpperCase()}`,
        `${pad('port', 10)}${h.port}`,
        ...(h.proto === 'http' ? [`${pad('path', 10)}${h.path}`, `${pad('expect', 10)}200 OK`] : []),
        `${pad('interval', 10)}5s, 3 failures = DOWN`,
        `${pad('result', 10)}${v.members.filter((m) => m.healthy).length}/${v.members.length} UP`,
        dim(`(L4가 몇 초마다 각 서버의 ${h.proto === 'http' ? `${h.path} 주소` : `${h.port}번 포트`}를 두드려 보고, 대답이 없으면 요청을 안 보내요)`),
      );
    },
  },
  {
    name: 'lb health set',
    minStage: 2,
    os: ['lb'],
    usage: 'lb health set path <경로> | port <포트>',
    summary: '상태 검사 경로·포트 바꾸기',
    run(args, { w }) {
      const lb = lbOr(w);
      if (!isLb(lb)) return lb;
      const [what, val] = args;
      if (what === 'path' && val && val.startsWith('/')) {
        lb.health.path = val;
        return { lines: [green(`헬스체크 경로를 바꿨어요: ${val}`)], events: ['lb:health'] };
      }
      if (what === 'port' && val) {
        const p = Number(val);
        if (Number.isInteger(p) && p >= 1 && p <= 65535) {
          lb.health.port = p;
          return { lines: [green(`헬스체크 포트를 바꿨어요: ${p}`)], events: ['lb:health'] };
        }
      }
      return err('사용법: lb health set path </경로>  또는  lb health set port <포트>');
    },
  },
];

// ---------- Firewall (FW-01 / FW-02, one shared rule list) ----------

/** Students on the internet (STUDENT_BLOCKS): each address sends ~1 request every 20 s. */
const STUDENT_RPS_PER_ADDR = 0.05;

/** `fw top`'s FW cell for a source range: how much of it the firewall drops. */
function fwCell(blocked: number): string {
  if (blocked >= 1) return red('BLOCKED');
  if (blocked <= 0) return 'allowed';
  const pct = blocked * 100;
  return yellow(`PARTIAL ${pct < 1 ? pct.toFixed(1) : pct.toFixed(0)}%`);
}

function parseCidr(s: string): string | null {
  if (s === 'any') return 'any';
  const [ip, len] = s.split('/');
  if (!isIp(ip)) return null;
  const n = len === undefined ? 32 : Number(len);
  if (!Number.isInteger(n) || n < 0 || n > 32 || (len !== undefined && !/^\d+$/.test(len))) return null;
  return networkOf(ip, n);
}

function ruleLine(r: FwRule, i: number): string {
  const act = r.action === 'deny' ? pad('deny', 8, red) : pad('permit', 8, green);
  return `${rpad(String(i + 1), 3)}  ${pad(String(r.seq), 5)}${act}${pad(r.src, 20)}${pad(r.dst, 18)}${r.port ?? 'any'}`;
}

function addRule(w: World, action: FwRule['action'], args: string[]): CmdResult {
  const [cidrS, portS] = args;
  const usage = err(`사용법: fw ${action} <주소/길이> [포트]   예) fw ${action} 192.0.2.7/32`);
  if (!cidrS || !w.net) return usage;
  const src = parseCidr(cidrS);
  if (!src) return usage;
  let port: number | undefined;
  if (portS !== undefined) {
    port = Number(portS);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return usage;
  }
  const rules = w.net.fw.rules;
  const seq = rules.reduce((m, r) => Math.max(m, r.seq), 0) + 10;
  const rule: FwRule = { seq, action, src, dst: 'any', ...(port !== undefined ? { port } : {}) };
  rules.unshift(rule);
  const lines = [green(`rule ${seq} added at the top: ${action} ${src} → any${port ? ` port ${port}` : ''}`)];
  if (src !== cidrS && cidrS.includes('/')) lines.push(dim(`(주소를 대역 시작 주소 ${src} 로 맞췄어요)`));
  const len = src === 'any' ? 0 : Number(src.split('/')[1]);
  if (action === 'deny' && len < 16) lines.push(yellow('주의: 아주 넓은 범위예요. 학생들까지 막힐 수 있어요.'));
  return { lines, events: [`fw:${action}:${src}`] };
}

const fwCommands: Command[] = [
  {
    name: 'fw rules',
    aliases: ['fw'],
    minStage: 2,
    os: ['fw'],
    usage: 'fw rules',
    summary: '방화벽 규칙 목록 (위에서부터 먼저 맞는 규칙 적용)',
    run(_a, { w }) {
      const rules = w.net?.fw.rules ?? [];
      const lines = [`${rpad('#', 3)}  ${pad('SEQ', 5)}${pad('ACTION', 8)}${pad('SOURCE', 20)}${pad('DESTINATION', 18)}PORT`];
      rules.forEach((r, i) => lines.push(ruleLine(r, i)));
      lines.push(`${rpad('*', 3)}  ${pad('-', 5)}${pad('permit', 8)}${pad('any', 20)}${pad('any', 18)}any  ${dim('(기본: 나머지는 모두 통과)')}`);
      lines.push(dim('(위에서부터 차례로 보고 처음 맞는 규칙을 따라요. FW-01과 FW-02는 같은 규칙을 써요)'));
      return out(...lines);
    },
  },
  {
    name: 'fw top',
    minStage: 2,
    os: ['fw'],
    usage: 'fw top',
    summary: '요청을 가장 많이 보내는 출발지 순위 (top talkers)',
    run(_a, { w }) {
      const dst = w.net?.lb?.publicIp ?? '203.0.113.10';
      const port = w.net?.lb?.port ?? 80;
      const rows: { src: string; label: string; addrs: number; rps: number }[] = [];
      for (const { cidr, label } of STUDENT_BLOCKS) {
        const rps = Math.round(w.traffic.rps * STUDENT_SHARE);
        if (rps > 0) rows.push({ src: cidr, label, addrs: Math.max(1, Math.round(rps / STUDENT_RPS_PER_ADDR)), rps });
      }
      for (const s of w.traffic.sources ?? []) {
        let cidr = s.cidr;
        if (s.kind === 'campus') {
          const pool = own(w.net?.dhcp.pools, own(w.net?.clients, s.cidr)?.pool ?? s.cidr);
          if (pool) cidr = `${pool.network}/${pool.mask}`;
        }
        const len = cidr.includes('/') ? Number(cidr.split('/')[1]) : 32;
        rows.push({ src: cidr, label: s.label, addrs: Math.max(1, Math.min(2 ** (32 - len), 254)), rps: s.rps });
      }
      rows.sort((a, b) => b.rps / b.addrs - a.rps / a.addrs || b.rps - a.rps);
      const lines = [`${pad('SOURCE', 20)}${padW('WHO', 20)}${rpad('ADDRS', 7)}${rpad('RPS', 8)}${rpad('RPS/ADDR', 10)}  FW`];
      let partial = false;
      for (const r of rows) {
        const per = r.rps / r.addrs;
        const perTxt = per >= 10 ? per.toFixed(0) : per.toFixed(2);
        const perCell = per >= 10 ? ' '.repeat(Math.max(0, 10 - perTxt.length)) + red(perTxt) : rpad(perTxt, 10);
        const blocked = fwBlocksCidr(w, r.src, dst, port);
        partial ||= blocked > 0 && blocked < 1;
        lines.push(`${pad(r.src, 20)}${padW(r.label, 20)}${rpad(String(r.addrs), 7)}${rpad(String(r.rps), 8)}${perCell}  ${fwCell(blocked)}`);
      }
      if (!rows.length) lines.push(dim('(지금은 들어오는 요청이 없어요)'));
      if (partial) lines.push(dim('(PARTIAL = 그 대역의 일부 주소만 막혔어요. 나머지 주소는 그대로 들어와요)'));
      lines.push(dim('(RPS = 초당 요청 수. 주소 하나가 사람보다 훨씬 많이 보내면 매크로·봇을 의심해요)'));
      return out(...lines);
    },
  },
  {
    name: 'fw deny',
    minStage: 2,
    os: ['fw'],
    usage: 'fw deny <주소/길이> [포트]',
    summary: '출발지 막기 (맨 위에 규칙 추가)',
    run: (args, { w }) => addRule(w, 'deny', args),
  },
  {
    name: 'fw permit',
    minStage: 2,
    os: ['fw'],
    usage: 'fw permit <주소/길이> [포트]',
    summary: '출발지 허용 (맨 위에 규칙 추가)',
    run: (args, { w }) => addRule(w, 'permit', args),
  },
  {
    name: 'fw del',
    minStage: 2,
    os: ['fw'],
    usage: 'fw del <seq>',
    summary: '규칙 지우기 (SEQ 번호로)',
    run(args, { w }) {
      const seq = Number(args[0]);
      const rules = w.net?.fw.rules;
      const i = rules?.findIndex((r) => r.seq === seq) ?? -1;
      if (!rules || !args[0] || i < 0) return err('사용법: fw del <SEQ>  (번호는 fw rules 의 SEQ 칸)');
      const [r] = rules.splice(i, 1);
      return { ...ok(`rule ${seq} deleted (${r.action} ${r.src})`), events: [`fw:del:${seq}`] };
    },
  },
];

/** Leaving an appliance (the shell's `exit` only covers Linux hosts). */
const applianceExit: Command = {
  name: 'exit',
  aliases: ['logout', 'quit'],
  minStage: 0,
  os: ['lb', 'fw'],
  usage: 'exit',
  summary: '관리 PC(ops)로 돌아가기',
  run: (_a, { w, host }) => ({ lines: [dim(`Connection to ${own(w.devices, host)?.label ?? host} closed.`)], host: 'ops', mode: null }),
};

export const infraCommands: Command[] = [...dhcpCommands, ...lbCommands, ...fwCommands, applianceExit];
