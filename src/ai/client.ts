// Asks the Worker (/api/hint → ChatKHU) for a mentor answer, free. Two modes:
//  - incident: what to do about one incident (상황 / 할 일 / 명령, the fix's values blank) or what a word means;
//    falls back to the scenario's own three lines (incidentGuide) or the word's card;
//  - mission: the mission being built (or a term on screen); falls back to the mission's next step in the same
//    three lines, or the word's card (cannedMission).
// Either falls back when the Worker isn't running, has no key, fails, or caught a leak. Emoji in a reply are dropped.
import { CONCEPTS, type Concept } from '../content/concepts';
import { getStage } from '../content/stages';
import type { Objective } from '../content/types';
import { openAlarms, SEV_LABEL } from '../sim/alarms';
import { activeScenarios, clockText, scenarioOf, visibleObjectives, type StageRun } from '../sim/engine';
import { operState } from '../sim/net/topo';
import { compareIf } from '../sim/net/ifname';
import { cableAt } from '../sim/net/basics';
import type { Scenario } from '../sim/scenario';
import { dayLabel, type World } from '../sim/types';
import { guideOf, missionInFocus } from '../ui/objectiveStatus';
import { formatGuide, incidentGuide } from './answer';
import { stripEmoji } from './emoji';
import { leaks, missionBanned, missionShown } from './leak';

/** 'guide': answer with the three lines (a button, the terminal's `hint`); 'auto': the question decides. */
export type Want = 'guide' | 'auto';

const wantOf = (want: Want | undefined, question: string | undefined): Want => want ?? (question?.trim() ? 'auto' : 'guide');

/**
 * What the 사수 sees of the game right now. Only what the player could see on screen: the NOC's alarms
 * (severity, device, text — never which incident they belong to), port and gateway state, link load.
 */
export interface HintSnapshot {
  /** 'D-4' */
  day: string;
  /** '14:32' (D-Day: '10:03:17') */
  clock: string;
  dayTitle: string;
  objectives: string[];
  incidents: { title: string; alert: string; secondsActive: number }[];
  /** Open NOC alarms, worst first */
  alarms: { sev: string; device: string; text: string; acked: boolean }[];
  /** Ports on network gear that are cabled (or err-disabled) and not up: 'TOR-01 Gi1/0/5 err-disabled' */
  portsDown: string[];
  /** VLAN → core that answers the gateway address (HSRP active), or null when none does */
  hsrpActive: Record<string, string | null>;
  /** Busiest links: 'CORE-01:Te1/0/3~TOR-01:Te1/1/1' → percent of capacity */
  busiestLinks: { link: string; util: number }[];
  availability: number;
  notes: string[];
  recentCommands: string[];
  host: string;
  /** IOS mode the terminal is in on network gear ('exec', 'config-if' …) */
  iosMode?: string;
}

const MAX_PORTS = 12;
const MAX_LINKS = 5;

function portsDown(w: World): string[] {
  const out: string[] = [];
  for (const d of Object.values(w.devices)) {
    if (d.nd?.os !== 'ios') continue;
    for (const ifn of Object.keys(d.nd.ifs).sort(compareIf)) {
      const f = d.nd.ifs[ifn];
      // An empty port being down is normal; a cabled one (or one the switch shut itself) is news.
      if (!f.errDisabled && !cableAt(w, `${d.id}:${ifn}`)) continue;
      const st = operState(w, d.id, ifn);
      if (st !== 'up') out.push(`${d.label} ${ifn} ${st}`);
    }
  }
  return out.slice(0, MAX_PORTS);
}

function busiestLinks(w: World): HintSnapshot['busiestLinks'] {
  return Object.entries(w.net?.load ?? {})
    .filter(([, l]) => l.cap > 0 && l.mbps > 0)
    .map(([link, l]) => ({ link, util: Math.round((l.mbps / l.cap) * 100) }))
    .sort((a, b) => b.util - a.util)
    .slice(0, MAX_LINKS);
}

