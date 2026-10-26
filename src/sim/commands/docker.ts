import type { Container, DockerState, World } from '../types';
import { own } from '../util';
import type { Command, CmdResult } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

// ---------- what the programs inside the images look like ----------

/** Port the program in each image listens on inside its container. */
export const APP_PORT: Readonly<Record<string, number>> = { enroll: 8000, mysql: 3306 };
/** Students come in through the web port. */
export const WEB_PORT = 80;
/** Folder MySQL keeps its data in, inside the container. */
export const MYSQL_DATA_DIR = '/var/lib/mysql';
/** The enroll app is configured to reach its database at this server's published MySQL port. */
export const DB_ENDPOINT = { host: 'srv-db', port: 3306 } as const;
/** `w.flags` key naming an image release with a bug (D-2's bad deploy): its app answers every request with a 500. */
export const BAD_IMAGE_FLAG = 'docker:badImage';

/** The enroll recipe. The design board's card and the `docker build` output both print these lines. */
export const ENROLL_DOCKERFILE: readonly string[] = [
  'FROM python:3.12-slim',
  'WORKDIR /app',
  'COPY . /app',
  'RUN pip install -r requirements.txt',
  `EXPOSE ${APP_PORT.enroll}`,
  'CMD ["python", "app.py"]',
];

const RECIPES: Readonly<Record<string, readonly string[]>> = { enroll: ENROLL_DOCKERFILE };

const repo = (image: string) => image.split(':')[0];
export const isEnroll = (c: Container) => repo(c.image) === 'enroll';
export const isDb = (c: Container) => repo(c.image) === 'mysql';

/** A running enroll container students can reach: web port outside → the app's port inside. */
export const enrollPublished = (c: Container) =>
  c.running && isEnroll(c) && c.ports?.[0] === WEB_PORT && c.ports[1] === APP_PORT.enroll;

/** Students can reach the enroll app if some server runs an enroll container published correctly. */
export function enrollContainerReachable(w: World): boolean {
  return !!w.docker?.containers.some(enrollPublished);
}

/** MySQL's data survives the container only when a volume is mounted on its data folder. */
export const dataOnVolume = (c: Container) => isDb(c) && !!c.volume && c.volumePath === MYSQL_DATA_DIR;

/** Enrollment rows a DB container sees: on its volume, or in its own writable layer. */
export function dbRows(w: World, c: Container): number {
  if (dataOnVolume(c)) return own(own(w.docker?.hosts, c.host)?.volumes, c.volume!) ?? 0;
  return c.rows;
}

/** The DB the enroll app talks to: a running MySQL container published on srv-db:3306. */
export function appDb(w: World): Container | undefined {
  return w.docker?.containers.find(
    (c) => c.running && isDb(c) && c.host === DB_ENDPOINT.host && c.ports?.[0] === DB_ENDPOINT.port && c.ports[1] === APP_PORT.mysql,
  );
}

/** Container ids look random but stay deterministic for tests. */
export function nextContainerId(d: DockerState): string {
  d.nextId += 1;
  return (0x3a7f00 + d.nextId * 4099).toString(16).padStart(12, 'c').slice(0, 12);
}

// ---------- helpers ----------

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9_.-]+)?$/;
const NO_CONTAINERS_ON_OPS = '관리 PC에는 컨테이너가 없어요. 컨테이너가 도는 서버에 ssh 로 접속해서 하세요.';

function dockerHost(w: World, host: string): CmdResult | null {
  if (!w.docker) return err('docker: command not found');
  if (host !== 'ops' && !own(w.docker.hosts, host)) return err(`${host} 에는 Docker가 설치돼 있지 않아요.`);
  return null;
}

/** Like Docker: an exact name wins; otherwise an ID prefix that matches exactly one container. */
function findContainer(w: World, host: string, ref: string): Container | undefined {
  const here = w.docker!.containers.filter((c) => c.host === host);
  const byName = here.find((c) => c.name === ref);
  if (byName) return byName;
  const byId = here.filter((c) => c.id.startsWith(ref));
  return byId.length === 1 ? byId[0] : undefined;
}

