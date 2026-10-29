// The AI 사수's answer-leak guard (src/ai/leak.ts, used by the hint Worker): answers in any spelling are
// caught, hints that only point the way pass.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMissionSystem, buildSystem, buildUser, handleHint, parseAnswer, parseInput } from '../worker/src/hint';
import { GUIDE_ASK } from '../src/ai/answer';
import { buildSnapshot } from '../src/ai/client';
import { stripEmoji } from '../src/ai/emoji';
import { bannedFor, ifValueRe, iosScript, leaks, missionBanned, missionShown, phraseRe } from '../src/ai/leak';
import { ALL_SCENARIOS, getStage } from '../src/content/stages';
import { startStage, tickRun, type StageRun } from '../src/sim/engine';
import { initRuntime, type Scenario } from '../src/sim/scenario';

type Guarded = Pick<Scenario, 'bannedPhrases' | 'solutionSteps' | 'bannedIos'>;
const guard = (sc: Guarded) => {
  const banned = bannedFor(sc);
  return (reply: string) => leaks(reply, banned);
};

/** A VLAN misassignment fixed on a TOR: the content writes the IOS script from the `>` prompt. */
const vlanFix: Guarded = {
  bannedPhrases: [],
  solutionSteps: [{ ios: ['enable', 'configure terminal', 'interface GigabitEthernet1/0/5', 'switchport access vlan 20', 'end', 'write memory'], host: 'TOR-01' }],
};

/** A gateway (SVI + HSRP) build on a core, typed the short way. */
const sviFix: Guarded = {
  bannedPhrases: [],
  solutionSteps: [{ ios: ['en', 'conf t', 'int vlan 30', 'ip address 10.10.30.2 255.255.255.0', 'standby 1 ip 10.10.30.1', 'no shut', 'end', 'wr'], host: 'CORE-01' }],
};

describe('IOS scripts: the guard tracks the mode each line is typed in', () => {
  it('user → enable → exec → configure terminal → config → interface → config-if → end → exec', () => {
    expect(iosScript(vlanFix.solutionSteps.flatMap((s) => ('ios' in s ? s.ios : []))).map((l) => l.level)).toEqual([
      'user',
      'exec',
      'config',
      'config-if',
      'config-if',
      'exec',
    ]);
  });
  it('abbreviated navigation is understood too, and vlan / exit move between config levels', () => {
    expect(iosScript(['en', 'conf t', 'vlan 20', 'name STAFF', 'exit', 'int gi1/0/5', 'ex', 'ex', 'wr']).map((l) => `${l.level}:${l.canonical}`)).toEqual([
      'user:enable',
      'exec:configure terminal',
      'config:vlan 20',
      'config-vlan:name STAFF',
      'config-vlan:exit',
      'config:interface Gi1/0/5',
      'config-if:exit',
      'config:exit',
      'exec:write memory',
    ]);
  });
});

