import { capacity, restartService, scaleService } from '../app';
import type { Command } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

export const svcCommands: Command[] = [
  {
    name: 'svc list',
    maxStage: 4,
    aliases: ['svc', 'svc ls'],
    minStage: 4,
    usage: 'svc list',
    summary: '서비스 상태 보기',
    run(_a, { w }) {
      const app = w.app;
      if (!app) return err('서비스 정보가 없어요.');
      const rows = [bold('SERVICE     STATE      SERVERS  CAPACITY(rps)')];
      for (const s of Object.values(app.services)) {
        const state = s.up ? green('up'.padEnd(10)) : red('DOWN'.padEnd(10));
        const inst = s.installing.length ? yellow(` (+${s.installing.length} 설치중)`) : '';
        rows.push(`${s.name.padEnd(12)}${state} ${String(s.replicas).padEnd(8)} ${capacity(s)}${inst}`);
      }
      rows.push(dim(`현재 접속: ${w.traffic.rps} rps · 구조: ${app.arch === 'monolith' ? '모놀리스(한 덩어리)' : 'MSA(서비스 분리)'}`));
      return out(...rows);
    },
  },
  {
    name: 'svc restart',
    maxStage: 4,
    minStage: 4,
    usage: 'svc restart <서비스>',
    summary: '서비스 재시작',
    run(args, { w }) {
      if (!w.app || !args[0] || !restartService(w.app, args[0])) return err('사용법: svc restart <서비스>  (svc list 로 이름 확인)');
      const extra = w.app.arch === 'monolith' && w.app.notifyBug ? dim(' (그런데… 버그가 그대로라 또 죽을지도?)') : '';
      return { lines: [green(`${args[0]} 재시작!`) + extra], events: [`svc_restart:${args[0]}`] };
    },
  },
  {
    name: 'svc scale',
    maxStage: 4,
    minStage: 4,
    usage: 'svc scale <서비스> <서버 수>',
    summary: '서비스 서버 수 늘리기/줄이기 (손으로 설치라 오래 걸림)',
    run(args, { w }) {
      const n = parseInt(args[1] ?? '', 10);
      if (!w.app || !args[0] || Number.isNaN(n) || !scaleService(w.app, args[0], n)) return err('사용법: svc scale <서비스> <서버 수>');
      if (w.app.arch === 'monolith') return out(yellow('모놀리스는 통째로만 늘릴 수 있어요… 그래도 시도해볼게요.'));
      const s = w.app.services[args[0]];
      if (s.installing.length) return out(yellow(`${args[0]} 서버 ${s.installing.length}대를 손으로 설치하는 중… (한 대에 몇 초씩 걸려요)`));
      return ok(`${args[0]} 서버 수: ${s.replicas}`);
    },
  },
  {
    name: 'svc deps',
    maxStage: 4,
    minStage: 4,
    usage: 'svc deps <서비스>',
    summary: '서비스가 누구를 부르고 어떤 DB를 쓰는지',
    run(args, { w }) {
      const s = w.app?.services[args[0] ?? ''];
      if (!s) return err('사용법: svc deps <서비스>');
      const own = `${s.name}-db`;
      const db = s.dbAccess.map((d) => (d === own || s.name === 'monolith' ? d : red(`${d}  ⚠ 남의 DB를 직접 읽는 중!`)));
      return out(
        bold(`${s.name}`),
        `  API 호출 →  ${s.calls.length ? s.calls.join(', ') : dim('(없음)')}`,
        `  DB 접근  →  ${db.length ? db.join(', ') : dim('(없음)')}`,
      );
    },
  },
  {
    name: 'svc config',
    maxStage: 4,
    minStage: 4,
    usage: 'svc config <서비스> course-source api|db',
    summary: '과목 정보를 API로 받을지, DB에서 직접 읽을지 설정',
    run(args, { w }) {
      const [name, key, value] = args;
      const s = w.app?.services[name ?? ''];
      if (!s || key !== 'course-source' || (value !== 'api' && value !== 'db')) return err('사용법: svc config <서비스> course-source api|db');
      if (value === 'api') {
        s.dbAccess = s.dbAccess.filter((d) => d !== 'course-db');
        if (!s.calls.includes('course')) s.calls.push('course');
        return { lines: [green(`${name} 이제 과목 정보를 course 서비스 API로만 받아요.`)], events: ['svc_config'] };
      }
      if (!s.dbAccess.includes('course-db')) s.dbAccess.push('course-db');
      return out(yellow(`${name} 가 course-db 를 직접 읽도록 바꿨어요… 괜찮을까요?`));
    },
  },
];
