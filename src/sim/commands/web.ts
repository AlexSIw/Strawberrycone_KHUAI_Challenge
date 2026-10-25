import { httpStatus, isLoopback, lbShares, listening, reach, resolve } from '../network';
import { own } from '../util';
import type { Command } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

function onWeb(host: string, w: import('../types').World) {
  if (!w.web) return err('웹 서버가 아직 없어요.');
  if (host !== w.web.host) return err(`server: 이 장비에는 웹 서버가 없어요. 먼저 ${w.web.host} 에 접속하세요 (ssh ${w.web.host}).`);
  return null;
}

const CURL_VALUE_FLAGS = new Set(['-o', '-X', '-H', '-d', '--data', '-m', '--max-time', '-u']);

export const webCommands: Command[] = [
  {
    name: 'server status',
    maxStage: 2,
    aliases: ['server config', 'server'],
    minStage: 2,
    usage: 'server status',
    summary: '웹 서버 설정 보기 (포트, 스레드, 경로)',
    run(_a, { w, host }) {
      const bad = onWeb(host, w);
      if (bad) return bad;
      const s = w.web!;
      return out(
        `상태     ${s.running ? green('running') : red('stopped')}`,
        `포트     ${s.port}`,
        `스레드   ${s.threads === 'single' ? yellow('single (직원 한 명)') : green('multi (요청마다 도우미)')}`,
        `경로     ${s.routes.join('  ')}`,
      );
    },
  },
  {
    name: 'server start',
    maxStage: 2,
    aliases: ['server restart'],
    minStage: 2,
    usage: 'server start',
    summary: '웹 서버 실행',
    run(_a, { w, host }) {
      const bad = onWeb(host, w);
      if (bad) return bad;
      w.web!.running = true;
      return { lines: [green(`수강신청 서버 시작! 포트 ${w.web!.port} 에서 요청을 기다려요.`)], events: ['server_started'] };
    },
  },
  {
    name: 'server stop',
    maxStage: 2,
    minStage: 2,
    usage: 'server stop',
    summary: '웹 서버 중지',
    run(_a, { w, host }) {
      const bad = onWeb(host, w);
      if (bad) return bad;
      w.web!.running = false;
      return ok('서버를 멈췄어요.');
    },
  },
  {
    name: 'server set',
    maxStage: 2,
    minStage: 2,
    usage: 'server set port <번호> | server set threads single|multi',
    summary: '웹 서버 포트·스레드 방식 바꾸기',
    run(args, { w, host }) {
      const bad = onWeb(host, w);
      if (bad) return bad;
      const [key, value] = args;
      if (key === 'port' && value && /^\d+$/.test(value)) {
        w.web!.port = parseInt(value, 10);
        // 80으로 · 8081로: the particle follows how the number is read (ends in 영/삼/육/십/백… → 으로).
        const ro = /[036]$/.test(value) ? '으로' : '로';
        return { lines: [green(`포트를 ${value}${ro} 바꾸고 재시작했어요.`)], events: ['server_port'] };
      }
      if (key === 'threads' && (value === 'single' || value === 'multi')) {
        w.web!.threads = value;
        return ok(value === 'multi' ? '이제 요청이 올 때마다 도우미(스레드)가 한 명씩 붙어요.' : '직원 한 명 모드로 바꿨어요.');
      }
      return err('사용법: server set port <번호> | server set threads single|multi');
    },
  },
  {
    name: 'ports',
    maxStage: 2,
    aliases: ['ss -lt', 'netstat', 'ss'],
    minStage: 2,
    usage: 'ports',
    summary: '이 장비에서 열려 있는(손님을 기다리는) 포트 보기',
    run(_a, { w, host }) {
      const rows = [bold('STATE   ADDRESS            PROGRAM')];
      rows.push(`LISTEN  0.0.0.0:22          sshd`);
      if (w.web && w.web.host === host && w.web.running) rows.push(`LISTEN  0.0.0.0:${String(w.web.port).padEnd(11)}enroll-app (수강신청)`);
      rows.push(dim('(LISTEN = 그 번호로 오는 손님을 기다리는 중 · 0.0.0.0 = 어느 주소로 오든 받음 · sshd = 원격 접속 담당)'));
      return out(...rows);
    },
  },
  {
    name: 'curl',
    minStage: 2,
    usage: 'curl [-v] http://<이름>[:포트]/<경로>',
    summary: '로봇 손님처럼 웹 요청(HTTP) 보내기',
    run(args, { w, host }) {
      const verbose = args.includes('-v') || args.includes('--verbose');
      // Other flags (-i, -s, -L …) are ignored; skip the value of flags that take one.
      const url = args.find((a, i) => !a.startsWith('-') && !CURL_VALUE_FLAGS.has(args[i - 1]));
      const m = url?.match(/^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/);
      if (!m) return err('사용법: curl [-v] http://web/enroll');
      const [, name, portStr, path = '/'] = m;
      const port = portStr ? parseInt(portStr, 10) : 80;
      const lines: string[] = [];
      // localhost / 127.0.0.1 is the machine you are on.
      let ip = '127.0.0.1';
      if (!isLoopback(name)) {
        const r = resolve(w, name, host);
        if (!r.ip) return { lines: [red(`curl: (6) Could not resolve host: ${name}`), dim(r.failure === 'dns_down' ? '(이름을 물어볼 DNS 서버에 닿지 않아요)' : '(이름을 IP 주소로 바꾸지 못했어요)')], events: ['curl:dns'] };
        ip = r.ip;
      }
      if (verbose) lines.push(dim(`*   Trying ${ip}:${port}...`));
      let server = host;
      if (ip !== '127.0.0.1') {
        const r = reach(w, host, ip, { port });
        if (!r.ok || !r.targetId) {
          lines.push(red(`curl: (28) Failed to connect to ${name} port ${port} after 3002 ms: Timed out`), dim('(기다려도 대답이 없어서 포기했어요)'));
          return { lines, events: ['curl:timeout'] };
        }
        server = r.targetId;
      }
      let serverPort = port;
      const lb = w.net?.lb;
      const refused = () => {
        if (verbose) lines.push(dim('> SYN  →'), dim('< RST  ← (그 포트에서 기다리는 프로그램이 없어요)'));
        lines.push(red(`curl: (7) Failed to connect to ${name} port ${port} after 1 ms: Connection refused`));
        if (!verbose) lines.push(dim('(연결 거부: 문을 두드렸는데 아무도 안 열어줬어요)'));
        return { lines, events: ['curl:refused'] };
      };
      // The L4's VIP: the active unit hands the connection to a healthy pool member.
      if (lb && (ip === lb.vip || ip === lb.publicIp)) {
        if (port !== lb.port) return refused();
        const pick = lbShares(w).sort((a, b) => b.share - a.share)[0]?.member;
        if (!pick) {
          if (verbose) lines.push(dim(`* Connected to ${name} (${ip}) port ${port}`), dim(`> GET ${path} HTTP/1.1`), dim('< HTTP/1.1 503 Service Unavailable'));
          lines.push(red('<html><body><h1>503 Service Unavailable</h1>No server is available to handle this request.</body></html>'), dim('(L4가 요청을 넘길 건강한 서버가 하나도 없대요)'));
          return { lines, events: ['curl:503'] };
        }
        server = pick.host;
        serverPort = pick.port;
      }
      const status = httpStatus(w, server, serverPort, path);
      if (status === 0) {
        if (!listening(w, server, serverPort)) return refused();
        lines.push(red('curl: (1) Received HTTP/0.9 when not allowed'), dim('(웹 서버가 아닌 프로그램이 대답했어요)'));
        return { lines, events: ['curl:not-http'] };
      }
      if (verbose) {
        lines.push(
          dim('> SYN       → "얘기할래?"'),
          dim('< SYN-ACK   ← "응, 너도?"'),
          dim('> ACK       → "응!"   (3-way handshake 완료)'),
          dim(`* Connected to ${name} (${ip}) port ${port}`),
          dim(`> GET ${path} HTTP/1.1`),
          dim(`> Host: ${name}`),
          dim(`< HTTP/1.1 ${status === 200 ? '200 OK' : '404 Not Found'}`),
          dim('< Content-Type: application/json'),
        );
      }
      if (status !== 200) {
        lines.push(yellow(`{"error":"Not Found","path":"${path}"}`));
        return { lines, events: [`curl:404:${path}`] };
      }
      const body: Record<string, string> = {
        '/': '{"service":"KHU 수강신청","status":"ok"}',
        '/enroll': '{"message":"수강신청 페이지","open":true}',
        '/courses': '{"courses":["대학 글쓰기","컴퓨터 개론","교양 영어"]}',
        '/health': '{"status":"UP"}',
      };
      lines.push(green(own(body, path) ?? '{"status":"ok"}'));
      // The name asked for is in the event ('curl:200:sugang/enroll'): a mission can tell whose 200 it was.
      return { lines, events: [`curl:200:${name.toLowerCase()}${path}`] };
    },
  },
  {
    name: 'notice show',
    maxStage: 2,
    aliases: ['notice'],
    minStage: 2,
    usage: 'notice show',
    summary: '학생 공지에 적힌 수강신청 주소 보기',
    run(_a, { w }) {
      if (!w.notice) return out(dim('아직 올라온 학생 공지가 없어요.'));
      return out(`📢 학생 공지: "수강신청은 http://web${w.notice.url} 에서!"`);
    },
  },
  {
    name: 'notice set',
    maxStage: 2,
    minStage: 2,
    usage: 'notice set <경로>',
    summary: '학생 공지의 주소 고치기',
    run(args, { w }) {
      if (!w.notice) return err('아직 올라온 학생 공지가 없어요. 고칠 공지가 생기면 그때 써요.');
      if (!args[0]?.startsWith('/')) return err('사용법: notice set /경로');
      w.notice.url = args[0];
      return ok(`공지를 고쳤어요: http://web${args[0]}`);
    },
  },
];