describe('IOS answers are caught', () => {
  const vlan = guard(vlanFix);
  const svi = guard(sviFix);
  it('the full form of a value-carrying line', () => {
    expect(vlan('포트에 switchport access vlan 20 을 넣어봐')).toBe(true);
    expect(svi('ip address 10.10.30.2 255.255.255.0 을 쳐')).toBe(true);
  });
  it('the line as the solution wrote it (short form)', () => {
    expect(svi('int vlan 30 들어가서 해봐')).toBe(true);
    expect(svi('stand 1 ip 10.10.30.1 하면 돼')).toBe(true);
  });
  it('a value on its own: an IP, an interface name in any spelling, a VLAN number', () => {
    expect(svi('게이트웨이는 10.10.30.1 이야')).toBe(true);
    expect(vlan('Gi1/0/5 포트가 문제야')).toBe(true);
    expect(vlan('gi 1/0/5를 봐')).toBe(true);
    expect(vlan('GigabitEthernet1/0/5 설정을 봐')).toBe(true);
    expect(vlan('1/0/5번 포트야')).toBe(true);
    expect(vlan('VLAN 20으로 바꿔야 해')).toBe(true);
    expect(vlan('vlan20이 맞아')).toBe(true);
  });
  it.each(['20번 VLAN으로 바꿔야 해', '20 VLAN이 맞아', 'VLAN20번에 넣어', '브이랜 20에 넣어', '20번 브이랜이야', '포트를 20번vlan에'])(
    'a VLAN number written number-first or in Korean: %s',
    (reply) => expect(vlan(reply)).toBe(true),
  );
  it('but not a different port, address or VLAN that only looks alike', () => {
    expect(vlan('Gi1/0/15 는 정상이야')).toBe(false);
    expect(vlan('11/0/5 같은 건 없어')).toBe(false);
    expect(vlan('VLAN 200은 상관없어')).toBe(false);
    expect(vlan('120번 VLAN은 상관없어')).toBe(false);
    expect(vlan('브이랜 200은 상관없어')).toBe(false);
    expect(vlan('Gi1/0/20 VLAN 설정을 봐')).toBe(false);
    expect(svi('10.10.30.10 은 다른 서버야')).toBe(false);
  });
  it('abbreviated forms of a banned line', () => {
    expect(vlan('sw acc vl 20 해봐')).toBe(true);
    expect(vlan('switchport acc vlan 20')).toBe(true);
    expect(vlan('SWITCHP ACCESS VLAN 20')).toBe(true);
    expect(svi('ip add 10.10.30.2 255.255.255.0')).toBe(true);
    expect(svi('stand 1 ip 10.10.30.1')).toBe(true);
  });
  it('bannedIos lines are caught in every abbreviated form', () => {
    const errFix = guard({ bannedPhrases: [], bannedIos: ['no shutdown'], solutionSteps: [{ ios: ['enable', 'configure terminal', 'interface gi1/0/9', 'shutdown', 'no shutdown', 'end'], host: 'TOR-01' }] });
    expect(errFix('no sh 하면 돼')).toBe(true);
    expect(errFix('no shutdown 해봐')).toBe(true);
    expect(errFix('NO SHUT')).toBe(true);
  });
});

describe('generic hints pass', () => {
  const vlan = guard(vlanFix);
  const svi = guard(sviFix);
  it.each([
    'show 명령으로 포트 상태를 봐요',
    '포트가 어느 VLAN에 들어가 있는지 확인해봐. 같은 층 사람들이 다른 방에 있는 셈이야.',
    'enable 하고 configure terminal 로 설정 모드에 들어가면 돼. 다 하면 write memory 로 저장!',
    'show vlan brief 같은 화면에서 포트 목록을 봐',
    '설정을 바꾸고 나면 end 로 나와서 저장하는 거 잊지 마',
    'NMS 경보에 뜬 장비부터 직접 접속해서 상태를 봐',
    // The fix's shape with the values blank, and the lines that carry no value at all.
    'interface <포트> → switchport access vlan <번호> 로 바꾸면 돼',
    'interface vlan <번호> 에 ip address <IP> <마스크> 를 넣고 no shutdown',
    '마지막에 no shut 하면 돼',
  ])('%s', (hint) => {
    expect(vlan(hint)).toBe(false);
    expect(svi(hint)).toBe(false);
  });
  it('navigation becomes banned when the scenario lists it in bannedIos', () => {
    const save = guard({ ...vlanFix, bannedIos: ['write memory'] });
    expect(save('write memory 로 저장해봐')).toBe(true);
    expect(vlan('write memory 로 저장해봐')).toBe(false);
  });
});

