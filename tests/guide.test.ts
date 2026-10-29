// The first-time guide (Objective.why / steps) and the radio's mission mode:
//  - steps tick by the real world and events as real IOS lines are typed (D-4's VLAN mission, with a guide
//    written here so the test doesn't depend on the day's wording);
//  - the IOS mode line names each mode in plain words, with the way back;
//  - the radio answers a mission question with no AI: why + next step + concept card (or the card asked about);
//  - askMission is free (no hint ladder, no points) and talks to the Worker in mission mode.
import { afterEach, describe, expect, it, vi } from 'vitest';

// The store reads localStorage when it is created: give it one (node has none) before it loads.
vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
});

import { cannedMission, conceptIn, requestMissionText } from '../src/ai/client';
import { CONCEPTS } from '../src/content/concepts';
import { getStage } from '../src/content/stages';
import type { GuideStep, Objective } from '../src/content/types';
import { applyCommand, startStage, type StageRun } from '../src/sim/engine';
import type { IosMode } from '../src/sim/types';
import { gameStore, MISSION_NEXT_ASK, MISSION_THREAD } from '../src/store/game';
import { guideOf, iosModeText, missionInFocus } from '../src/ui/objectiveStatus';

const D4 = getStage(1);
const vlanMission = D4.objectives.find((o) => o.id === 'vlan')!;
const tor = (w: StageRun['world']) => w.devices['TOR-01']?.nd;

/** A first-time guide for the VLAN mission, ticked by IOS events and by the switch's real VLAN table. */
const STEPS: GuideStep[] = [
  { text: '관리자 모드로', cmd: 'enable', why: '설정을 보려면 관리자여야 해요', done: (_w, c) => c.events.includes('ios:TOR-01:enable') },
  { text: '설정 모드로 들어가기', cmd: 'configure terminal', done: (_w, c) => c.events.includes('ios:TOR-01:configure terminal') },
  { text: 'VLAN 10 만들기', cmd: 'vlan 10', done: (w) => 10 in (tor(w)?.vlans ?? {}) },
  { text: 'VLAN 20 만들기', cmd: 'vlan 20', done: (w) => 20 in (tor(w)?.vlans ?? {}) },
];
Object.assign(vlanMission, {
  why: 'VLAN은 스위치 한 대 안을 동네로 나누는 거예요. WEB 서버와 DB 서버를 다른 동네에 두려고 만들어요.',
  steps: STEPS,
});

/** Types lines on a D-4 run the way the terminal does (host and IOS mode follow each line). */
function typeLines(run: StageRun, lines: string[], at = { host: 'ops', mode: null as IosMode | null }) {
  let r = run;
  for (const line of lines) {
    const out = applyCommand(r, line, at.host, at.mode);
    r = out.run;
    at.host = out.host;
    at.mode = out.mode;
  }
  return { run: r, at };
}

describe('first-time steps tick as the player really types', () => {
  it('each IOS line ticks its step, and the next one is the first not done', () => {
    let { run, at } = typeLines(startStage(1), ['ssh TOR-01']);
    const ticks = () => {
      const g = guideOf(vlanMission, run)!;
      return { done: g.rows.map((r) => r.done), next: g.next?.cmd ?? null };
    };
    expect(ticks()).toEqual({ done: [false, false, false, false], next: 'enable' });
    ({ run, at } = typeLines(run, ['en'], at));
    expect(ticks()).toEqual({ done: [true, false, false, false], next: 'configure terminal' });
    ({ run, at } = typeLines(run, ['conf t'], at));
    expect(ticks().next).toBe('vlan 10');
    // A wrong line ticks nothing.
    ({ run, at } = typeLines(run, ['vlan'], at));
    expect(ticks().next).toBe('vlan 10');
    ({ run, at } = typeLines(run, ['vlan 10', 'name WEB', 'exit'], at));
    expect(ticks()).toEqual({ done: [true, true, true, false], next: 'vlan 20' });
    ({ run } = typeLines(run, ['vlan 20'], at));
    expect(ticks()).toEqual({ done: [true, true, true, true], next: null });
    expect(guideOf(vlanMission, run)!.doneCount).toBe(4);
  });

  it('the next step carries its command and its why; done steps keep their tick out of order too', () => {
    // VLAN 20 made first (from a console, say): that step is ticked, the next is still enable.
    const run = startStage(1);
    run.world.devices['TOR-01']!.nd!.vlans[20] = 'DB';
    const g = guideOf(vlanMission, run)!;
    expect(g.rows.map((r) => r.done)).toEqual([false, false, false, true]);
    expect(g.next).toMatchObject({ text: '관리자 모드로', cmd: 'enable', why: '설정을 보려면 관리자여야 해요', next: true });
    expect(g.rows.filter((r) => r.next)).toHaveLength(1);
  });

  it('no steps: no guide; a step whose check throws counts as not done', () => {
    const run = startStage(1);
    expect(guideOf(D4.objectives.find((o) => !o.steps), run)).toBeNull();
    expect(guideOf(undefined, run)).toBeNull();
    const broken: Objective = { id: 'x', text: 'x', done: () => false, steps: [{ text: '깨진 단계', done: () => { throw new Error('content slip'); } }] };
    expect(guideOf(broken, run)!.rows[0].done).toBe(false);
  });

  it('every day: every objective with steps evaluates on a fresh run, with words in each step', () => {
    for (const day of [0, 1, 2, 3, 4, 5] as const) {
      const run = startStage(day);
      for (const o of getStage(day).objectives) {
        if (!o.steps) continue;
        expect(o.steps.length, `${day}:${o.id}`).toBeGreaterThan(0);
        expect(() => guideOf(o, run)).not.toThrow();
        for (const s of o.steps) expect(s.text.trim(), `${day}:${o.id}`).not.toBe('');
      }
    }
  });
});

