import { ping, resolveName } from '../network';
import type { Command } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

function onWeb(host: string, w: import('../types').World) {
  if (!w.web) return err('웹 서버가 아직 없어요.');
  if (host !== w.web.host) return err(`server: 이 장비에는 웹 서버가 없어요. 먼저 ${w.web.host} 에 접속하세요 (ssh ${w.web.host}).`);
  return null;
}

export const webCommands: Command[] = [
  {
    name: 'server status',
    maxStage: 3,
    aliases: ['server config', 'server'],
    minStage: 3,
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
    maxStage: 3,
    aliases: ['server restart'],
    minStage: 3,
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
    maxStage: 3,
    minStage: 3,
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
    maxStage: 3,
    minStage: 3,
    usage: 'server set port <번호> | server set threads single|multi',
    summary: '웹 서버 포트·스레드 방식 바꾸기',
    run(args, { w, host }) {
      const bad = onWeb(host, w);
      if (bad) return bad;
      const [key, value] = args;
      if (key === 'port' && value && /^\d+$/.test(value)) {
        w.web!.port = parseInt(value, 10);
        return { lines: [green(`포트를 ${value} 로 바꾸고 재시작했어요.`)], events: ['server_port'] };
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
    maxStage: 3,
    aliases: ['ss -lt', 'netstat', 'ss'],
    minStage: 3,
    usage: 'ports',
    summary: '이 장비에서 열려 있는(듣고 있는) 포트 보기',
    run(_a, { w, host }) {
      const rows = [bold('STATE   ADDRESS            PROGRAM')];
      rows.push(`LISTEN  0.0.0.0:22          sshd`);
      if (w.web && w.web.host === host && w.web.running) rows.push(`LISTEN  0.0.0.0:${String(w.web.port).padEnd(11)}enroll-app (수강신청)`);
      return out(...rows);
    },
  },
  {
    name: 'curl',
    maxStage: 3,
    minStage: 3,
    usage: 'curl [-v] http://<이름>[:포트]/<경로>',
    summary: '로봇 손님처럼 HTTP 요청 보내기',
    run(args, { w, host }) {
      const verbose = args.includes('-v');
      const url = args.find((a) => a !== '-v');
      const m = url?.match(/^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/);
      if (!m) return err('사용법: curl [-v] http://web/enroll');
      const [, name, portStr, path = '/'] = m;
      const port = portStr ? parseInt(portStr, 10) : 80;
      const ip = resolveName(w, name);
      if (!ip) return err(`curl: (6) Could not resolve host: ${name}`);
      const p = ping(w, host, name);
      const lines: string[] = [];
      if (verbose) lines.push(dim(`*   Trying ${ip}:${port}...`));
      if (!p.ok) {
        lines.push(red(`curl: (28) Failed to connect to ${name} port ${port}: Timed out`));
        return { lines };
      }
      const s = w.web;
      const serves = s && s.running && p.targetId === s.host && s.port === port;
      if (!serves) {
        if (verbose) lines.push(dim('> SYN  →'), dim('< RST  ← (그 포트에서 듣고 있는 프로그램이 없어요)'));
        lines.push(red(`curl: (7) Failed to connect to ${name} port ${port}: Connection refused`));
        return { lines, events: ['curl:refused'] };
      }
      if (verbose) {
        lines.push(
          dim('> SYN       → "얘기할래?"'),
          dim('< SYN-ACK   ← "응, 너도?"'),
          dim('> ACK       → "응!"   (3-way handshake 완료)'),
          dim(`* Connected to ${name} (${ip}) port ${port}`),
          dim(`> GET ${path} HTTP/1.1`),
          dim(`> Host: ${name}`),
        );
      }
      const found = s!.routes.includes(path);
      if (verbose) lines.push(dim(`< HTTP/1.1 ${found ? '200 OK' : '404 Not Found'}`), dim('< Content-Type: application/json'));
      if (!found) {
        lines.push(yellow(`{"error":"Not Found","path":"${path}"}`));
        return { lines, events: [`curl:404:${path}`] };
      }
      const body: Record<string, string> = {
        '/': '{"service":"KHU 수강신청","status":"ok"}',
        '/enroll': '{"message":"수강신청 페이지","open":true}',
        '/courses': '{"courses":["자료구조","이산구조","마이크로서비스프로그래밍"]}',
      };
      lines.push(green(body[path] ?? '{"status":"ok"}'));
      return { lines, events: [`curl:200:${path}`] };
    },
  },
  {
    name: 'notice show',
    maxStage: 3,
    aliases: ['notice'],
    minStage: 3,
    usage: 'notice show',
    summary: '학생 공지에 적힌 수강신청 주소 보기',
    run(_a, { w }) {
      if (!w.notice) return err('공지가 없어요.');
      return out(`📢 학생 공지: "수강신청은 http://web${w.notice.url} 에서!"`);
    },
  },
  {
    name: 'notice set',
    maxStage: 3,
    minStage: 3,
    usage: 'notice set <경로>',
    summary: '학생 공지의 주소 고치기',
    run(args, { w }) {
      if (!w.notice || !args[0]?.startsWith('/')) return err('사용법: notice set /경로');
      w.notice.url = args[0];
      return ok(`공지를 고쳤어요: http://web${args[0]}`);
    },
  },
];