export function buildSnapshot(run: StageRun, host: string, iosMode?: string | null): HintSnapshot {
  const def = getStage(run.stage);
  const w = run.world;
  const label = (id: string) => w.devices[id]?.label ?? id;
  return {
    day: dayLabel(run.stage),
    clock: clockText(run),
    dayTitle: def.title,
    objectives: visibleObjectives(def, run).filter((o) => !(o.id in run.objectivesDone)).map((o) => o.text),
    incidents: activeScenarios(run).map(({ rt, def: sc }) => ({
      title: sc.title,
      alert: sc.alert,
      secondsActive: Math.max(0, run.ctx.stageTime - (rt.activatedAt ?? run.ctx.stageTime)),
    })),
    alarms: openAlarms(run.alarms).map((a) => ({ sev: SEV_LABEL[a.sev], device: label(a.device), text: a.text, acked: a.ackAt !== null })),
    portsDown: portsDown(w),
    hsrpActive: Object.fromEntries(Object.entries(w.net?.hsrpActive ?? {}).map(([vlan, dev]) => [vlan, dev ? label(dev) : null])),
    busiestLinks: busiestLinks(w),
    availability: Math.round(run.health.availability * 100),
    notes: run.health.notes,
    // Asking 쿠사수 is not something tried on the system.
    recentCommands: run.ctx.commands.filter((c) => !/^hint$/i.test(c)).slice(-6),
    host,
    ...(iosMode ? { iosMode } : {}),
  };
}

/** What the terminal's `hint` asks about. */
export type HintTarget = { kind: 'incident'; id: string } | { kind: 'mission' };

/**
 * An incident going on (not one handed to another team): the one whose fix is typed on `host`, else the one
 * that started first. With none, the mission in focus while it is open; else nothing to ask about (null).
 */
export function hintTarget(run: StageRun, host: string): HintTarget | null {
  const live = activeScenarios(run)
    .filter((a) => a.rt.escalatedAt === null)
    .sort((a, b) => (a.rt.activatedAt ?? 0) - (b.rt.activatedAt ?? 0));
  const pick = live.find((a) => a.def.solutionSteps.some((s) => 'host' in s && s.host === host)) ?? live[0];
  if (pick) return { kind: 'incident', id: pick.rt.id };
  const o = missionInFocus(getStage(run.stage), run);
  return o && !(o.id in run.objectivesDone) ? { kind: 'mission' } : null;
}

export interface HintRequest {
  run: StageRun;
  scenario: Scenario;
  question?: string;
  want?: Want;
  history: { from: string; text: string }[];
  host: string;
  /** IOS mode level when the terminal is on network gear */
  iosMode?: string | null;
}

export async function requestHintText(req: HintRequest): Promise<{ text: string; source: 'ai' | 'canned' }> {
  const canned = cannedIncident(req.run, req.scenario, req.question, req.host);
  try {
    const res = await fetch('/api/hint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: req.scenario.id,
        want: wantOf(req.want, req.question),
        question: req.question ?? '',
        history: req.history.slice(-8),
        snapshot: buildSnapshot(req.run, req.host, req.iosMode),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`hint ${res.status}`);
    const data = (await res.json()) as { reply?: string; fallback?: boolean };
    const reply = stripEmoji(data.reply ?? '');
    if (!reply || data.fallback) throw new Error('fallback');
    return { text: reply, source: 'ai' };
  } catch {
    return { text: canned, source: 'canned' };
  }
}

// ---------- mission mode ----------

const TERM_SEP = /\s*(?:·|,|→|\/|\bvs\b)\s*/;

/**
 * Words of a concept's name a player would type: 'L2 스위치 vs L3 스위치' → 'l2 스위치', 'l3 스위치', 'l2', 'l3';
 * 'OOB(대역 외) 관리망' → 'oob 관리망', 'oob'. A short note in brackets ('포트 (L4)') is not a name of its own.
 */
function nameTerms(c: Concept): string[] {
  const inner = [...c.name.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]).filter((t) => t.trim().length >= 3);
  const outer = c.name.replace(/\([^()]*\)/g, ' ');
  const terms = [...outer.split(TERM_SEP), ...inner.flatMap((t) => t.split(TERM_SEP))].map((t) => t.trim().replace(/\s+/g, ' ').toLowerCase());
  // A Latin word leading a longer name is asked about on its own: 'L4 로드밸런서' → 'l4', 'CRC 오류' → 'crc'.
  for (const t of [...terms]) {
    const lead = /^([a-z][a-z0-9-]+) /.exec(t);
    if (lead) terms.push(lead[1]);
  }
  if (c.id.length >= 3 && c.name.toLowerCase().includes(c.id)) terms.push(c.id);
  // Hangul words count from one syllable (랙); Latin ones from two letters; never a bare number.
  return terms.filter((t) => !/^[\d\s]*$/.test(t) && (/[가-힣]/.test(t) || t.length >= 2));
}

