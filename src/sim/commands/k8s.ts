import { APP_PORT, cordon, drain, endpointReaches, parseEndpoint, podAge, podsOf, readyPods, rollback, setImage, unscheduled } from '../k8s';
import type { Command, CmdResult } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';
import { LAST_DAY, type Deployment, type World } from '../types';
import { own } from '../util';

function cluster(w: World): CmdResult | null {
  return w.k8s ? null : err('이 데이터센터에는 아직 쿠버네티스가 없어요.');
}

/** What an enroll pod's log says about its DB-01 connections, or null when they are fine. */
function dbTrouble(w: World): string | null {
  const k = w.k8s;
  const max = w.db?.maxConn;
  if (!k || max === undefined) return null;
  const raw = k.deployments.enroll?.env.DB_POOL;
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n < 1) {
    return `ERROR DB-01 연결 실패: DB_POOL 값을 읽지 못했어요 ('${raw ?? ''}') — 1 이상의 정수여야 DB 연결을 열 수 있어요`;
  }
  const want = readyPods(k, 'enroll').length * n;
  if (want <= max) return null;
  return `ERROR DB-01 연결 실패: too many connections (${max}/${max}) — 이 pod도 연결 ${n}개를 미리 잡으려 해요 (pod 전체 ${want}개 > 한도 ${max})`;
}

/** `scale` never asks for more pods than this per app. */
const MAX_REPLICAS = 16;

/** Accepts "enroll", "deploy/enroll", "deployment/enroll". */
const appName = (s: string | undefined) => (s ?? '').replace(/^(deploy|deployment|deployments)(\.apps)?\//, '');

/** kubectl also takes the kind as its own word: "scale deployment enroll …", "rollout undo deploy enroll". */
const KIND = /^(deploy|deployment|deployments)(\.apps)?$/;

/** kubectl flags whose value is the next word ("-n default", "-c enroll", "-o wide"). */
const VALUE_FLAGS = new Set(['-n', '--namespace', '-c', '--container', '-o', '--output', '-l', '--selector', '--tail', '--since', '--context']);

/**
 * Positional words: flags (and the value of "-n default"-style flags) left out, and a leading
 * resource kind word skipped. "--replicas 10" keeps 10, since scale reads the bare number.
 */
function positional(args: string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (VALUE_FLAGS.has(a)) i += 1;
      continue;
    }
    pos.push(a);
  }
  return pos.length > 1 && KIND.test(pos[0]) ? pos.slice(1) : pos;
}

/** The deployment a player named, looked up safely ("constructor" is just an unknown name). */
const deploymentOf = (w: World, name: string): Deployment | undefined => own(w.k8s?.deployments, name);