const imageName = (ref: string) => (ref.includes(':') ? ref : `${ref}:latest`);

/** Pad to a terminal column width (Hangul takes two cells), always leaving at least one space. */
function pad(s: string, width: number): string {
  let n = 0;
  for (const ch of s) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(1, width - n));
}

/** Images stored on this machine: the admin PC builds, servers pull. */
const localImages = (w: World, host: string) => (host === 'ops' ? w.docker!.built : w.docker!.hosts[host].pulled);

/** Who already holds this host port on the server (another running container or a non-Docker program), as a sentence subject. */
function portHolder(w: World, host: string, port: number, self?: Container): string | null {
  const c = w.docker!.containers.find((x) => x !== self && x.host === host && x.running && x.ports?.[0] === port);
  if (c) return `${c.name} 컨테이너가`;
  if (own(w.docker!.hosts, host)?.busyPorts?.includes(port)) return '이 서버에 손으로 설치한 프로그램이';
  return null;
}

const portInUse = (port: number, holder: string) =>
  err(`docker: Error response from daemon: Bind for 0.0.0.0:${port} failed: port is already allocated. (${holder} 이미 ${port}번을 쓰고 있어요 · 포트 하나엔 프로그램 하나)`);

/**
 * Normalise option spellings the way Docker's parser reads them:
 * "--publish=80:8000" → ["--publish", "80:8000"], "-dp" → ["-d", "-p"], "-p80:8000" → ["-p", "80:8000"].
 * `valued` lists the short options that take a value; the rest of a cluster after one of them is its value.
 */
function splitFlags(args: string[], valued = ''): string[] {
  const res: string[] = [];
  for (const a of args) {
    if (a.startsWith('--')) {
      const eq = a.match(/^(--[a-zA-Z-]+)=(.*)$/);
      if (eq) res.push(eq[1], eq[2]);
      else res.push(a);
    } else if (/^-[a-zA-Z]./.test(a)) {
      const body = a.slice(1);
      for (let k = 0; k < body.length && body[k] !== '='; k++) {
        res.push(`-${body[k]}`);
        if (valued.includes(body[k]) && k + 1 < body.length) {
          res.push(body.slice(k + 1).replace(/^=/, ''));
          break;
        }
      }
    } else res.push(a);
  }
  return res;
}

interface RunOpts {
  ports: [number, number] | null;
  volume: string | null;
  volumePath: string | null;
  name: string | null;
  image: string;
}

const RUN_FLAGS_HELP = '쓸 수 있는 옵션: -p, -v, --name, -d, -e, --rm';

function parsePublish(v: string | undefined): [number, number] | string {
  const m = v?.match(/^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d{1,5}):(\d{1,5})(?:\/tcp)?$/);
  if (!m) return `-p 형식: 바깥(호스트)포트:안쪽(컨테이너)포트 (예: -p 8080:3000 → 서버의 8080번 문을 컨테이너 안 3000번과 이어요)`;
  if (m[1] && m[1] !== '0.0.0.0') {
    return m[1].startsWith('127.')
      ? `-p ${v}: 127.0.0.1 에 묶으면 그 서버 안에서만 들어올 수 있어요. 바깥(학생)에서 들어오게 하려면 IP 없이 바깥포트:안쪽포트 로 써요.`
      : `-p ${v}: 이 게임에서는 IP 없이 바깥포트:안쪽포트 로 써요.`;
  }
  const hp = parseInt(m[2], 10);
  const cp = parseInt(m[3], 10);
  if (hp < 1 || hp > 65535 || cp < 1 || cp > 65535) return `-p ${v}: 포트 번호는 1~65535 사이예요.`;
  return [hp, cp];
}