/** The concept card a question is about ('VLAN이 뭐예요?' → VLAN), by the longest name that matches. */
export function conceptIn(question: string): Concept | undefined {
  const q = question.toLowerCase();
  let best: { c: Concept; len: number } | undefined;
  for (const c of Object.values(CONCEPTS)) {
    for (const t of nameTerms(c)) if (q.includes(t) && (!best || t.length > best.len)) best = { c, len: t.length };
  }
  return best?.c;
}

const cardLine = (c: Concept) => `${c.name}: ${c.analogy}. ${c.definition}`;

/**
 * Plain one-liners for words players ask about that have no card of their own (DB, 서버, trunk …), or whose
 * card belongs to an incident that hasn't been solved yet (STP, 업링크, 방화벽): what the word means, never
 * what is wrong today.
 */
const GLOSSARY: { terms: string[]; text: string }[] = [
  { terms: ['db', 'db 서버', 'db서버', '데이터베이스'], text: 'DB(데이터베이스) 서버는 누가 어떤 과목을 신청했는지 같은 기록을 저장해 두는 창고 서버야. 신청 앱이 기록을 여기에 적고 읽어 가.' },
  { terms: ['웹 서버', '웹서버', 'web 서버'], text: '웹 서버는 학생 브라우저에 수강신청 화면을 만들어 보내 주는 서버야. WEB-01·WEB-02가 그 일을 해.' },
  { terms: ['서버'], text: '서버는 24시간 켜져서 다른 컴퓨터(학생 노트북)의 요청에 답하는 컴퓨터야. 데이터센터 랙에 층층이 끼워 둬.' },
  { terms: ['스위치'], text: '스위치는 여러 장비를 케이블로 이어 서로 데이터를 주고받게 해 주는 네트워크 장비야. 랙 맨 위 랙 스위치(TOR)가 그 랙 서버들을 잇고, 코어 스위치가 랙 스위치들을 다시 이어.' },
  { terms: ['stp', '스패닝'], text: 'STP는 스위치 사이 길이 빙 도는 고리(루프)가 되지 않게, 길 하나를 일부러 쉬게(차단) 두는 규칙이야. NMS 지도의 점선 "예비 길"이 그렇게 쉬는 길이야.' },
  { terms: ['trunk', '트렁크'], text: 'trunk는 스위치끼리 잇는 포트야. VLAN 여러 개를 한 줄로 함께 실어 나르고, 포트마다 실어 나를 VLAN 목록이 정해져 있어.' },
  { terms: ['업링크', 'uplink'], text: '업링크는 랙 스위치에서 코어 스위치로 올라가는 굵은 길이야. 그 랙 서버들의 요청이 전부 여기로 모여서 지나가.' },
  { terms: ['방화벽', 'firewall'], text: '방화벽은 바깥(인터넷)에서 들어오는 요청을 출발지 주소별로 보고 통과시키거나 막는 입구 경비 장비야.' },
  { terms: ['snmp', '폴링'], text: 'SNMP 폴링은 관제 시스템이 정해진 간격마다 장비에게 상태를 물어보는 순찰이야. 그래서 어떤 경보는 다음 순찰 때 떠.' },
  { terms: ['rps'], text: 'rps는 1초에 들어오는 요청 수(requests per second)야. 화면 위 "접속"이 지금 학생 요청 수야.' },
  { terms: ['가용성'], text: '가용성은 학생 요청 중 성공한 비율이야. 99%를 넘으면 정상이고, 하루 성적도 이걸로 매겨.' },
  { terms: ['ack'], text: 'ACK(확인)는 경보를 "내가 보고 있다"고 표시하는 버튼이야. 장애가 시작돼서 ACK를 누를 때까지가 탐지 시간(MTTD)이야.' },
  { terms: ['ssh'], text: 'ssh는 관리 PC에서 다른 장비에 원격으로 접속하는 명령이야. ssh <장비 이름> 으로 들어가고, exit 로 나와.' },
];

/** Does the (lower-cased) question name `term`? A Latin term only as a whole word ('db' in 'DB가', not in 'dbdata'). */
function names(q: string, term: string): boolean {
  if (!/^[a-z]/.test(term)) return q.includes(term);
  return new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(q);
}

/** The glossary line a question asks about (the longest term that matches), or undefined. */
export function glossaryIn(question: string): string | undefined {
  const q = question.toLowerCase();
  let best: { text: string; len: number } | undefined;
  for (const e of GLOSSARY) for (const t of e.terms) if (names(q, t) && (!best || t.length > best.len)) best = { text: e.text, len: t.length };
  return best?.text;
}