/** Accepts "n1" and "node/n1". */
const nodeName = (s: string | undefined) => (s ?? '').replace(/^(node|nodes|no)\//, '');

const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

export const k8sCommands: Command[] = [
  {
    name: 'get pods',
    aliases: ['pods', 'get po', 'get pod'],
    minStage: 4,
    usage: 'pods',
    summary: 'pod(가장 작은 실행 단위) 목록',
    run(_a, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const k = w.k8s!;
      const rows = [bold('NAME            STATUS             RESTARTS  AGE    NODE    VERSION    IP')];
      for (const p of k.pods) {
        const st = p.status === 'Running' ? green(p.status.padEnd(18)) : p.status === 'Pending' ? yellow(p.status.padEnd(18)) : red(p.status.padEnd(18));
        const node = unscheduled(p) ? yellow('<none>'.padEnd(7)) : p.node.padEnd(7);
        rows.push(`${p.name.padEnd(16)}${st} ${String(p.restarts).padEnd(9)} ${podAge(p, w.t).padEnd(6)} ${node} ${p.version.padEnd(10)} ${p.ip || '<none>'}`);
      }
      if (k.pods.some(unscheduled)) {
        // What `kubectl describe pod` would say about a pod the scheduler could not place.
        const nodes = Object.values(k.nodes);
        const notReady = nodes.filter((n) => !n.ready).length;
        const full = Object.entries(k.nodes).filter(([id, n]) => n.ready && k.pods.filter((p) => p.node === id).length >= k.maxPodsPerNode).length;
        rows.push(dim(`NODE <none> = 아직 들어갈 노드가 없어 기다리는 pod (0/${nodes.length} nodes are available: NotReady(일할 수 없음) ${notReady}대, 자리 꽉 참 ${full}대)`));
      }
      return { lines: rows, events: ['k8s_get_pods'] };
    },
  },
  {
    name: 'get nodes',
    aliases: ['nodes', 'get node', 'get no'],
    minStage: 4,
    usage: 'nodes',
    summary: '노드(일하는 서버) 상태',
    run(_a, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const nodes = Object.entries(w.k8s!.nodes);
      const status = (n: (typeof nodes)[number][1]) => (n.ready ? 'Ready' : 'NotReady') + (n.cordoned ? ',SchedulingDisabled' : '');
      // The STATUS column is as wide as its longest value ("NotReady,SchedulingDisabled" while draining).
      const width = Math.max(10, ...nodes.map(([, n]) => status(n).length + 1));
      const rows = [bold(`NAME  ${'STATUS'.padEnd(width)} RACK    TEMP   PODS`)];
      for (const [id, n] of nodes) {
        const temp = w.cooling?.temps[n.rack] ?? 24;
        // Pad before colouring: colour codes would otherwise count toward the width and shift PODS.
        const label = `${temp.toFixed(0)}°C`.padEnd(6);
        const t = temp >= 40 ? red(label) : temp >= 32 ? yellow(label) : label;
        const st = status(n).padEnd(width);
        rows.push(`${id.padEnd(6)}${n.ready && !n.cordoned ? green(st) : n.ready ? yellow(st) : red(st)} ${n.rack.padEnd(7)} ${t} ${w.k8s!.pods.filter((p) => p.node === id).length}`);
      }
      return { lines: rows, events: ['k8s_get_nodes'] };
    },
  },
  {
    name: 'get deploy',
    aliases: ['deploys', 'get deployments', 'get deployment'],
    minStage: 4,
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
      return { lines: rows, events: ['k8s_get_deploy'] };
    },
  },
  {
    name: 'get svc',
    aliases: ['svcs', 'get services', 'get service'],
    minStage: 4,
    usage: 'svcs',
    summary: 'Service(바뀌지 않는 대표 번호) 목록',
    run(_a, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const rows = [bold('NAME          → PODS')];
      for (const [name, s] of Object.entries(w.k8s!.services)) {
        rows.push(`${name.padEnd(14)}→ ${readyPods(w.k8s!, s.selector).map((p) => p.ip).join(', ') || red('(연결된 pod 없음)')}`);
      }
      return { lines: [...rows, dim('Service 이름으로 부르면 pod가 바뀌어도 알아서 연결돼요.')], events: ['k8s_get_svc'] };
    },
  },
  {
    name: 'cordon',
    minStage: 4,
    usage: 'cordon <노드>',
    summary: '노드에 새 pod를 더 보내지 않기 (있던 pod는 그대로)',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const node = nodeName(positional(args)[0]);
      if (!node || !own(w.k8s!.nodes, node)) return err('사용법: cordon <노드>  (nodes 로 이름 확인)');
      if (w.k8s!.nodes[node].cordoned) return out(dim(`node/${node} already cordoned`));
      cordon(w.k8s!, node);
      return { lines: [`node/${node} cordoned`, dim('(이제 이 노드에는 새 pod가 안 들어가요. 있던 pod는 그대로 일해요)')], events: [`k8s_cordon:${node}`] };
    },
  },
  {
    name: 'uncordon',
    minStage: 4,
    usage: 'uncordon <노드>',
    summary: '노드를 다시 pod 받을 수 있게 열기',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const node = nodeName(positional(args)[0]);
      if (!node || !own(w.k8s!.nodes, node)) return err('사용법: uncordon <노드>  (nodes 로 이름 확인)');
      if (!w.k8s!.nodes[node].cordoned) return out(dim(`node/${node} already uncordoned`));
      cordon(w.k8s!, node, false);
      return { lines: [`node/${node} uncordoned`, dim('(이 노드도 다시 새 pod를 받아요)')], events: [`k8s_uncordon:${node}`] };
    },
  },
  {
    name: 'drain',
    minStage: 4,
    usage: 'drain <노드>',
    summary: '노드를 비우기: 새 pod 막고, 있던 pod를 다른 노드로 옮기기',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      const node = nodeName(positional(args)[0]);
      if (!node || !own(w.k8s!.nodes, node)) return err('사용법: drain <노드>  (nodes 로 이름 확인)');
      const lines = [w.k8s!.nodes[node].cordoned ? `node/${node} already cordoned` : `node/${node} cordoned`];
      const gone = drain(w.k8s!, node) ?? [];
      for (const p of gone) lines.push(`evicting pod default/${p.name}`);
      for (const p of gone) lines.push(`pod/${p.name} evicted`);
      lines.push(`node/${node} drained`, dim('(pod들은 다른 노드에서 새로 떠요. 점검이 끝나면 uncordon 으로 다시 열어요)'));
      return { lines, events: [`k8s_cordon:${node}`, `k8s_drain:${node}`] };
    },
  },
  {
    name: 'scale',
    minStage: 4,
    usage: 'scale <앱> <개수>',
    summary: '원하는 pod 개수 바꾸기',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      // "scale enroll 10", "scale deploy/enroll --replicas=10", "scale deployment enroll --replicas 10"
      const pos = positional(args);
      const name = appName(pos.find((a) => !/^\d+$/.test(a)));
      const nStr = pos.find((a) => /^\d+$/.test(a)) ?? args.find((a) => a.startsWith('--replicas='))?.split('=')[1];
      const n = parseInt(nStr ?? '', 10);
      const dep = deploymentOf(w, name);
      if (!dep || Number.isNaN(n)) return err('사용법: scale <앱> <개수>  (예: scale login 3)');
      dep.replicas = Math.max(0, Math.min(MAX_REPLICAS, n));
      const lines = [green(`${name} 원하는 개수 → ${dep.replicas}. 쿠버네티스가 알아서 맞춰요.`)];
      if (n > MAX_REPLICAS) lines.push(dim(`(앱 하나당 최대 ${MAX_REPLICAS}개까지라서 ${MAX_REPLICAS}개로 맞췄어요)`));
      return { lines, events: [`k8s_scale:${name}`] };
    },
  },
  {
    name: 'rollout status',
    minStage: 4,
    usage: 'rollout status <앱>',
    summary: '배포(새 버전 올리기) 진행 상황',
    run(args, { w }) {
      const name = appName(positional(args)[0]);
      const dep = deploymentOf(w, name);
      if (!dep) return err('사용법: rollout status <앱>');
      if (!dep.rolling) return ok(`배포 완료: ${dep.image}`);
      const done = readyPods(w.k8s!, name).filter((p) => p.version === dep.rolling!.target).length;
      return out(yellow(`배포 중: ${dep.image} → ${dep.rolling.target} (새 버전 ${done}/${dep.replicas} 준비됨)`));
    },
  },
  {
    name: 'rollout history',
    minStage: 4,
    usage: 'rollout history <앱>',
    summary: '이전 버전 기록',
    run(args, { w }) {
      const dep = deploymentOf(w, appName(positional(args)[0]));
      if (!dep) return err('사용법: rollout history <앱>');
      return out(...dep.history.map((v, i) => `  ${i + 1}  ${v}`), `  *  ${dep.rolling?.target ?? dep.image} (현재)`);
    },
  },
  {
    name: 'rollout undo',
    minStage: 4,
    usage: 'rollout undo <앱>',
    summary: '이전 버전으로 되돌리기',
    run(args, { w }) {
      const name = appName(positional(args)[0]);
      if (!w.k8s || !deploymentOf(w, name)) return err('사용법: rollout undo <앱>');
      const prev = rollback(w.k8s, name);
      if (!prev) return err('되돌릴 이전 버전이 없어요.');
      return { lines: [green(`${name}: ${prev} 버전으로 되돌리는 중… (새 pod가 준비되면 옛 pod를 하나씩 교체)`)], events: [`k8s_undo:${name}`] };
    },
  },
  {
    name: 'set image',
    minStage: 4,
    usage: 'set image <앱> <앱:태그>',
    summary: '다른 버전 배포 (하나씩 차례로 교체하는 rolling update)',
    run(args, { w }) {
      const [app, raw] = positional(args);
      const name = appName(app);
      if (!w.k8s || !deploymentOf(w, name) || !raw) return err('사용법: set image <앱> <앱:태그>  (예: set image login login:v1)');
      // kubectl form: "set image deployment/enroll enroll=enroll:v1" (container=image)
      const image = raw.includes('=') ? raw.slice(raw.lastIndexOf('=') + 1) : raw;
      if (image.endsWith(':latest')) return err(':latest(늘 "최신"이라는 이름) 태그는 쓰지 마세요. 나중에 어느 버전으로 되돌릴지 알 수 없어져요.');
      if (!image.startsWith(`${name}:`)) return err(`이미지 이름은 ${name}:<태그> 모양이어야 해요. (${name} 앱의 이미지)`);
      const known = w.k8s.images;
      if (known && !known.includes(image)) {
        return err(`${image}: 레지스트리(이미지 보관소)에 그런 이미지가 없어요 (ErrImagePull). 진짜 쿠버네티스라면 새 pod가 이미지를 못 받아서(ImagePullBackOff) 못 떠요. 전에 배포했던 버전은 rollout history ${name} 로 볼 수 있어요.`);
      }
      const heading = deploymentOf(w, name)!.rolling?.target === image;
      if (!setImage(w.k8s, name, image)) {
        return out(dim(heading ? `${name}: 이미 ${image} 버전으로 바꾸는 중이에요. (바뀐 것 없음)` : `${name}: 이미 ${image} 버전이에요. (바뀐 것 없음)`));
      }
      return { lines: [green(`${name} rolling update 시작 → ${image} (새 pod가 준비되면 옛 pod를 하나씩 교체)`)], events: [`k8s_set_image:${name}`] };
    },
  },
  {
    name: 'logs',
    minStage: 4,
    usage: 'logs <pod 이름>',
    summary: 'pod 로그(앱이 남긴 기록) 보기',
    run(args, { w, stage }) {
      const bad = cluster(w);
      if (bad) return bad;
      const k = w.k8s!;
      // "logs enroll-x1izr", "logs -f enroll-x1izr", "logs deploy/enroll" (any pod of that app, like kubectl)
      const ref = appName(positional(args)[0]);
      if (!ref) return err('사용법: logs <pod 이름>  (pods 로 이름 확인)');
      if (ref === w.flags.crashedPod) {
        return out(red('Error from server (NotFound): pod 가 이미 사라졌어요.'), dim('(쿠버네티스가 그 자리를 새 pod로 채웠어요. pods 로 확인해보세요)'));
      }
      // Exact name first; for a prefix like "enroll", prefer a pod that is actually running.
      const p =
        k.pods.find((x) => x.name === ref) ??
        k.pods.find((x) => x.name.startsWith(ref) && x.status === 'Running') ??
        k.pods.find((x) => x.name.startsWith(ref));
      if (!p) return err('그런 pod가 없어요. (pods 로 이름 확인)');
      if (unscheduled(p)) {
        return { lines: [yellow(`[${p.name}] 아직 시작 전: 들어갈 노드가 없어서 기다리는 중이에요 (Pending, NODE <none>).`), dim('nodes 로 노드 상태와 자리를 확인해보세요.')], events: [`k8s_logs:${p.app}`] };
      }
      if (p.status === 'Pending') {
        return { lines: [yellow(`[${p.name}] 컨테이너 준비 중… (ContainerCreating)`)], events: [`k8s_logs:${p.app}`] };
      }
      const lines = [dim(`[${p.name}] started (${p.version})`)];
      let failed = false;
      if (p.app === 'enroll') {
        const url = k.deployments.enroll.env.COURSE_URL ?? '';
        const { host, port } = parseEndpoint(url);
        const svc = own(k.services, host);
        if (!endpointReaches(k, url, 'course')) {
          failed = true;
          if (svc && port !== APP_PORT) lines.push(red(`ERROR course 호출 실패: connect ${host}:${port} refused (그 포트에서 기다리는 앱이 없어요)`));
          else if (svc && svc.selector !== 'course') lines.push(red(`ERROR course 호출 실패: GET http://${host}:${port}/courses → 404 Not Found (이 Service는 '${svc.selector}' 앱 pod들로 연결돼요)`));
          else if (svc || isIp(host)) lines.push(red(`ERROR course 호출 실패: connect ${host}:${port} timed out (아무도 대답하지 않아 기다리다 포기했어요)`));
          else lines.push(red(`ERROR course 호출 실패: getaddrinfo ENOTFOUND ${host || '(빈 주소)'} (그런 이름을 찾을 수 없어요)`));
          lines.push(dim(`COURSE_URL=${url}`));
        } else if (!svc) {
          lines.push(yellow(`WARN course 를 pod IP(${host})로 직접 부르는 중 — 그 pod가 바뀌면 이 주소는 사라져요`));
        }
        if (k.badVersions.includes(p.version)) {
          failed = true;
          lines.push(red(`ERROR TypeError in /enroll (${p.version}) — 500 Internal Server Error (앱이 요청을 처리하다 오류로 멈췄어요)`));
        }
        // D-Day: every Running enroll pod opens its DB_POOL connections to DB-01 (the same model as the
        // day's health and the dday-db incident: a pool that isn't a number ≥ 1, or pods × pool > the limit).
        const db = stage === LAST_DAY ? dbTrouble(w) : null;
        if (db) {
          failed = true;
          lines.push(red(db), dim(`DB_POOL=${k.deployments.enroll.env.DB_POOL ?? '(없음)'}`));
        }
        if (!failed) lines.push(green('GET /enroll 200'), green('POST /enroll 201'));
      } else lines.push(green('GET / 200'));
      return { lines, events: [`k8s_logs:${p.app}`] };
    },
  },
  {
    name: 'env',
    aliases: ['set env'],
    minStage: 4,
    usage: 'env <앱> | env set <앱> KEY=VALUE',
    summary: '앱 환경변수(설정) 보기·바꾸기',
    run(args, { w }) {
      const bad = cluster(w);
      if (bad) return bad;
      // "env set enroll KEY=V", and kubectl's "set env deployment/enroll KEY=V"
      const setting = args[0] === 'set' || args.some((a) => a.includes('='));
      const pos = positional(args[0] === 'set' ? args.slice(1) : args);
      const name = appName(pos[0]);
      const dep = deploymentOf(w, name);
      if (setting) {
        const m = pos[1]?.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
        if (!dep || !m || m[1] === '__proto__') return err('사용법: env set <앱> KEY=VALUE');
        const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
        dep.env[m[1]] = value;
        return { lines: [green(`${name}: ${m[1]}=${value} (pod들이 새 설정으로 다시 떠요)`)], events: ['k8s_env'] };
      }
      if (!dep) return err('사용법: env <앱>');
      const entries = Object.entries(dep.env);
      return out(...(entries.length ? entries.map(([k, v]) => `${k}=${v}`) : [dim('(없음)')]));
    },
  },
];