describe('shell answers (ported from v1)', () => {
  // v1's s3-404: a typo in the notice path. A leading/trailing space in a phrase = word edge.
  const typo = guard({
    bannedPhrases: ['notice set /enroll', '/enrol ', ' enrol ', 'enrol 오타', 'l이 하나 빠'],
    solutionSteps: [{ cmd: 'notice set /enroll', host: 'ops' }],
  });
  it('blocks the typo with particles and quotes', () => {
    for (const s of ['공지 주소가 /enrol로 되어 있네', '`/enrol` 이랑 비교해봐', "공지 링크가 '/enrol'이네?", '공지 경로가 /enrol.', '공지엔 enrol이라고 적혀 있어']) {
      expect(typo(s), s).toBe(true);
    }
  });
  it('lets the real path through', () => {
    expect(typo('curl 로 /enroll 페이지를 요청해봐')).toBe(false);
    expect(typo('enroll-app 이 듣는 포트를 봐')).toBe(false);
  });
  it('catches whole commands and the exact values in them (IP, CIDR, port pair, KEY=VALUE)', () => {
    const fw = guard({
      bannedPhrases: [],
      solutionSteps: [
        { cmd: 'fw deny 198.51.100.0/24', host: 'FW-01' },
        { cmd: 'docker run -p 80:8000 enroll', host: 'srv-new' },
        { cmd: 'env set enroll DB_POOL=10', host: 'ops' },
        { cmd: 'dns add lms 10.10.30.40', host: 'ns1' },
      ],
    });
    expect(fw('fw deny 198.51.100.0/24 하면 돼')).toBe(true);
    expect(fw('198.51.100.0/24 대역이 수상해')).toBe(true);
    expect(fw('198.51.100.0 쪽에서 몰려와')).toBe(true);
    expect(fw('80:8000 으로 열어')).toBe(true);
    expect(fw('db_pool=10 으로 줄여')).toBe(true);
    expect(fw('주소는 10.10.30.40 이야')).toBe(true);
    // A longer number is a different value.
    expect(fw('10.10.30.41 은 다른 장비야')).toBe(false);
    expect(fw('방화벽 규칙 목록부터 봐')).toBe(false);
  });
});

describe('phrase edges', () => {
  it('a phrase ending in a digit does not run into more digits', () => {
    expect(phraseRe('10.0.1.1').test(' 10.0.1.10 ')).toBe(false);
    expect(phraseRe('10.0.1.1').test(' 10.0.1.1. ')).toBe(true);
  });
  it('interface names: slot/port in any spelling, Po and Vlan with their number', () => {
    const gi = ifValueRe('Gi1/0/5');
    for (const s of ['gi1/0/5', 'g 1/0/5', 'gigabitethernet1/0/5', '포트 1/0/5']) expect(gi.test(s), s).toBe(true);
    expect(gi.test('gi1/0/50')).toBe(false);
    const po = ifValueRe('Po1');
    for (const s of ['po1', 'po 1', 'port-channel 1', 'port-channel1']) expect(po.test(s), s).toBe(true);
    expect(po.test('po12')).toBe(false);
    expect(ifValueRe('Vlan10').test('interface vlan 10')).toBe(true);
  });
});

describe('the snapshot the 사수 gets', () => {
  it('has the day, the clock and the open alarms, but never which incident is behind them', () => {
    const id = 'secret-cause:0';
    const sc: Scenario = {
      id,
      stage: 1,
      title: '보이는 제목',
      alert: '포털이 안 열려요',
      severity: 'critical',
      alarm: { source: 'trap', device: 'TOR-01', text: '포트 링크 다운' },
      room: 'network',
      trigger: { type: 'stageStart' },
      inject: () => {},
      check: () => false,
      hints: ['a', 'b', 'c'],
      bannedPhrases: [],
      solution: '',
      solutionSteps: [],
      todo: '',
      checks: [],
      concept: 'datacenter',
      lesson: '',
    };
    getStage(1).scenarios.push(sc);
    let run: StageRun = { ...startStage(1), scenarios: initRuntime([{ id, trigger: { type: 'stageStart', delay: 1 } }]) };
    for (let i = 0; i < 3; i++) run = tickRun(run).run;
    const snap = buildSnapshot(run, 'TOR-01', 'exec');
    expect(snap).toMatchObject({ day: 'D-4', clock: '09:01', host: 'TOR-01', iosMode: 'exec' });
    expect(snap.alarms).toEqual([{ sev: 'Critical(긴급)', device: 'TOR-01', text: '포트 링크 다운', acked: false }]);
    expect(snap.incidents).toEqual([{ title: '보이는 제목', alert: '포털이 안 열려요', secondsActive: 2 }]);
    expect(JSON.stringify(snap)).not.toContain('secret-cause');
    expect(Array.isArray(snap.portsDown)).toBe(true);
    expect(Array.isArray(snap.busiestLinks)).toBe(true);
  });
});

