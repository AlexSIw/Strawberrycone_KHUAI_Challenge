import type { Container, World } from '../types';
import type { Command, CmdResult } from './types';
import { bold, dim, err, green, ok, out, red, yellow } from './types';

function dockerHost(w: World, host: string): CmdResult | null {
  if (!w.docker) return err('docker: command not found');
  if (host !== 'ops' && !w.docker.hosts[host]) return err(`${host} 에는 Docker가 설치돼 있지 않아요.`);
  return null;
}

function findContainer(w: World, host: string, ref: string): Container | undefined {
  return w.docker!.containers.find((c) => c.host === host && (c.name === ref || c.id.startsWith(ref)));
}

const imageName = (ref: string) => (ref.includes(':') ? ref : `${ref}:latest`);

export const dockerCommands: Command[] = [
  {
    name: 'docker build',
    maxStage: 5,
    minStage: 5,
    usage: 'docker build -t <이미지:태그> .',
    summary: 'Dockerfile(레시피 카드)로 이미지(밀키트 원본) 만들기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const t = args.indexOf('-t');
      const tag = t >= 0 ? args[t + 1] : undefined;
      if (!tag) return err('사용법: docker build -t enroll:1.0 .');
      const name = tag.split(':')[0];
      const recipe = w.flags[`dockerfile:${name}`];
      if (recipe !== 'ok') return err(`${name} 의 Dockerfile(레시피 카드)이 아직 없어요. 관제실 설계 보드에서 레시피를 먼저 완성하세요.`);
      if (!w.docker!.built.includes(imageName(tag))) w.docker!.built.push(imageName(tag));
      return {
        lines: [
          dim('Step 1/4 : FROM python:3.12-slim'),
          dim('Step 2/4 : COPY . /app'),
          dim('Step 3/4 : RUN pip install -r requirements.txt'),
          dim('Step 4/4 : CMD ["python", "app.py"]'),
          green(`Successfully tagged ${imageName(tag)}`),
        ],
        events: [`docker_build:${name}`],
      };
    },
  },
  {
    name: 'docker push',
    maxStage: 5,
    minStage: 5,
    usage: 'docker push <이미지:태그>',
    summary: '이미지를 레지스트리(마트 냉동고)에 올리기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const img = args[0] ? imageName(args[0]) : '';
      if (!img) return err('사용법: docker push enroll:1.0');
      if (!w.docker!.built.includes(img)) return err(`An image does not exist locally with the tag: ${img}`);
      if (!w.docker!.registry.includes(img)) w.docker!.registry.push(img);
      return { lines: [dim(`The push refers to repository [registry.khu.ac.kr/${img.split(':')[0]}]`), green(`${img}: pushed`)], events: [`docker_push:${img}`] };
    },
  },
  {
    name: 'docker pull',
    maxStage: 5,
    minStage: 5,
    usage: 'docker pull <이미지:태그>',
    summary: '레지스트리에서 이미지 받아오기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const img = args[0] ? imageName(args[0]) : '';
      if (!w.docker!.registry.includes(img)) return err(`Error response from daemon: manifest for ${img} not found (레지스트리에 없어요. push 했나요?)`);
      const h = w.docker!.hosts[host];
      if (h && !h.pulled.includes(img)) h.pulled.push(img);
      return ok(`Status: Downloaded newer image for ${img}`);
    },
  },
  {
    name: 'docker images',
    maxStage: 5,
    minStage: 5,
    usage: 'docker images',
    summary: '이 장비에 있는 이미지 목록',
    run(_a, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const list = host === 'ops' ? w.docker!.built : w.docker!.hosts[host].pulled;
      return out(bold('REPOSITORY:TAG'), ...(list.length ? list.map((i) => `  ${i}`) : [dim('  (없음)')]));
    },
  },
  {
    name: 'docker run',
    maxStage: 5,
    minStage: 5,
    usage: 'docker run [-p 호스트포트:컨테이너포트] [-v 볼륨:/경로] [--name 이름] <이미지>',
    summary: '이미지로 컨테이너(한 끼) 실행',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      if (host === 'ops') return err('관리 PC에서는 실행하지 않아요. 서버에 접속해서 실행하세요 (예: ssh srv-new).');
      let ports: [number, number] | null = null;
      let volume: string | null = null;
      let name: string | null = null;
      let image: string | null = null;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-p') {
          const m = args[++i]?.match(/^(\d+):(\d+)$/);
          if (!m) return err('-p 형식: 호스트포트:컨테이너포트 (예: -p 80:8000)');
          ports = [parseInt(m[1], 10), parseInt(m[2], 10)];
        } else if (a === '-v') {
          const m = args[++i]?.match(/^([\w-]+):(\/[\w/.-]*)$/);
          if (!m) return err('-v 형식: 볼륨이름:/컨테이너경로 (예: -v dbdata:/var/lib/mysql)');
          volume = m[1];
        } else if (a === '--name') name = args[++i] ?? null;
        else if (a === '-d' || a === '--rm') continue;
        else image = a;
      }
      if (!image) return err('사용법: docker run -p 80:8000 enroll:1.0');
      const img = imageName(image);
      const d = w.docker!;
      const lines: string[] = [];
      if (!d.hosts[host].pulled.includes(img)) {
        if (!d.registry.includes(img)) return err(`Unable to find image '${img}' (레지스트리에도 없어요)`);
        lines.push(dim(`Unable to find image '${img}' locally`), dim(`Pulling from registry... done`));
        d.hosts[host].pulled.push(img);
      }
      const base = img.split(':')[0];
      const cname = name ?? base;
      if (d.containers.some((c) => c.host === host && c.name === cname)) {
        return err(`Conflict. The container name "${cname}" is already in use. (먼저 docker rm -f ${cname})`);
      }
      if (volume && !d.volumes.includes(volume)) d.volumes.push(volume);
      d.nextId += 1;
      const id = (0x3a7f00 + d.nextId * 4099).toString(16).padStart(12, 'c').slice(0, 12);
      d.containers.push({ id, name: cname, image: img, host, ports, volume, running: true });
      lines.push(green(id));
      if (base === 'mysql' && volume && d.enrollments === 0) {
        d.enrollments = Number(w.flags.backupRows) || 1520;
        lines.push(green(`(어젯밤 백업을 볼륨 ${volume} 에 복원했어요: 신청 내역 ${d.enrollments}건)`));
      }
      if (!ports) lines.push(dim('(포트 연결 없이 실행했어요)'));
      return { lines, events: [`docker_run:${base}`] };
    },
  },
  {
    name: 'docker ps',
    maxStage: 5,
    minStage: 5,
    usage: 'docker ps [-a]',
    summary: '실행 중인 컨테이너 보기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const all = args.includes('-a');
      const list = w.docker!.containers.filter((c) => c.host === host && (all || c.running));
      const rows = [bold('CONTAINER ID   IMAGE          STATUS    PORTS            VOLUME     NAME')];
      for (const c of list) {
        const ports = c.ports ? `0.0.0.0:${c.ports[0]}->${c.ports[1]}` : dim('(없음)'.padEnd(16));
        rows.push(`${c.id}   ${c.image.padEnd(14)} ${c.running ? green('Up'.padEnd(9)) : red('Exited'.padEnd(9))} ${typeof ports === 'string' ? ports.padEnd(16) : ports} ${(c.volume ?? '-').padEnd(10)} ${c.name}`);
      }
      if (!list.length) rows.push(dim('  (없음)'));
      return { lines: rows, events: ['docker_ps'] };
    },
  },
  {
    name: 'docker rm',
    maxStage: 5,
    minStage: 5,
    usage: 'docker rm -f <이름>',
    summary: '컨테이너 지우기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const ref = args.find((a) => !a.startsWith('-'));
      const c = ref ? findContainer(w, host, ref) : undefined;
      if (!c) return err('그런 컨테이너가 없어요. (docker ps -a 로 확인)');
      w.docker!.containers = w.docker!.containers.filter((x) => x !== c);
      if (c.name === 'db' && !c.volume) w.docker!.enrollments = 0;
      return ok(`${c.name} 삭제`);
    },
  },
  {
    name: 'docker restart',
    maxStage: 5,
    minStage: 5,
    usage: 'docker restart <이름>',
    summary: '컨테이너 재시작',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const c = args[0] ? findContainer(w, host, args[0]) : undefined;
      if (!c) return err('그런 컨테이너가 없어요.');
      c.running = true;
      if (c.name === 'db' && !c.volume) w.docker!.enrollments = 0;
      return { lines: [green(`${c.name} 재시작`)], events: [`docker_restart:${c.name}`] };
    },
  },
  {
    name: 'docker logs',
    maxStage: 5,
    minStage: 5,
    usage: 'docker logs <이름>',
    summary: '컨테이너 로그 보기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      const c = args[0] ? findContainer(w, host, args[0]) : undefined;
      if (!c) return err('그런 컨테이너가 없어요.');
      if (c.name === 'db') {
        return out(
          dim('mysqld: ready for connections.'),
          w.docker!.enrollments === 0 ? yellow('[Warning] Table enrollments is empty (새로 만든 빈 DB 같아요)') : `enrollments rows: ${w.docker!.enrollments}`,
          dim(`data dir: /var/lib/mysql ${c.volume ? `→ volume:${c.volume}` : '(컨테이너 안 · 지우면 함께 사라짐)'}`),
        );
      }
      return out(dim(` * Running on http://0.0.0.0:8000`), dim(' * 수강신청 앱 준비 완료'));
    },
  },
  {
    name: 'docker volume',
    maxStage: 5,
    minStage: 5,
    usage: 'docker volume create <이름> | docker volume ls',
    summary: '볼륨(식당 전용 사물함) 만들기·보기',
    run(args, { w, host }) {
      const bad = dockerHost(w, host);
      if (bad) return bad;
      if (args[0] === 'create' && args[1]) {
        if (!w.docker!.volumes.includes(args[1])) w.docker!.volumes.push(args[1]);
        return ok(args[1]);
      }
      return out(bold('VOLUME NAME'), ...(w.docker!.volumes.length ? w.docker!.volumes.map((v) => `  ${v}`) : [dim('  (없음)')]));
    },
  },
  {
    name: 'python --version',
    maxStage: 5,
    aliases: ['python3 --version', 'python -V'],
    minStage: 5,
    usage: 'python --version',
    summary: '이 서버에 설치된 Python 버전',
    run(_a, { w, host }) {
      const h = w.docker?.hosts[host];
      return out(`Python ${h?.python ?? '3.12.4'}`);
    },
  },
  {
    name: 'deploy log',
    maxStage: 5,
    aliases: ['cat deploy.log'],
    minStage: 5,
    usage: 'deploy log',
    summary: '손으로 한 배포 기록 보기',
    run(_a, { w, host }) {
      const m = w.docker?.manualDeploy;
      if (!m || m.host !== host) return out(dim('이 서버에는 배포 기록이 없어요.'));
      if (m.status === 'ok') return out(green(`${m.service} 정상 실행 중`));
      return {
        events: ['deploy_log_failed'],
        lines: [
        `$ pip install -r requirements.txt`,
        red('ERROR: Package \'enroll-app\' requires a different Python: 3.9.18 not in \'>=3.11\''),
        `$ python app.py`,
        red('ModuleNotFoundError: No module named \'fastapi\''),
          yellow('→ 배포 실패: 이 서버 환경이 기존 서버와 달라요.'),
        ],
      };
    },
  },
];

/** Students can reach the enroll app if some host runs an enroll container published on port 80. */
export function enrollContainerReachable(w: World): boolean {
  return !!w.docker?.containers.some((c) => c.running && c.image.startsWith('enroll:') && c.ports?.[0] === 80);
}