function parseVolume(v: string | undefined): [string, string] | string {
  const usage = '-v 형식: 볼륨이름:/컨테이너 안 폴더 (예: -v mydata:/data)';
  const m = v?.match(/^([^:]+):([^:]+)(?::(?:rw|ro))?$/);
  if (!m) return usage;
  const [, src, dst] = m;
  if (!NAME_RE.test(src) && !/^\.?\/[\w./-]*$/.test(src)) return `${usage} — 볼륨 이름에는 영문·숫자·_ . - 만 써요.`;
  if (!/^\/[\w./-]*$/.test(dst)) return `${usage} — 컨테이너 안 폴더는 / 로 시작하는 전체 경로(절대 경로)로 써요.`;
  return [src, dst.length > 1 ? dst.replace(/\/+$/, '') : dst];
}

function parseRun(raw: string[]): RunOpts | string {
  const args = splitFlags(raw, 'pve');
  const o: Omit<RunOpts, 'image'> = { ports: null, volume: null, volumePath: null, name: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-p' || a === '--publish') {
      if (o.ports) return '이 게임에서는 -p 를 한 번만 써요.';
      const p = parsePublish(args[++i]);
      if (typeof p === 'string') return p;
      o.ports = p;
    } else if (a === '-v' || a === '--volume') {
      if (o.volume) return '이 게임에서는 -v 를 한 번만 써요.';
      const v = parseVolume(args[++i]);
      if (typeof v === 'string') return v;
      [o.volume, o.volumePath] = v;
    } else if (a === '--name') {
      const n = args[++i];
      if (!n || !NAME_RE.test(n)) return '--name 뒤에 컨테이너 이름을 써요 (영문·숫자·_ . - 만).';
      o.name = n;
    } else if (a === '-e' || a === '--env' || a === '--restart') {
      if (args[++i] === undefined) return `${a} 뒤에 값이 필요해요.`;
    } else if (['-d', '--detach', '--rm', '-i', '-t', '--interactive', '--tty'].includes(a)) {
      continue;
    } else if (a.startsWith('-')) {
      return `${a}: 이 게임에서는 안 쓰는 옵션이에요. (${RUN_FLAGS_HELP})`;
    } else {
      // Everything after the image is the command to run inside the container, not a docker option.
      const rest = args.slice(i + 1);
      if (rest.some((x) => x.startsWith('-'))) {
        return `이미지 이름 뒤에 쓴 "${rest.join(' ')}" 는 컨테이너 안에서 실행할 명령으로 넘어가요. docker 옵션은 이미지 이름 앞에 써요.`;
      }
      if (!IMAGE_RE.test(a)) return `docker: invalid reference format: ${a} (이미지 이름은 소문자로, 이름:태그(버전) 형식)`;
      return { ...o, image: a };
    }
  }
  return `사용법: docker run [-p 바깥포트:안쪽포트] [-v 볼륨:/폴더] [--name 이름] <이미지>`;
}

/** Container commands (rm/stop/start/…) only make sense on a server. */
function onServer(w: World, host: string): CmdResult | null {
  const bad = dockerHost(w, host);
  if (bad) return bad;
  return host === 'ops' ? err(NO_CONTAINERS_ON_OPS) : null;
}

const notFound = () => err('그런 컨테이너가 없어요. (docker ps -a 로 이름 확인)');

// ---------- commands ----------