// ---------- mission mode (the radio during build missions) ----------

const D4_VLAN = ALL_SCENARIOS.find((s) => s.id === 'd4-vlan:0')!;
/** D-4's DNS mission as a first-time guide would show it: DB-01's address is in its own step. */
const dnsMission = {
  text: 'DNS 서버(ns1)에 web·db 이름 등록하기',
  why: 'DNS는 이름을 숫자 주소로 바꿔주는 전화번호부예요.',
  steps: [
    { text: 'DNS 서버로 접속', cmd: 'ssh ns1', done: () => false },
    { text: 'db 이름 등록', cmd: 'dns add db 10.10.20.11', done: () => false },
  ],
};

describe('mission answers: never an incident going on, but what the mission shows is fine', () => {
  const banned = missionBanned([D4_VLAN], missionShown(dnsMission));
  const leak = (reply: string) => leaks(reply, banned);
  it('the incident’s fix and its values stay banned, in any spelling', () => {
    expect(leak('그 포트에 switchport access vlan 20 넣어')).toBe(true);
    expect(leak('sw acc vl 20')).toBe(true);
    expect(leak('Gi1/0/3 포트를 봐')).toBe(true);
    expect(leak('20번 VLAN으로 바꿔')).toBe(true);
  });
  it('the mission’s own step (the DB address the DNS mission registers) is not a leak', () => {
    expect(bannedFor(D4_VLAN).some((re) => re.test(' dns add db 10.10.20.11 '))).toBe(true);
    expect(leak('ns1에서 dns add db 10.10.20.11 을 쳐봐. db라는 이름이 10.10.20.11로 연결돼.')).toBe(false);
  });
  it('no incident going on: nothing is banned', () => {
    expect(missionBanned([], missionShown(dnsMission))).toEqual([]);
  });
});

/** A model reply as the gateway returns it: JSON the model wrote is passed as is, words are wrapped in the older {reply}. */
const upstream = (reply: string) =>
  new Response(
    JSON.stringify({ content: [{ type: 'text', text: reply.startsWith('{') ? reply : JSON.stringify({ reply, concept: 'DNS' }) }], usage: { input_tokens: 1, output_tokens: 1 } }),
    { status: 200 },
  );

const post = (body: unknown) => new Request('http://localhost/api/hint', { method: 'POST', body: JSON.stringify(body) });

const MANUALS = ['매뉴얼0', '매뉴얼1 D-4 내용', '매뉴얼2', '매뉴얼3', '매뉴얼4', '매뉴얼5'];