describe('the IOS mode, in plain words', () => {
  it('names every mode and says how to go back', () => {
    expect(iosModeText({ level: 'user' })).toEqual({ mark: '>', name: '구경 모드 (보기만 해요)', back: 'exit: 장비에서 나가기' });
    expect(iosModeText({ level: 'exec' })).toMatchObject({ mark: '#', name: expect.stringContaining('관리자 모드') });
    expect(iosModeText({ level: 'config' })).toMatchObject({ mark: '(config)#', name: '장비 전체 설정', back: expect.stringContaining('end') });
    expect(iosModeText({ level: 'config-if', ifs: ['Gi1/0/1'] })).toMatchObject({ mark: '(config-if)#', name: '포트 하나 설정 (Gi1/0/1)', back: 'exit: (config)#로 · end: #로' });
    expect(iosModeText({ level: 'config-if', ifs: ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3'] }).name).toBe('포트 여러 개 설정 (Gi1/0/1 외 2개)');
    expect(iosModeText({ level: 'config-if', ifs: ['Vlan10'], vlan: 10 }).name).toBe('VLAN 10의 인터페이스 설정');
    expect(iosModeText({ level: 'config-vlan', vlan: 20 })).toMatchObject({ mark: '(config-vlan)#', name: 'VLAN 설정 (VLAN 20)' });
  });

  it('follows the real session: interface and vlan lines land in the modes it names', () => {
    const { at } = typeLines(startStage(1), ['ssh TOR-01', 'en', 'conf t', 'int gi1/0/1']);
    expect(iosModeText(at.mode!).name).toBe('포트 하나 설정 (Gi1/0/1)');
    const { at: v } = typeLines(startStage(1), ['ssh TOR-01', 'en', 'conf t', 'vlan 10']);
    expect(iosModeText(v.mode!).name).toBe('VLAN 설정 (VLAN 10)');
  });
});

describe('the radio, mission mode, with no AI', () => {
  const atVlan = () => typeLines(startStage(1), ['ssh TOR-01']).run;

  it('the mission in focus: the first open one, or the last on the list when none is open', () => {
    const run = atVlan();
    expect(missionInFocus(D4, run)?.id).toBe('vlan');
    const fresh = startStage(1);
    expect(missionInFocus(D4, fresh)?.id).toBe('ssh');
  });

  it('answers with the why, the next step (command and why) and the concept card', () => {
    const text = cannedMission(atVlan(), vlanMission);
    expect(text).toContain(vlanMission.why!);
    expect(text).toContain('다음 단계: 관리자 모드로 → enable (설정을 보려면 관리자여야 해요)');
    expect(text).toContain(`${CONCEPTS.vlan.name}: ${CONCEPTS.vlan.analogy}`);
  });

  it('a question naming a card answers with that card first', () => {
    expect(conceptIn('VLAN이 뭐예요?')?.id).toBe('vlan');
    expect(conceptIn('HSRP는 왜 필요해요')?.id).toBe('hsrp');
    expect(conceptIn('가상 게이트웨이가 뭐야')?.id).toBe('hsrp');
    expect(conceptIn('게이트웨이가 뭐야')?.id).toBe('gateway');
    expect(conceptIn('L4가 뭐예요')?.id).toBe('l4');
    expect(conceptIn('CRC가 뭐예요')?.id).toBe('portled');
    expect(conceptIn('OOB는?')?.id).toBe('oob');
    expect(conceptIn('pod가 뭐예요')?.id).toBe('pod');
    expect(conceptIn('오늘 점심 뭐 먹지')).toBeUndefined();
    const text = cannedMission(atVlan(), vlanMission, 'DNS가 뭐예요?');
    expect(text.startsWith(`${CONCEPTS.dns.name}:`)).toBe(true);
    expect(text).toContain('다음 단계');
  });

  it('a mission without a guide still says what it is; no mission open says what to do meanwhile', () => {
    const run = startStage(1);
    const ssh = D4.objectives.find((o) => o.id === 'ssh')!;
    expect(cannedMission(run, ssh)).toContain(ssh.why ?? `지금 미션은 "${ssh.text}"야.`);
    run.objectivesDone.ssh = 0;
    expect(cannedMission(run, ssh)).toContain('지금은 열린 미션이 없어');
    expect(cannedMission(run, undefined)).toContain('지금은 열린 미션이 없어');
    // …but a term asked about still gets its card.
    expect(cannedMission(run, undefined, 'VLAN이 뭐야?').startsWith(`${CONCEPTS.vlan.name}:`)).toBe(true);
  });

  it('what the mission shows is said even while an incident bans it (D-4: the DB address in the DNS step, during the VLAN incident)', () => {
    const run = atVlan();
    const vlanIncident = run.scenarios.find((s) => s.id.startsWith('d4-vlan'))!;
    vlanIncident.state = 'active';
    const dns: Objective = {
      id: 'dns',
      text: 'DNS 서버(ns1)에 web·db 이름 등록하기',
      done: () => false,
      steps: [{ text: 'db 이름 등록', cmd: 'dns add db 10.10.20.11', done: () => false }],
    };
    expect(cannedMission(run, dns)).toContain('dns add db 10.10.20.11');
  });
});

describe('askMission (store)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function playD4AtVlan() {
    const S = gameStore.getState;
    S().play(1);
    for (let i = 0; i < 50 && S().dialogue; i++) S().nextDialogue();
    S().command('ssh TOR-01');
    expect(S().run?.objectivesDone).toHaveProperty('ssh');
  }

  it('no AI: the canned answer lands in the mission thread, free (no ladder, no points)', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no worker')));
    playD4AtVlan();
    const S = gameStore.getState;
    const before = S().run!;
    await S().askMission();
    const thread = S().hints[MISSION_THREAD];
    expect(thread.map((m) => m.from)).toEqual(['player', 'mentor']);
    expect(thread[0].text).toBe(MISSION_NEXT_ASK);
    expect(thread[1]).toMatchObject({ source: 'canned' });
    expect(thread[1].text).toContain('enable');
    expect(thread[1].level).toBeUndefined();
    expect(S().hintPending).toBe(false);
    expect(S().run!.hintLevel).toEqual(before.hintLevel);

    // Steps follow the real terminal: after enable, the answer moves on.
    S().command('enable');
    await S().askMission('VLAN이 뭐예요?');
    const last = S().hints[MISSION_THREAD].at(-1)!;
    expect(last.text.startsWith(`${CONCEPTS.vlan.name}:`)).toBe(true);
    expect(last.text).toContain('configure terminal');
  });

  it('with the Worker: mission mode (objectiveId, stage, steps done, incidents going on), never a scenarioId', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(JSON.stringify({ reply: 'enable부터 쳐 봐!', concept: 'VLAN' }), { status: 200 });
    });
    playD4AtVlan();
    const S = gameStore.getState;
    await S().askMission('뭐부터 해요?');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ objectiveId: 'vlan', stage: 1, objectiveDone: false, stepsDone: [false, false, false, false], activeScenarioIds: [], question: '뭐부터 해요?' });
    expect(bodies[0]).not.toHaveProperty('scenarioId');
    expect(S().hints[MISSION_THREAD].at(-1)).toMatchObject({ from: 'mentor', text: 'enable부터 쳐 봐!', source: 'ai' });
  });

  it('the Worker falling back (no key, a leak) gives the radio’s own answer', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ fallback: true }), { status: 200 }));
    const run = typeLines(startStage(1), ['ssh TOR-01']).run;
    const reply = await requestMissionText({ run, history: [], host: 'ops' });
    expect(reply).toEqual({ text: cannedMission(run, vlanMission), source: 'canned' });
  });

  it('emoji in the AI reply are dropped; a reply of nothing else gives the radio’s own answer', async () => {
    const run = typeLines(startStage(1), ['ssh TOR-01']).run;
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ reply: '🎉 좋아! enable부터 쳐 봐 👏' }), { status: 200 }));
    expect(await requestMissionText({ run, history: [], host: 'ops' })).toEqual({ text: '좋아! enable부터 쳐 봐', source: 'ai' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ reply: '👍️' }), { status: 200 }));
    expect(await requestMissionText({ run, history: [], host: 'ops' })).toEqual({ text: cannedMission(run, vlanMission), source: 'canned' });
  });
});