/** Cards of today's incidents not solved yet: reading one would give its cause away (the 도감 hides them too). */
function openIncidentCards(run: StageRun): Set<string> {
  const def = getStage(run.stage);
  return new Set(run.scenarios.filter((r) => r.state !== 'resolved').map((r) => scenarioOf(def, r.id).concept));
}

/**
 * What a question names that the radio can explain here and now: a card that gives no incident away, else the
 * glossary's one-liner. Undefined when it names nothing the radio knows.
 */
export function termAnswer(run: StageRun, question: string): string | undefined {
  const card = conceptIn(question);
  if (card && !openIncidentCards(run).has(card.id)) return cardLine(card);
  return glossaryIn(question);
}

/**
 * The radio's own answer during an incident (no AI): what a word means when the question names one (a card or the
 * glossary, never the incident's own card or anything banned for it), else the incident's three lines with the
 * fix's values blank. `host`: where the player's terminal is (the 명령 line starts there).
 */
export function cannedIncident(run: StageRun, scenario: Scenario, question = '', host?: string): string {
  const term = question.trim() ? termAnswer(run, question) : undefined;
  if (term && !leaks(term, missionBanned(activeScenarios(run).map((a) => a.def), []))) return term;
  return incidentGuide(scenario, host);
}

export const NO_MISSION = '지금은 열린 미션이 없어. 관제 화면(N)을 보면서 다음 상황을 기다리자. 화면에 모르는 말이 있으면 그 말을 넣어서 물어봐!';
const TANGLED = '그건 지금 난 장애랑 얽혀 있어서 여기선 말 못 해. 터미널에서 hint를 쳐 봐!';

/**
 * The radio's own answer about a mission (no AI). A question naming a word: what it means. Otherwise the
 * mission's next step in three lines (상황 / 할 일 / 명령), the step's command in full (the mission shows it).
 * Never anything that would give an incident going on away.
 */
export function cannedMission(run: StageRun, o: Objective | undefined, question = ''): string {
  const banned = missionBanned(
    activeScenarios(run).map((a) => a.def),
    o ? missionShown(o) : [],
  );
  const safe = (text: string) => (leaks(text, banned) ? TANGLED : text);
  const asked = question.trim() ? termAnswer(run, question) : undefined;
  if (asked) return safe(asked);
  if (!o || o.id in run.objectivesDone) return NO_MISSION;
  const next = guideOf(o, run)?.next;
  return safe(
    formatGuide({
      situation: `지금 미션은 "${o.text}"야.`,
      todo: next ? `${next.text}${next.why ? ` (${next.why})` : ''}` : o.text,
      command: next?.cmd ?? (next ? '명령 없이 화면에서 해' : '미션 목록에서 남은 걸 확인해'),
    }),
  );
}

export interface MissionRequest {
  run: StageRun;
  /** The mission asked about (default: the one to do now, or the last one on the list when none is open) */
  objective?: Objective;
  question?: string;
  want?: Want;
  history: { from: string; text: string }[];
  host: string;
  iosMode?: string | null;
}

export async function requestMissionText(req: MissionRequest): Promise<{ text: string; source: 'ai' | 'canned' }> {
  const { run } = req;
  const o = req.objective ?? missionInFocus(getStage(run.stage), run);
  const canned = cannedMission(run, o, req.question);
  // Nothing on the list yet (the day's first mission is still locked): the radio's own answer is all there is.
  if (!o) return { text: canned, source: 'canned' };
  try {
    const res = await fetch('/api/hint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objectiveId: o.id,
        stage: run.stage,
        objectiveDone: o.id in run.objectivesDone,
        stepsDone: guideOf(o, run)?.rows.map((r) => r.done) ?? [],
        activeScenarioIds: activeScenarios(run).map((a) => a.rt.id),
        want: wantOf(req.want, req.question),
        question: req.question ?? '',
        history: req.history.slice(-8),
        snapshot: buildSnapshot(run, req.host, req.iosMode),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`hint ${res.status}`);
    const data = (await res.json()) as { reply?: string; fallback?: boolean };
    const reply = stripEmoji(data.reply ?? '');
    if (!reply || data.fallback) throw new Error('fallback');
    return { text: reply, source: 'ai' };
  } catch {
    return { text: canned, source: 'canned' };
  }
}