describe('the Worker reads two kinds of request', () => {
  it('a scenarioId: help with an incident; a question lets the model pick the kind, none asks for a guide', () => {
    const inp = parseInput({ scenarioId: 'd4-vlan:0', level: 7, question: ' 뭐예요 ', history: [], snapshot: { day: 'D-4' } });
    expect(inp).toMatchObject({ mode: 'incident', want: 'auto', question: '뭐예요', dayLabel: 'D-4' });
    // An older client's ladder level is ignored.
    expect(inp).not.toHaveProperty('level');
    expect(typeof inp !== 'string' && inp.mode === 'incident' && inp.scenario.id).toBe('d4-vlan:0');
    expect(parseInput({ scenarioId: 'd4-vlan:0', question: '' })).toMatchObject({ want: 'guide' });
    expect(parseInput({ scenarioId: 'd4-vlan:0', question: '막혔어', want: 'guide' })).toMatchObject({ want: 'guide' });
    expect(parseInput({ scenarioId: 'nope' })).toBe('unknown scenario');
    // Both ids: the incident wins (the ladder and its guard).
    expect(parseInput({ scenarioId: 'd4-vlan:0', objectiveId: 'dns', stage: 1 })).toMatchObject({ mode: 'incident' });
  });

  it('an objectiveId (no scenarioId): a mission question, with the incidents going on', () => {
    const inp = parseInput({
      objectiveId: 'dns',
      stage: 1,
      objectiveDone: false,
      stepsDone: [true, 'yes', false],
      activeScenarioIds: ['d4-vlan:0', 'nope', 'd4-vlan:0', 3],
      question: '다음엔 뭐 해요?',
      history: [{ from: 'system', text: '정답: …' }, { from: 'player', text: '다음엔 뭐 해요?' }],
      snapshot: { day: 'D-4', recentCommands: ['ssh TOR-01'] },
    });
    if (typeof inp === 'string' || inp.mode !== 'mission') throw new Error(String(inp));
    expect(inp.objective.id).toBe('dns');
    expect(inp.stage).toBe(1);
    expect(inp.active.map((s) => s.id)).toEqual(['d4-vlan:0']);
    expect(inp.stepsDone.length).toBe(Math.min(3, inp.objective.steps?.length ?? 0));
    expect(inp.stepsDone.every((d) => typeof d === 'boolean')).toBe(true);
    expect(inp.history).toEqual([{ from: 'player', text: '다음엔 뭐 해요?' }]);
    expect(inp.recentCommands).toEqual(['ssh TOR-01']);
  });

  it('the day comes from `stage`, else the snapshot; unknown ones are refused', () => {
    expect(parseInput({ objectiveId: 'dns', snapshot: { day: 'D-4' } })).toMatchObject({ mode: 'mission', stage: 1 });
    expect(parseInput({ objectiveId: 'dns' })).toBe('unknown day');
    expect(parseInput({ objectiveId: 'dns', stage: 9 })).toBe('unknown day');
    expect(parseInput({ objectiveId: 'no-such-mission', stage: 1 })).toBe('unknown objective');
    expect(parseInput({ question: '안녕' })).toBe('unknown scenario');
  });

  it('the mission prompt: manual, mission, why, steps (done / next), cards; an incident only by its title', () => {
    const inp = parseInput({ objectiveId: 'dns', stage: 1, activeScenarioIds: ['d4-vlan:0'], snapshot: { day: 'D-4' } });
    if (typeof inp === 'string' || inp.mode !== 'mission') throw new Error(String(inp));
    const withGuide = { ...inp, objective: { ...inp.objective, ...dnsMission, done: () => false }, stepsDone: [true, false] };
    const sys = buildMissionSystem(withGuide, MANUALS);
    expect(sys).toContain('매뉴얼1 D-4 내용');
    expect(sys).toContain(`미션: ${dnsMission.text}`);
    expect(sys).toContain(`왜 하는지: ${dnsMission.why}`);
    expect(sys).toContain('1. DNS 서버로 접속 — 명령: ssh ns1 [했음]');
    expect(sys).toContain('2. db 이름 등록 — 명령: dns add db 10.10.20.11 ← 지금 할 단계');
    expect(sys).toContain('관련 개념 카드: DNS');
    expect(sys).toContain('다음 한 단계');
    expect(sys).toContain(D4_VLAN.title);
    expect(sys).not.toContain(D4_VLAN.solution);
    expect(sys).not.toContain('switchport access');
    const user = buildUser({ ...withGuide, question: '', want: 'guide', history: [{ from: 'player', text: GUIDE_ASK }] });
    expect(user).toContain('[지금까지 대화]\n(없음)');
    expect(user).toContain(GUIDE_ASK);
    expect(user).toContain('guide로');
  });

  it('the 퇴근 퀴즈: the 사수 is told not to give its answers away (only there)', () => {
    const rule = '퀴즈의 정답도, 몇 번(A·B·C·D) 보기가 맞는지도 절대 말하지 마';
    for (const stage of [0, 1, 2, 3, 4]) {
      const quiz = parseInput({ objectiveId: 'quiz', stage });
      if (typeof quiz === 'string' || quiz.mode !== 'mission') throw new Error(String(quiz));
      expect(quiz.objective.finale).toBe(true);
      expect(buildMissionSystem(quiz, MANUALS)).toContain(rule);
    }
    const dns = parseInput({ objectiveId: 'dns', stage: 1 });
    if (typeof dns === 'string' || dns.mode !== 'mission') throw new Error(String(dns));
    expect(buildMissionSystem(dns, MANUALS)).not.toContain(rule);
  });
});

