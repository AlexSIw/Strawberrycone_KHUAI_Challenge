import { podsOf, readyPods, rollback, setImage } from '../k8s';
import type { Command, CmdResult } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';
import type { World } from '../types';

function cluster(w: World): CmdResult | null {
  return w.k8s ? null : err('이 데이터센터에는 아직 쿠버네티스가 없어요.');
}

/** Accepts "enroll", "deploy/enroll", "deployment/enroll". */
const appName = (s: string | undefined) => (s ?? '').replace(/^(deploy|deployment)\//, '');

export const k8sCommands: Command[] = [
  {
    name: 'get pods',
    aliases: ['pods', 'get po'],
    minStage: 6,
    usage: 'pods',
    summary: 'pod(가장 작은 실행 단위) 목록',
    run(_a, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const rows = [bold('NAME            STATUS             RESTARTS  NODE  VERSION   IP')];
      for (const p of w.k8s!.pods) {
        const st = p.status === 'Running' ? green(p.status.padEnd(18)) : p.status === 'Pending' ? yellow(p.status.padEnd(18)) : red(p.status.padEnd(18));
        rows.push(`${p.name.padEnd(16)}${st} ${String(p.restarts).padEnd(9)} ${p.node.padEnd(5)} ${p.version.padEnd(9)} ${p.ip}`);
      }
      return { lines: rows, events: ['k8s_get_pods'] };
    },
  },
  {
    name: 'get nodes',
    aliases: ['nodes'],
    minStage: 6,
    usage: 'nodes',
    summary: '노드(일하는 서버) 상태',
    run(_a, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const rows = [bold('NAME  STATUS     RACK    TEMP   PODS')];
      for (const [id, n] of Object.entries(w.k8s!.nodes)) {
        const temp = w.cooling?.temps[n.rack] ?? 24;
        const t = temp >= 40 ? red(`${temp.toFixed(0)}°C`) : temp >= 32 ? yellow(`${temp.toFixed(0)}°C`) : `${temp.toFixed(0)}°C`;
        rows.push(`${id.padEnd(6)}${n.ready ? green('Ready'.padEnd(10)) : red('NotReady'.padEnd(10))} ${n.rack.padEnd(7)} ${t.padEnd(6)} ${w.k8s!.pods.filter((p) => p.node === id).length}`);
      }
      return { lines: rows, events: ['k8s_get_nodes'] };
    },
  },
  {
    name: 'get deploy',
    aliases: ['deploys', 'get deployments'],
    minStage: 6,
    usage: 'deploys',
    summary: '원하는 상태(Deployment) 목록',
    run(_a, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const rows = [bold('NAME      READY   UP-TO-DATE  IMAGE')];
      for (const [name, d] of Object.entries(w.k8s!.deployments)) {
        const ready = readyPods(w.k8s!, name).length;
        const upToDate = podsOf(w.k8s!, name).filter((p) => p.version === (d.rolling?.target ?? d.image)).length;
        const r = ready < d.replicas ? yellow(`${ready}/${d.replicas}`.padEnd(8)) : green(`${ready}/${d.replicas}`.padEnd(8));
        rows.push(`${name.padEnd(10)}${r}${String(upToDate).padEnd(12)}${d.rolling ? yellow(`${d.image} → ${d.rolling.target}`) : d.image}`);
      }
      return out(...rows);
    },
  },
  {
    name: 'get svc',
    aliases: ['svcs', 'get services'],
    minStage: 6,
    usage: 'svcs',
    summary: 'Service(바뀌지 않는 대표 번호) 목록',
    run(_a, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const rows = [bold('NAME          → PODS')];
      for (const [name, s] of Object.entries(w.k8s!.services)) {
        rows.push(`${name.padEnd(14)}→ ${readyPods(w.k8s!, s.selector).map((p) => p.ip).join(', ') || red('(연결된 pod 없음)')}`);
      }
      return out(...rows, dim('Service 이름으로 부르면 pod가 바뀌어도 알아서 연결돼요.'));
    },
  },
  {
    name: 'scale',
    minStage: 6,
    usage: 'scale <앱> <개수>',
    summary: '원하는 pod 개수 바꾸기',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      // supports "scale enroll 10" and "scale deploy/enroll --replicas=10"
      const name = appName(args.find((a) => !a.startsWith('-') && !/^\d+$/.test(a)));
      const nStr = args.find((a) => /^\d+$/.test(a)) ?? args.find((a) => a.startsWith('--replicas='))?.split('=')[1];
      const n = parseInt(nStr ?? '', 10);
      const dep = w.k8s!.deployments[name];
      if (!dep || Number.isNaN(n)) return err('사용법: scale <앱> <개수>  (예: scale enroll 10)');
      dep.replicas = Math.max(0, Math.min(16, n));
      return { lines: [green(`${name} 원하는 개수 → ${dep.replicas}. 쿠버네티스가 알아서 맞춰요.`)], events: [`k8s_scale:${name}`] };
    },
  },
  {
    name: 'rollout status',
    minStage: 6,
    usage: 'rollout status <앱>',
    summary: '배포 진행 상황',
    run(args, { w }) {
      const dep = w.k8s?.deployments[appName(args[0])];
      if (!dep) return err('사용법: rollout status <앱>');
      if (!dep.rolling) return ok(`배포 완료: ${dep.image}`);
      const done = podsOf(w.k8s!, appName(args[0])).filter((p) => p.version === dep.rolling!.target).length;
      return out(yellow(`배포 중: ${dep.image} → ${dep.rolling.target} (${done}/${dep.replicas} 교체)`));
    },
  },
  {
    name: 'rollout history',
    minStage: 6,
    usage: 'rollout history <앱>',
    summary: '이전 버전 기록',
    run(args, { w }) {
      const dep = w.k8s?.deployments[appName(args[0])];
      if (!dep) return err('사용법: rollout history <앱>');
      return out(...dep.history.map((v, i) => `  ${i + 1}  ${v}`), `  *  ${dep.rolling?.target ?? dep.image} (현재)`);
    },
  },
  {
    name: 'rollout undo',
    minStage: 6,
    usage: 'rollout undo <앱>',
    summary: '이전 버전으로 되돌리기',
    run(args, { w }) {
      const name = appName(args[0]);
      if (!w.k8s?.deployments[name]) return err('사용법: rollout undo <앱>');
      const prev = rollback(w.k8s, name);
      if (!prev) return err('되돌릴 이전 버전이 없어요.');
      return { lines: [green(`${name} 를 ${prev} 로 되돌리는 중… (한 개씩 교체)`)], events: [`k8s_undo:${name}`] };
    },
  },
  {
    name: 'set image',
    minStage: 6,
    usage: 'set image <앱> <이미지:태그>',
    summary: '새 버전 배포 (rolling update)',
    run(args, { w }) {
      const name = appName(args[0]);
      if (!w.k8s?.deployments[name] || !args[1]) return err('사용법: set image enroll enroll:v3');
      if (args[1].endsWith(':latest')) return err(':latest 태그는 쓰지 마세요. 나중에 되돌릴 버전을 알 수 없어져요.');
      setImage(w.k8s, name, args[1]);
      return ok(`${name} rolling update 시작 → ${args[1]}`);
    },
  },
  {
    name: 'logs',
    minStage: 6,
    usage: 'logs <pod 이름>',
    summary: 'pod 로그 보기',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const ref = args[0] ?? '';
      if (ref && ref === w.flags.crashedPod) {
        return out(red('Error from server (NotFound): pod 가 이미 사라졌어요.'), dim('(쿠버네티스가 그 자리를 새 pod로 채웠어요. pods 로 확인해보세요)'));
      }
      const p = w.k8s!.pods.find((x) => x.name === ref || x.name.startsWith(ref));
      if (!p) return err('그런 pod가 없어요. (pods 로 이름 확인)');
      const lines = [dim(`[${p.name}] started (${p.version})`)];
      if (p.app === 'enroll') {
        const url = w.k8s!.deployments.enroll.env.COURSE_URL;
        const svc = w.k8s!.services[url];
        const reach = svc ? readyPods(w.k8s!, svc.selector).length > 0 : readyPods(w.k8s!, 'course').some((c) => c.ip === url);
        if (!reach) lines.push(red(`ERROR course 호출 실패: connect ${url}:8000 timed out`), dim(`COURSE_URL=${url}`));
        if (w.k8s!.badVersions.includes(p.version)) lines.push(red(`ERROR TypeError in /enroll (${p.version}) — 500 Internal Server Error`));
        if (lines.length === 1) lines.push(green('GET /enroll 200'), green('POST /enroll 201'));
      } else lines.push(green('GET / 200'));
      return { lines, events: [`k8s_logs:${p.app}`] };
    },
  },
  {
    name: 'env',
    minStage: 6,
    usage: 'env <앱> | env set <앱> KEY=VALUE',
    summary: '앱 환경변수(설정) 보기·바꾸기',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      if (args[0] === 'set') {
        const dep = w.k8s!.deployments[appName(args[1])];
        const m = args[2]?.match(/^(\w+)=(.+)$/);
        if (!dep || !m) return err('사용법: env set enroll KEY=VALUE');
        dep.env[m[1]] = m[2];
        return { lines: [green(`${appName(args[1])}: ${m[1]}=${m[2]} (pod들이 새 설정으로 다시 떠요)`)], events: ['k8s_env'] };
      }
      const dep = w.k8s!.deployments[appName(args[0])];
      if (!dep) return err('사용법: env <앱>');
      const entries = Object.entries(dep.env);
      return out(...(entries.length ? entries.map(([k, v]) => `${k}=${v}`) : [dim('(없음)')]));
    },
  },
];
