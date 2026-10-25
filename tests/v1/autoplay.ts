// How a player completes each stage's objectives, shared by the playthrough and pacing tests.
// (Not a test file itself: vitest only collects tests/**/*.test.ts.)
import { applyDesired, connectCable, mount, setFeeds, writeDockerfile } from '../../src/sim/actions';
import { applyAction, applyCommand, recordEvents, type StageRun } from '../../src/sim/engine';
import type { SolutionStep } from '../../src/sim/scenario';

export type Step = { cmd: string; host: string } | { action: Parameters<typeof applyAction>[1]; events?: string[] } | { events: string[] };

export const RED = '\x1b[31m';

/** How a player completes each objective. */
export const AUTOPLAY: Record<number, Record<string, Step[]>> = {
  0: {
    visit: [{ events: ['room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc'] }],
    dashboard: [{ events: ['open:dashboard'] }],
    mentor: [{ events: ['open:mentor'] }],
    quiz: [{ events: ['quiz:correct'] }],
  },
  1: {
    mount: [{ action: (w) => ['web', 'db', 'spare'].forEach((id) => mount(w, id)) }],
    power: [{ action: (w) => ['web', 'db', 'spare'].forEach((id) => setFeeds(w, id, ['A'])) }],
    cable: [{ action: (w) => ['web', 'db', 'spare'].forEach((id, i) => connectCable(w, `${id}:eth0`, `sw1:p${i + 1}`)) }],
  },
  2: {
    terminal: [{ events: ['open:terminal'] }],
    dhcp: [{ cmd: 'dhcp on', host: 'ops' }],
    ping: [{ cmd: 'ping web', host: 'ops' }],
  },
  3: {
    start: [{ cmd: 'server start', host: 'web' }],
    curl: [{ cmd: 'curl http://web/enroll', host: 'ops' }],
  },
  4: { watch: [{ cmd: 'svc list', host: 'ops' }] },
  5: {
    log: [{ cmd: 'deploy log', host: 'srv-new' }],
    recipe: [{ action: (w) => writeDockerfile(w, 'enroll'), events: ['board:dockerfile'] }],
    image: [
      { cmd: 'docker build -t enroll:1.0 .', host: 'ops' },
      { cmd: 'docker push enroll:1.0', host: 'ops' },
    ],
    run: [{ cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' }],
  },
  6: {
    desired: [{ action: (w) => applyDesired(w, 'enroll', 3, 'enroll:v1'), events: ['board:desired'] }],
    observe: [{ cmd: 'pods', host: 'ops' }],
  },
  7: { postmortem: [{ events: ['board:postmortem'] }] },
};

/** Objective steps may print expected errors (e.g. a refused curl); solution steps must not. */
export function apply(run: StageRun, step: Step | SolutionStep, errors: string[] | null): StageRun {
  if ('cmd' in step) {
    const res = applyCommand(run, step.cmd, step.host);
    const bad = res.lines.filter((l) => l.startsWith(RED));
    if (bad.length && errors) errors.push(`${step.host}$ ${step.cmd} → ${bad.join(' | ')}`);
    return res.run;
  }
  if ('action' in step) return applyAction(run, step.action, 'events' in step ? step.events ?? [] : []).run;
  return recordEvents(run, step.events).run;
}