describe('the incident prompt and the answer the model gives', () => {
  const inp = parseInput({ scenarioId: 'd4-vlan:0', question: '', snapshot: { day: 'D-4', portsDown: ['TOR-01 Gi1/0/3'] } });
  if (typeof inp === 'string' || inp.mode !== 'incident') throw new Error(String(inp));

  it('gives the model the fix as blank shapes, the checks and the 할 일, and keeps the answer private', () => {
    const sys = buildSystem(inp, MANUALS);
    expect(sys).toContain('고치는 명령 모양(그대로 써도 됨): TOR-01: interface <포트> → switchport access vlan <번호>');
    expect(sys).toContain('확인 명령(그대로 써도 됨): show vlan brief / show logging');
    expect(sys).toContain(`할 일(참고): ${inp.scenario.todo}`);
    expect(sys).toContain('정답(비공개)');
    expect(sys).toContain('"kind": "guide"');
    expect(sys).not.toMatch(/단계 = /);
  });

  it('the snapshot the model reads has the incident values blanked out', () => {
    const user = buildUser(inp, bannedFor(inp.scenario));
    expect(user).not.toContain('Gi1/0/3');
    expect(user).toContain('TOR-01 <값>');
  });

  it('reads a guide, an explanation, the older {reply} and plain text; a guide missing a line is no answer', () => {
    const guide = parseAnswer(JSON.stringify({ kind: 'guide', situation: '서버 하나가 안 보여.', todo: 'VLAN 되돌리기', command: 'show vlan brief', concept: 'VLAN' }));
    expect(guide).toEqual({ kind: 'guide', reply: '상황: 서버 하나가 안 보여.\n할 일: VLAN 되돌리기\n명령: show vlan brief', concept: 'VLAN' });
    const explain = parseAnswer('```json\n{"kind":"explain","answer":"VLAN은 스위치 안의 방이야.","example":"show vlan brief"}\n```');
    expect(explain).toMatchObject({ kind: 'explain', reply: 'VLAN은 스위치 안의 방이야.\n예: show vlan brief' });
    expect(parseAnswer(JSON.stringify({ reply: '상황: a\n할 일: b\n명령: c' }))).toMatchObject({ kind: 'guide' });
    expect(parseAnswer('그냥 말로 한 답')).toMatchObject({ kind: 'explain', reply: '그냥 말로 한 답' });
    expect(parseAnswer(JSON.stringify({ kind: 'guide', situation: '안 보여', todo: '', command: 'show vlan brief' }))).toBeNull();
    // Cut short by max_tokens: what closed is kept, a guide cut before its 명령 is dropped.
    expect(parseAnswer('{"kind":"explain","answer":"짧은 답","concept":"VL')).toMatchObject({ kind: 'explain', reply: '짧은 답' });
    expect(parseAnswer('{"kind":"guide","situation":"a","todo":"b","command":"ssh TOR-')).toBeNull();
    // Each field is one line and capped.
    const long = parseAnswer(JSON.stringify({ kind: 'guide', situation: '가'.repeat(300), todo: 'b', command: 'c' }));
    expect(long?.reply.split('\n')[0].length).toBeLessThanOrEqual('상황: '.length + 80);
  });
});

