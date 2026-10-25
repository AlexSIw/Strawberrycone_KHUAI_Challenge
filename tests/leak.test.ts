// The AI 사수's answer-leak guard (src/ai/leak.ts, used by the hint Worker): answers in any spelling are
// caught, hints that only point the way pass.
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/ai/client';
import { bannedFor, ifValueRe, iosScript, leaks, phraseRe } from '../src/ai/leak';
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
      'config-vlan:name staff',
      'config-vlan:exit',
      'config:interface Gi1/0/5',
      'config-if:exit',
      'config:exit',
      'exec:write',
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
    expect(svi('마지막에 no shut 하면 돼')).toBe(true);
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
  it('but not a different port, address or VLAN that only looks alike', () => {
    expect(vlan('Gi1/0/15 는 정상이야')).toBe(false);
    expect(vlan('11/0/5 같은 건 없어')).toBe(false);
    expect(vlan('VLAN 200은 상관없어')).toBe(false);
    expect(svi('10.10.30.10 은 다른 서버야')).toBe(false);
  });
  // Needs WP2's real iosVariantsRegex (today a stub that only matches the exact canonical line).
  it.todo('abbreviated forms of a banned line: "sw acc vl 20", "switchport acc vlan 20", "ip add 10.10.30.2 255.255.255.0"');
  it.todo('bannedIos lines are caught in every abbreviated form ("no sh" for "no shutdown")');
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