export const dockerCommands: Command[] = [
  {
    name: 'docker build',
    aliases: ['docker image build'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker build -t <이미지:태그> .',
    summary: 'Dockerfile(레시피 카드)로 이미지(밀키트 원본) 만들기',
    run(raw, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      // The recipe (from the design board) and the app code are on the admin PC; servers get images from the registry.
      if (host !== 'ops') return err('레시피(Dockerfile)와 앱 코드는 관리 PC에 있어요. exit 로 관리 PC(ops)에 돌아가서 빌드하세요.');
      const args = splitFlags(raw, 't');
      const t = args.findIndex((a) => a === '-t' || a === '--tag');
      const tag = t >= 0 ? args[t + 1] : undefined;
      if (!tag || tag.startsWith('-')) return err('사용법: docker build -t <이미지:태그> .   (-t 로 이미지 이름과 태그(버전 이름표, 예: 1.0)를 붙여요)');
      if (!IMAGE_RE.test(tag)) return err(`docker: invalid reference format: ${tag} (이미지 이름은 소문자로, 이름:태그(버전) 형식)`);
      const name = repo(tag);
      const recipe = own(RECIPES, name);
      if (!recipe || own(w.flags, `dockerfile:${name}`) !== 'ok') {
        const have = Object.keys(RECIPES).filter((r) => own(w.flags, `dockerfile:${r}`) === 'ok');
        if (have.length) {
          return err(`${name} 용 레시피(Dockerfile)는 없어요. 설계 보드에서 완성한 레시피: ${have.join(', ')} → 이미지 이름을 레시피 이름과 같게 하세요.`);
        }
        return err(`${name} 의 Dockerfile(레시피 카드)이 아직 없어요. 관제실 설계 보드에서 레시피를 먼저 완성하세요.`);
      }
      const img = imageName(tag);
      const local = localImages(w, host);
      if (!local.includes(img)) local.push(img);
      const hasContext = args.some((a, i) => !a.startsWith('-') && i !== t + 1);
      return {
        lines: [
          ...recipe.map((l, i) => dim(`Step ${i + 1}/${recipe.length} : ${l}`)),
          green(`Successfully tagged ${img}`),
          dim('(Step = 레시피(Dockerfile) 한 줄씩 차례로 실행 · Successfully tagged = 이 이름표로 이미지를 다 만들었어요)'),
          ...(hasContext ? [] : [dim('(실제 docker 에서는 끝에 빌드할 폴더를 꼭 적어요. 지금 폴더면 "." )')]),
        ],
        events: [`docker_build:${name}`],
      };
    },
  },
  {
    name: 'docker push',
    aliases: ['docker image push'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker push <이미지:태그>',
    summary: '이미지를 레지스트리(마트 냉동고)에 올리기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const img = args[0] ? imageName(args[0]) : '';
      if (!img) return err('사용법: docker push <이미지:태그>');
      if (!localImages(w, host).includes(img)) return err(`An image does not exist locally with the tag: ${img} (이 장비에서 빌드한 이미지가 아니에요 · docker images 로 확인)`);
      if (!w.docker!.registry.includes(img)) w.docker!.registry.push(img);
      return { lines: [dim(`The push refers to repository [registry.khu.ac.kr/${repo(img)}]`), green(`${img}: pushed`)], events: [`docker_push:${img}`] };
    },
  },
  {
    name: 'docker pull',
    aliases: ['docker image pull'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker pull <이미지:태그>',
    summary: '레지스트리에서 이미지 받아오기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const img = args[0] ? imageName(args[0]) : '';
      if (!img) return err('사용법: docker pull <이미지:태그>');
      if (!w.docker!.registry.includes(img)) return err(`Error response from daemon: manifest for ${img} not found (레지스트리에 없어요. push 했나요?)`);
      const local = localImages(w, host);
      if (!local.includes(img)) local.push(img);
      return ok(`Status: Downloaded newer image for ${img}`);
    },
  },
  {
    name: 'docker images',
    aliases: ['docker image ls', 'docker image list'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker images',
    summary: '이 장비에 있는 이미지 목록',
    run(_a, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const list = localImages(w, host);
      return out(
        bold('REPOSITORY:TAG'),
        ...(list.length ? [...list.map((i) => `  ${i}`), dim('(이미지 = 컨테이너를 찍어 내는 원본 · 이름:태그 에서 태그는 버전 이름표)')] : [dim('  (없음)')]),
      );
    },
  },
  {
    name: 'docker run',
    aliases: ['docker container run'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker run [-p 바깥포트:안쪽포트] [-v 볼륨:/폴더] [--name 이름] <이미지>',
    summary: '이미지로 컨테이너(한 끼) 실행',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      if (host === 'ops') return err('관리 PC에서는 실행하지 않아요. 서버에 접속해서 실행하세요 (예: ssh srv-new).');
      const o = parseRun(args);
      if (typeof o === 'string') return err(o);
      const d = w.docker!;
      const h = d.hosts[host];
      const img = imageName(o.image);
      const lines: string[] = [];
      if (!h.pulled.includes(img)) {
        if (!d.registry.includes(img)) {
          const tags = d.registry.filter((r) => repo(r) === repo(img));
          return err(`Unable to find image '${img}' (레지스트리에도 없어요${tags.length ? ` · 레지스트리에 있는 것: ${tags.join(', ')}` : ''})`);
        }
        lines.push(dim(`Unable to find image '${img}' locally`), dim(`Pulling from registry... done`));
        h.pulled.push(img);
      }
      const base = repo(img);
      const cname = o.name ?? base;
      if (d.containers.some((c) => c.host === host && c.name === cname)) {
        return err(`Conflict. The container name "${cname}" is already in use. (먼저 docker rm -f ${cname})`);
      }
      const holder = o.ports && portHolder(w, host, o.ports[0]);
      if (o.ports && holder) return portInUse(o.ports[0], holder);
      if (o.volume && own(h.volumes, o.volume) === undefined) h.volumes[o.volume] = 0;
      const c: Container = { id: nextContainerId(d), name: cname, image: img, host, ports: o.ports, volume: o.volume, volumePath: o.volumePath, rows: 0, running: true };
      d.containers.push(c);
      lines.push(green(c.id));
      // Say what was connected, not whether it is right: a wrong inner port or folder is for the player
      // to spot (docker logs shows where the program really listens and writes).
      lines.push(dim(o.ports ? `(바깥 ${o.ports[0]}번 → 컨테이너 안 ${o.ports[1]}번)` : '(포트 연결 없이 실행했어요)'));
      if (c.volume) lines.push(dim(`(볼륨 ${c.volume} → 컨테이너 안 ${c.volumePath})`));
      if (dataOnVolume(c) && host === DB_ENDPOINT.host && h.volumes[c.volume!] === 0) {
        h.volumes[c.volume!] = Number(w.flags.backupRows) || 1520;
        lines.push(green(`(어젯밤 백업을 볼륨 ${c.volume} 에 복원했어요: 신청 내역 ${h.volumes[c.volume!]}건)`));
      }
      if (isDb(c) && appDb(w) !== c) lines.push(dim(`(참고: 신청 앱은 ${DB_ENDPOINT.host} 의 ${DB_ENDPOINT.port}번 포트로 DB에 접속해요)`));
      return { lines, events: [`docker_run:${base}`] };
    },
  },
  {
    name: 'docker ps',
    aliases: ['docker container ls', 'docker container list', 'docker container ps'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker ps [-a]',
    summary: '실행 중인 컨테이너 보기 (-a: 멈춘 것까지)',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const all = args.includes('-a') || args.includes('--all');
      const list = w.docker!.containers.filter((c) => c.host === host && (all || c.running));
      const rows = [bold(`CONTAINER ID   ${pad('IMAGE', 15)}${pad('STATUS', 10)}${pad('PORTS', 19)}${pad('VOLUME', 11)}NAME`)];
      for (const c of list) {
        const ports = c.ports && c.running ? pad(`0.0.0.0:${c.ports[0]}->${c.ports[1]}`, 19) : dim(pad('(없음)', 19));
        rows.push(`${c.id}   ${pad(c.image, 15)}${c.running ? green(pad('Up', 10)) : red(pad('Exited', 10))}${ports}${pad(c.volume ?? '-', 11)}${c.name}`);
      }
      if (!list.length) rows.push(dim(host === 'ops' ? '  (없음 · 관리 PC에는 컨테이너가 없어요. 서버에 ssh 로 접속해서 보세요)' : '  (없음)'));
      else rows.push(dim('(PORTS 의 a->b = 서버의 a번 문 → 컨테이너 안 b번 문 · STATUS: Up 실행 중, Exited 멈춤 · VOLUME = 붙여 둔 볼륨, - 는 없음)'));
      return { lines: rows, events: ['docker_ps'] };
    },
  },
  {
    name: 'docker rm',
    aliases: ['docker container rm'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker rm -f <이름>',
    summary: '컨테이너 지우기 (-f: 실행 중이어도 강제로)',
    run(raw, { w, host }) {
      const bad = onServer(w, host);
      if (bad) return bad;
      const args = splitFlags(raw);
      const force = args.includes('-f') || args.includes('--force');
      const refs = args.filter((a) => !a.startsWith('-'));
      if (!refs.length) return err('사용법: docker rm -f <이름>');
      const lines: string[] = [];
      const events: string[] = [];
      for (const ref of refs) {
        const c = findContainer(w, host, ref);
        if (!c) return { lines: [...lines, ...notFound().lines], events };
        if (c.running && !force) {
          lines.push(red(`Error response from daemon: You cannot remove a running container ${c.name}. (실행 중이에요 · docker stop 으로 먼저 멈추거나 docker rm -f 로 강제 삭제)`));
          continue;
        }
        w.docker!.containers = w.docker!.containers.filter((x) => x !== c);
        lines.push(green(`${c.name} 삭제`));
        if (c.rows > 0) lines.push(dim('(컨테이너 안에 저장돼 있던 데이터도 컨테이너와 함께 지워졌어요)'));
        events.push(`docker_rm:${c.name}`);
      }
      return { lines, events };
    },
  },
  {
    name: 'docker stop',
    aliases: ['docker container stop'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker stop <이름>',
    summary: '컨테이너 멈추기 (지우지는 않음)',
    run(args, { w, host }) {
      const bad = onServer(w, host);
      if (bad) return bad;
      const ref = args.find((a) => !a.startsWith('-'));
      const c = ref ? findContainer(w, host, ref) : undefined;
      if (!c) return notFound();
      c.running = false;
      return { lines: [green(c.name), dim('(멈춘 컨테이너도 남아 있어요 · docker ps -a 로 보이고, docker start 로 다시 켜요)')], events: [`docker_stop:${c.name}`] };
    },
  },
  {
    name: 'docker start',
    aliases: ['docker container start'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker start <이름>',
    summary: '멈춘 컨테이너 다시 켜기',
    run(args, { w, host }) {
      const bad = onServer(w, host);
      if (bad) return bad;
      const ref = args.find((a) => !a.startsWith('-'));
      const c = ref ? findContainer(w, host, ref) : undefined;
      if (!c) return notFound();
      const holder = !c.running && c.ports ? portHolder(w, host, c.ports[0], c) : null;
      if (c.ports && holder) return portInUse(c.ports[0], holder);
      c.running = true;
      return { lines: [green(c.name)], events: [`docker_start:${c.name}`] };
    },
  },
  {
    name: 'docker restart',
    aliases: ['docker container restart'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker restart <이름>',
    summary: '컨테이너 재시작 (같은 컨테이너를 껐다 켜기)',
    run(args, { w, host }) {
      const bad = onServer(w, host);
      if (bad) return bad;
      const ref = args.find((a) => !a.startsWith('-'));
      const c = ref ? findContainer(w, host, ref) : undefined;
      if (!c) return notFound();
      const holder = !c.running && c.ports ? portHolder(w, host, c.ports[0], c) : null;
      if (c.ports && holder) return portInUse(c.ports[0], holder);
      c.running = true;
      const lines = [green(`${c.name} 재시작`)];
      if (isDb(c) && !dataOnVolume(c)) lines.push(dim('(같은 컨테이너를 껐다 켠 거라 안에 있던 데이터는 그대로예요)'));
      return { lines, events: [`docker_restart:${c.name}`] };
    },
  },
  {
    name: 'docker logs',
    aliases: ['docker container logs'],
    maxStage: 3,
    minStage: 3,
    usage: 'docker logs <이름>',
    summary: '컨테이너 로그 보기',
    run(args, { w, host }) {
      const bad = onServer(w, host);
      if (bad) return bad;
      const ref = args.find((a) => !a.startsWith('-'));
      const c = ref ? findContainer(w, host, ref) : undefined;
      if (!c) return notFound();
      const lines: string[] = [];
      if (isDb(c)) {
        const rows = dbRows(w, c);
        lines.push(
          dim(`mysqld: ready for connections. port: ${APP_PORT.mysql}`),
          rows === 0 ? yellow('[Warning] Table enrollments is empty (새로 만든 빈 DB 같아요)') : `enrollments rows: ${rows}`,
          dataOnVolume(c)
            ? dim(`data dir: ${MYSQL_DATA_DIR} → volume:${c.volume}`)
            : dim(`data dir: ${MYSQL_DATA_DIR} (컨테이너 안 · 컨테이너를 지우면 함께 사라짐)${c.volume ? ` · 볼륨(${c.volume})은 ${c.volumePath} 에 붙어 있음` : ''}`),
        );
      } else {
        const db = appDb(w);
        lines.push(
          dim(` * Running on http://0.0.0.0:${APP_PORT.enroll}`),
          dim(' * 수강신청 앱 준비 완료'),
          db ? dim(` * DB ${DB_ENDPOINT.host}:${DB_ENDPOINT.port} 연결됨`) : red(` * DB ${DB_ENDPOINT.host}:${DB_ENDPOINT.port} 연결 실패 (응답 없음)`),
        );
        if (own(w.flags, BAD_IMAGE_FLAG) === c.image) {
          lines.push(red(`ERROR TypeError in /enroll (${c.image}) — 500 Internal Server Error (앱이 요청을 처리하다 오류로 멈췄어요)`));
        }
      }
      if (!c.running) lines.push(dim('(멈춘 컨테이너예요 · docker start 로 다시 켜요)'));
      return out(...lines);
    },
  },
  {
    name: 'docker volume',
    maxStage: 3,
    minStage: 3,
    usage: 'docker volume create <이름> | docker volume ls',
    summary: '볼륨(식당 전용 사물함) 만들기·보기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      if (host === 'ops') return err('관리 PC에서는 볼륨을 쓰지 않아요. 컨테이너가 도는 서버에 ssh 로 접속해서 쓰세요.');
      const vols = w.docker!.hosts[host].volumes;
      if (args[0] === 'create') {
        const v = args[1];
        if (!v || !NAME_RE.test(v)) return err('사용법: docker volume create <이름> (영문·숫자·_ . - 만)');
        if (own(vols, v) === undefined) vols[v] = 0;
        return ok(v);
      }
      if (args.length === 0 || args[0] === 'ls' || args[0] === 'list') {
        const names = Object.keys(vols).filter((v) => NAME_RE.test(v));
        return out(bold('VOLUME NAME'), ...(names.length ? names.map((v) => `  ${v}`) : [dim('  (없음)')]));
      }
      return err('사용법: docker volume create <이름> | docker volume ls');
    },
  },
  {
    name: 'python --version',
    maxStage: 3,
    aliases: ['python3 --version', 'python -V'],
    minStage: 3,
    usage: 'python --version',
    summary: '이 서버에 설치된 Python(앱을 만든 프로그래밍 언어) 버전',
    run(_a, { w, host }) {
      const h = own(w.docker?.hosts, host);
      return out(`Python ${h?.python ?? '3.12.4'}`);
    },
  },
  {
    name: 'deploy log',
    maxStage: 3,
    aliases: ['cat deploy.log'],
    minStage: 3,
    usage: 'deploy log',
    summary: '손으로 한 배포(앱 설치·실행) 기록 보기',
    run(_a, { w, host }) {
      const m = w.docker?.manualDeploy;
      if (!m || m.host !== host) return out(dim('이 서버에는 배포 기록이 없어요.'));
      if (m.status === 'ok') return out(green(`${m.service} 정상 실행 중`));
      return {
        events: ['deploy_log_failed'],
        lines: [
          `$ pip install -r requirements.txt`,
          red('ERROR: Package \'enroll-app\' requires a different Python: 3.9.18 not in \'>=3.11\''),
          dim('(앱에 필요한 부품 설치가 거절됐어요: 이 서버의 Python은 3.9인데, 앱은 3.11 이상이 필요해요)'),
          `$ python app.py`,
          red('ModuleNotFoundError: No module named \'fastapi\''),
          dim('(부품(fastapi)이 안 깔려서 앱이 켜지지 못했어요)'),
          yellow('→ 배포 실패: 이 서버 환경이 기존 서버와 달라요.'),
        ],
      };
    },
  },
];