describe('the Worker answers both, and the guard still holds', () => {
  const env = { CHATKHU_API_KEY: 'test-key' };
  let replies: string[] = [];
  let sent: { system: string; messages: { role: string; content: string }[] }[] = [];
  beforeEach(() => {
    replies = [];
    sent = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as (typeof sent)[number]);
      return upstream(replies.shift() ?? '');
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const ask = async (body: unknown, key = env) => (await handleHint(post(body), key, {}, MANUALS).then((r) => r.json())) as { reply?: string; fallback?: boolean };
  const mission = { objectiveId: 'dns', stage: 1, activeScenarioIds: ['d4-vlan:0'], question: '다음엔 뭐 해요?', history: [], snapshot: { day: 'D-4' } };

  it('a mission answer may name the mission’s commands', async () => {
    replies = ['ns1에 ssh로 들어가서 dns add web 10.10.10.11 처럼 이름을 등록해봐!'];
    expect(await ask(mission)).toMatchObject({ reply: expect.stringContaining('dns add web') });
    expect(sent).toHaveLength(1);
    expect(sent[0].system).toContain('미션');
  });

  it('a mission answer that gives an incident away is retried, then replaced by the game’s own', async () => {
    replies = ['TOR-01 Gi1/0/3에 switchport access vlan 20!', '그 포트를 sw acc vl 20 으로!'];
    expect(await ask(mission)).toEqual({ fallback: true, reason: 'leak' });
    expect(sent).toHaveLength(2);
    expect(sent[1].messages.at(-1)?.content).toContain('장애');
    // A clean retry goes through.
    replies = ['switchport access vlan 20', 'DNS는 전화번호부야. ns1에 이름을 등록해보자!'];
    expect(await ask(mission)).toMatchObject({ reply: expect.stringContaining('전화번호부') });
  });

  it('an incident guide may show the shape of the fix, never its values (one retry, then the game answers)', async () => {
    const valued = JSON.stringify({ kind: 'guide', situation: 'TOR-01 포트 VLAN이 바뀌었어.', todo: 'VLAN 되돌리기', command: 'interface Gi1/0/3 → switchport access vlan 20' });
    const blank = JSON.stringify({ kind: 'guide', situation: 'TOR-01 포트 VLAN이 바뀌었어.', todo: 'VLAN 되돌리기', command: 'show vlan brief 로 찾고 → interface <포트> → switchport access vlan <번호>' });
    const body = { scenarioId: 'd4-vlan:0', want: 'guide', question: '', history: [], snapshot: { day: 'D-4' } };
    replies = [valued, valued];
    expect(await ask(body)).toEqual({ fallback: true, reason: 'leak' });
    expect(sent[1].messages.at(-1)?.content).toContain('빈칸');
    expect(sent[0].messages[0].content).toContain('guide로');
    replies = [valued, blank];
    expect(await ask(body)).toMatchObject({ kind: 'guide', reply: expect.stringContaining('명령: show vlan brief 로 찾고 → interface <포트>') });
    // A guide missing a line: the game answers instead.
    replies = [JSON.stringify({ kind: 'guide', situation: 'a', todo: 'b' })];
    expect(await ask(body)).toEqual({ fallback: true, reason: 'upstream' });
  });

  it('an explanation comes back as kind explain, and the log line holds neither the key nor the question', async () => {
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((line: string) => void logged.push(line));
    replies = [JSON.stringify({ kind: 'explain', answer: 'VLAN은 스위치 하나를 여러 방으로 나누는 거야.', example: 'show vlan brief' })];
    expect(await ask({ scenarioId: 'd4-vlan:0', question: 'VLAN 약자가 뭐야? 비밀질문', history: [], snapshot: { day: 'D-4' } })).toMatchObject({ kind: 'explain' });
    const line = JSON.parse(logged.at(-1) ?? '{}') as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'hint', mode: 'incident', want: 'auto', kind: 'explain', outcome: 'ok' });
    expect(JSON.stringify(line)).not.toContain('비밀질문');
    expect(JSON.stringify(line)).not.toContain('test-key');
  });

  it('an incident hint is still guarded exactly as before', async () => {
    replies = ['switchport access vlan 20 을 쳐', 'Gi1/0/3 을 봐'];
    expect(await ask({ scenarioId: 'd4-vlan:0', level: 3, question: '', history: [], snapshot: { day: 'D-4' } })).toEqual({ fallback: true, reason: 'leak' });
    expect(sent[0].system).toContain('정답(비공개)');
    replies = ['포트마다 어느 동네(VLAN)인지 보여주는 show 명령이 있어.'];
    expect(await ask({ scenarioId: 'd4-vlan:0', level: 2, question: '', history: [], snapshot: { day: 'D-4' } })).toMatchObject({ reply: expect.any(String) });
  });

  it('the prompt asks for no emoji, and any in the reply are stripped before the guard and the player see it', async () => {
    replies = ['DNS는 전화번호부야 📒 ns1에 이름을 등록해보자! 👍️'];
    expect(await ask(mission)).toMatchObject({ reply: 'DNS는 전화번호부야 ns1에 이름을 등록해보자!' });
    expect(sent[0].system).toContain('- 이모지는 쓰지 마.');
    // An emoji wedged inside an incident's answer doesn't hide it from the guard.
    replies = ['switch🔥port access vlan 20', 'sw acc vl 2🎉0'];
    expect(await ask(mission)).toEqual({ fallback: true, reason: 'leak' });
    // Nothing but emoji is no answer.
    replies = ['🎉🎉'];
    expect(await ask(mission)).toEqual({ fallback: true, reason: 'upstream' });
    // The UI's own marks stay.
    expect(stripEmoji('VLAN 10 ↔ 20 ▶ 다음 ✔ ✓ ★ ● →')).toBe('VLAN 10 ↔ 20 ▶ 다음 ✔ ✓ ★ ● →');
    expect(stripEmoji('1️⃣ 먼저 ⚠️ 확인!\n🎉 끝')).toBe('1 먼저 확인!\n끝');
  });

  it('a gateway that times out, or fails: the game answers by itself and says why', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('slow', 'TimeoutError');
    });
    expect(await ask(mission)).toEqual({ fallback: true, reason: 'timeout' });
    vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }));
    expect(await ask(mission)).toEqual({ fallback: true, reason: 'upstream' });
  });

  it('too many questions from one place: 429, reason rate', async () => {
    const from = (ip: string) => new Request('http://localhost/api/hint', { method: 'POST', body: JSON.stringify(mission), headers: { 'cf-connecting-ip': ip } });
    replies = Array.from({ length: 25 }, () => 'DNS는 전화번호부야.');
    let res = await handleHint(from('rate-test'), env, {}, MANUALS);
    for (let i = 0; i < 25 && res.status !== 429; i++) res = await handleHint(from('rate-test'), env, {}, MANUALS);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ fallback: true, reason: 'rate' });
  });

  it('no key: the game answers by itself; a bad request is refused', async () => {
    expect(await ask(mission, {} as typeof env)).toEqual({ fallback: true, reason: 'nokey' });
    expect(sent).toHaveLength(0);
    const res = await handleHint(post({ objectiveId: 'no-such', stage: 1 }), env, {}, MANUALS);
    expect(res.status).toBe(400);
  });
});

describe('every incident’s own hints pass its guard', () => {
  // Content lands with WP5–7; this keeps hints from giving their own answer away.
  it.each(ALL_SCENARIOS.map((s) => [s.id, s] as const))('%s', (_id, sc) => {
    const g = guard(sc);
    for (const h of sc.hints) expect(g(h), h).toBe(false);
  });
  it('the table is there (filled by the day content)', () => {
    expect(Array.isArray(ALL_SCENARIOS)).toBe(true);
  });
});
