// The /api/hint handler, apart from the Worker entry (index.ts) so the tests can run it: index.ts bundles
// the day manuals (*.md text modules, which only wrangler understands) and hands them in.
//
// Two kinds of request:
//  - incident {scenarioId, want, question, history, snapshot}: help with one incident. The fix's commands
//    may be shown as shapes with the values blank ('interface <포트>'), never with the values
//    (bannedFor + one retry, then fallback).
//  - mission {objectiveId, stage, objectiveDone, stepsDone, activeScenarioIds, want, question, history, snapshot}
//    (no scenarioId): the mission being built or a term on screen. The 사수 gives the NEXT step, commands
//    included (the mission shows them anyway), never an incident going on (missionBanned + one retry, then fallback).
// The model answers one of two kinds, short: a guide (상황 / 할 일 / 명령, three lines) when the player doesn't
// know what to do, or an explanation (1–2 sentences) for "what is X / how do I". `want: 'guide'` (the terminal's
// `hint`, the radio's buttons) asks for a guide; 'auto' lets the question decide.
// Either answers {reply, kind, concept}, or {fallback: true} (no key / upstream error / leak) and the game shows
// its own answer.

import { fixShapes } from '../../src/ai/blanks';
import { formatGuide, GUIDE_ASK, parseGuide } from '../../src/ai/answer';
import { stripEmoji } from '../../src/ai/emoji';
import { bannedFor, leaks, maskValues, missionBanned, missionShown } from '../../src/ai/leak';
import { CONCEPTS } from '../../src/content/concepts';
import { ALL_SCENARIOS, getStage } from '../../src/content/stages';
import type { Objective } from '../../src/content/types';
import { SEV_LABEL } from '../../src/sim/alarms';
import type { Scenario } from '../../src/sim/scenario';
import { DAY_LABEL, LAST_DAY, type DayId } from '../../src/sim/types';

export interface Env {
  CHATKHU_API_KEY?: string;
  HINT_MODEL?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const UPSTREAM = 'https://factchat-cloud.mindlogic.ai/v1/gateway/claude/v1/messages/';
export const DEFAULT_MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 300;
const TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 32_000;
const MAX_QUESTION = 300;
const MAX_HISTORY = 8;
const MAX_HISTORY_TEXT = 400;
const MAX_SNAPSHOT = 3_000;
const MAX_REPLY = 320;
/** Each field of a guide or an explanation, so one long field can't crowd out the others. */
const MAX_FIELD = { situation: 80, todo: 60, command: 160, answer: 200, example: 100 } as const;
const MAX_ACTIVE = 8;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const SCENARIOS = new Map<string, Scenario>(ALL_SCENARIOS.map((s) => [s.id, s]));
const LEAK_RETRY = '방금 답에 정답 값(포트 이름, VLAN 번호, IP, 개수, 이름 같은 것)이 들어갔어. 값은 <포트>·<번호>·<IP>·<이름> 같은 빈칸으로 바꿔서 같은 JSON으로 다시.';
const MISSION_LEAK_RETRY = '방금 답에 지금 난 장애의 답이 들어갔어. 장애 이야기는 빼고 미션만 이야기해. 같은 JSON 형식으로 다시.';

// ---------- HTTP helpers ----------

export type Headers0 = Record<string, string>;

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** CORS is only needed in dev (Vite on :5173 talking to wrangler on :8787 without the proxy). */
export function corsHeaders(request: Request): Headers0 {
  const origin = request.headers.get('origin');
  if (!origin || !LOCAL_ORIGIN.test(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export function json(body: unknown, status: number, extra: Headers0 = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

// ---------- rate limit (per isolate, best effort) ----------

const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return false;
}

// ---------- input ----------

interface HistoryItem {
  from: 'mentor' | 'player';
  text: string;
}

/** 'guide': answer with the three lines; 'auto': the question decides (guide or a short explanation). */
export type Want = 'guide' | 'auto';

/** What both kinds of request carry. */
interface CommonInput {
  /** 'D-4': the day being played */
  dayLabel: string;
  want: Want;
  question: string;
  history: HistoryItem[];
  snapshot: Record<string, unknown>;
  recentCommands: string[];
}

export interface IncidentInput extends CommonInput {
  mode: 'incident';
  scenario: Scenario;
}

export interface MissionInput extends CommonInput {
  mode: 'mission';
  stage: DayId;
  objective: Objective;
  /** The mission is already done (none was open: the player asks about the last one on the list) */
  objectiveDone: boolean;
  /** Which of its first-time steps the player has done, in order (the client checks them on the real world) */
  stepsDone: boolean[];
  /** Incidents going on: the answer must not give any of them away */
  active: Scenario[];
}

export type HintInput = IncidentInput | MissionInput;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isDay = (n: unknown): n is DayId => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= LAST_DAY;

function commonInput(raw: Record<string, unknown>, fallbackDay: DayId): CommonInput {
  const question = typeof raw.question === 'string' ? raw.question.trim().slice(0, MAX_QUESTION) : '';

  const history: HistoryItem[] = (Array.isArray(raw.history) ? raw.history : [])
    .filter(isRecord)
    .filter((m) => typeof m.text === 'string' && m.text.trim() !== '')
    // System lines in the hint thread are "정답: …" reveals. The model already has the answer in the
    // private block; echoing it in the user turn only invites a leak (→ wasted retry + fallback).
    .filter((m) => m.from !== 'system')
    .slice(-MAX_HISTORY)
    .map((m) => ({
      from: m.from === 'mentor' ? 'mentor' : 'player',
      text: String(m.text).trim().slice(0, MAX_HISTORY_TEXT),
    }));

  const snapshot = isRecord(raw.snapshot) ? raw.snapshot : {};
  const recentCommands = Array.isArray(snapshot.recentCommands)
    ? snapshot.recentCommands.filter((c): c is string => typeof c === 'string').slice(-6).map((c) => c.slice(0, 80))
    : [];
  const day = typeof snapshot.day === 'string' ? snapshot.day : '';
  const dayLabel = (DAY_LABEL as readonly string[]).includes(day) ? day : DAY_LABEL[fallbackDay];
  // No question is a button or the terminal's `hint`: what to do next.
  const want: Want = raw.want === 'guide' || raw.want === 'auto' ? raw.want : question ? 'auto' : 'guide';
  return { dayLabel, want, question, history, snapshot, recentCommands };
}

/** A request, checked: a scenarioId makes it an incident hint; otherwise an objectiveId makes it a mission question. */
export function parseInput(raw: unknown): HintInput | string {
  if (!isRecord(raw)) return 'body must be a JSON object';

  if (raw.scenarioId !== undefined) {
    const scenario = typeof raw.scenarioId === 'string' ? SCENARIOS.get(raw.scenarioId) : undefined;
    if (!scenario) return 'unknown scenario';
    // An older client's `level` is ignored: there is no hint ladder any more.
    return { mode: 'incident', scenario, ...commonInput(raw, scenario.stage) };
  }

  if (typeof raw.objectiveId !== 'string') return 'unknown scenario';
  // The day: the request's own `stage`, else the snapshot's day label.
  const snapDay = isRecord(raw.snapshot) && typeof raw.snapshot.day === 'string' ? (DAY_LABEL as readonly string[]).indexOf(raw.snapshot.day) : -1;
  const stage = isDay(raw.stage) ? raw.stage : isDay(snapDay) ? snapDay : null;
  if (stage === null) return 'unknown day';
  const objective = getStage(stage).objectives.find((o) => o.id === raw.objectiveId);
  if (!objective) return 'unknown objective';
  const nSteps = objective.steps?.length ?? 0;
  const stepsDone = (Array.isArray(raw.stepsDone) ? raw.stepsDone : []).slice(0, nSteps).map((d) => d === true);
  const active = [
    ...new Set((Array.isArray(raw.activeScenarioIds) ? raw.activeScenarioIds : []).filter((id): id is string => typeof id === 'string')),
  ]
    .slice(0, MAX_ACTIVE)
    .flatMap((id) => SCENARIOS.get(id) ?? []);
  return {
    mode: 'mission',
    stage,
    objective,
    objectiveDone: raw.objectiveDone === true,
    stepsDone,
    active,
    ...commonInput(raw, stage),
  };
}

// ---------- prompt ----------

const PERSONA = [
  '너는 경희대학교 데이터센터의 선배 엔지니어 "쿠사수"야. 신입 엔지니어(경희대 사자)가 수강신청 날(D-Day)을 앞두고 데이터센터와 캠퍼스 네트워크 장애를 스스로 해결하도록 돕는 멘토야.',
  '플레이어는 서버와 네트워크를 거의 모르는 초보야.',
];

/** Rules both modes share. */
const COMMON_RULES = [
  '- 이모지는 쓰지 마.',
  '- 게임은 날짜(D-5, D-4 … D-Day)로 진행돼. 진행 단계를 말할 땐 "스테이지"가 아니라 날짜(D-n)로 말해.',
  '- 플레이어는 수업 듣는 학생이 아니라 서버 일에 관심 있는 누구나야. 수업·강의·교수님·시험·과제·공부·복습·대회 이야기는 절대 꺼내지 마. "배운 것" 대신 "해본 것"·"겪은 것"이라고 말해. 플레이어가 먼저 그런 걸 물으면 한 문장으로 받고 게임 이야기로 돌아와.',
  '- 영어 약어나 전문용어(rps, pod, VLAN, NMS 같은 것)는 처음 쓸 때 바로 옆에 괄호로 쉬운 말을 짧게 붙여줘. 예: "rps(1초 요청 수)". 진짜 용어는 지우지 마.',
  '- 짧게, 바로 본론만. 인사·칭찬·맞장구·되묻기 없이.',
];

/** The two kinds of answer, and when to give which. `subject` says what the guide is about. */
const KIND_RULES = (subject: string) => [
  '- 답은 두 가지 중 하나야.',
  `  guide: 플레이어가 뭘 해야 할지 모를 때(힌트 요청, "뭐 해야 돼?", "막혔어", "모르겠어" 같은 말). ${subject} 세 칸을 각각 한 문장(40자 안쪽)으로 채워.`,
  '  explain: 뜻·약자·개념·"이건 어떻게 해?"를 물을 때. answer 에 1~2문장으로 바로 답하고, 도움이 되면 example 에 명령 예시 하나(없으면 빈 문자열).',
  '- 요청에 "guide로"라고 적혀 있으면 반드시 guide로 답해.',
];

const JSON_RULE =
  '- 출력은 JSON 객체 하나만. guide면 {"kind": "guide", "situation": "…", "todo": "…", "command": "…", "concept": "관련 개념 이름(짧게)"}, explain이면 {"kind": "explain", "answer": "…", "example": "…", "concept": "…"}. 코드 블록이나 다른 글은 붙이지 마.';

/** A guide's three fields for an incident, in the voice and length wanted. */
const INCIDENT_EXAMPLE =
  '{"kind": "guide", "situation": "서버 한 대가 갑자기 안 보여. TOR-01 포트 VLAN이 바뀐 것 같아.", "todo": "바뀐 포트를 찾아 원래 VLAN으로 돌려놓기", "command": "ssh TOR-01 → show vlan brief 로 찾고 → enable → conf t → interface <포트> → switchport access vlan <번호> → end → wr", "concept": "VLAN"}';

export function buildSystem(inp: IncidentInput, manuals: readonly string[]): string {
  const sc = inp.scenario;
  const concept = CONCEPTS[sc.concept];
  const manual = manuals[sc.stage] ?? '';
  const shapes = fixShapes(sc).map((f) => `${f.hosts.join('·')}: ${f.lines.join(' → ')}`);
  return [
    ...PERSONA,
    '',
    '[규칙]',
    '- 한국어 반말로.',
    ...COMMON_RULES,
    ...KIND_RULES('situation = 지금 무슨 일이 났는지(증상과 의심되는 곳), todo = 해야 할 일, command = 그걸 하는 명령(필요하면 → 로 이어서).'),
    '- 명령은 이렇게: 상태를 보는 명령(show …, lb pool, dns list 같은 것)과 모드 이동·저장(enable, conf t, end, wr)은 그대로 써. 고치는 명령은 모양 그대로 쓰되, 값은 빈칸(<포트>, <번호>, <IP>, <대역>, <개수>, <값>, <이름>)으로 남겨. 플레이어는 빈칸을 직접 찾아 채워.',
    '- 값은 어디에도 쓰지 마(situation 칸도): 포트·인터페이스 이름(Gi1/0/5 같은 것), VLAN 번호, IP·대역, 포트 번호, 개수·설정 값, 앱·서비스·풀·레코드 이름, 문제가 난 서버 이름. 값을 다 채운 고치는 명령은 "정답 보기"에만 있어.',
    '- 장비 이름(TOR-01, CORE-01, L4-01, ns1 같은 것)은 말해도 돼.',
    '- 플레이어가 이미 친 명령(recentCommands)으로 본 것은 다시 시키지 말고 그다음을 알려줘.',
    '- NMS 경보는 증상이야. 원인을 경보 문구에서 단정하지 마.',
    '- 아래 [운영 매뉴얼]과 [이번 장애]에 있는 명령만 써. 없는 명령어는 지어내지 마.',
    '- 게임과 상관없는 질문이면 explain으로 한 문장 받고 끝.',
    JSON_RULE,
    `- guide 예시 (말투와 길이만 참고): ${INCIDENT_EXAMPLE}`,
    '',
    `[운영 매뉴얼 — 날짜(D-n): ${DAY_LABEL[sc.stage]}]`,
    manual.trim(),
    '',
    '[이번 장애 — 비공개 정보, 값은 절대 그대로 말하지 말 것]',
    `오늘 날짜: ${inp.dayLabel}`,
    `제목: ${sc.title}`,
    `증상(사용자·팀장이 알린 것): ${sc.alert}`,
    `NMS 경보: [${SEV_LABEL[sc.severity] ?? sc.severity}] ${sc.alarm.device} — ${sc.alarm.text}`,
    `정답(비공개): ${sc.solution}`,
    `할 일(참고): ${sc.todo}`,
    `확인 명령(그대로 써도 됨): ${sc.checks.length ? sc.checks.join(' / ') : '(없음)'}`,
    shapes.length ? `고치는 명령 모양(그대로 써도 됨): ${shapes.join(' / ')}` : `고치는 방법(명령 없음): ${sc.fixHow ?? ''}`,
    `빈칸으로 남길 값(절대 쓰지 말 것): ${sc.bannedPhrases.join(' / ')}`,
    concept ? `관련 개념: ${concept.name} — 비유: ${concept.analogy} — ${concept.definition}` : '',
  ].join('\n');
}

/**
 * Mission mode: the 사수 gets the day manual, the mission (text, why, steps with what is done, concept cards).
 * Commands may be named in full (the mission shows them); one step at a time. Incidents going on are only named
 * by title, never with their cause or fix (the model never sees those, and the reply goes through missionBanned).
 */
export function buildMissionSystem(inp: MissionInput, manuals: readonly string[]): string {
  const o = inp.objective;
  const steps = o.steps ?? [];
  const next = steps.findIndex((_, i) => !inp.stepsDone[i]);
  const cards = [o.concept, ...(o.alsoConcepts ?? [])].flatMap((id) => (id && CONCEPTS[id] ? [CONCEPTS[id]] : []));
  const when = (cond: unknown, line: string) => (cond ? [line] : []);
  return [
    ...PERSONA,
    '',
    '[규칙]',
    '- 한국어 반말로.',
    ...COMMON_RULES,
    '- 지금은 장애가 아니라 미션(데이터센터를 만드는 일) 시간이야.',
    ...KIND_RULES('situation = 미션이 어디까지 왔는지, todo = 다음 한 단계, command = 그 단계의 명령(한두 줄).'),
    '- 미션의 명령은 값까지 그대로 말해도 돼(미션 설명과 단계에 이미 나와 있어). 단, 미션 전체를 한 번에 풀어주지 마: 다음 한 단계까지만.',
    '- 지금 장애가 나 있어도, 그 장애의 원인이나 고치는 방법은 절대 말하지 마. 장애 이야기를 물으면 "터미널에서 hint를 쳐 봐"라고만 해.',
    '- 아래 [운영 매뉴얼]과 [지금 미션]에 있는 내용만 근거로 답해. 거기에 없는 명령어는 지어내지 마.',
    '- 게임과 상관없는 질문이면 explain으로 한 문장 받고 끝.',
    ...when(
      o.finale,
      '- 지금 미션은 퇴근 퀴즈야. 퀴즈의 정답도, 몇 번(A·B·C·D) 보기가 맞는지도 절대 말하지 마. 설계 보드에서 풀면 되고, 헷갈리면 도감(C)에서 오늘 받은 카드를 다시 읽어 보라고만 해.',
    ),
    JSON_RULE,
    '',
    `[운영 매뉴얼 — 날짜(D-n): ${DAY_LABEL[inp.stage]}]`,
    (manuals[inp.stage] ?? '').trim(),
    '',
    '[지금 미션]',
    `오늘 날짜: ${inp.dayLabel}`,
    `미션: ${o.text}${inp.objectiveDone ? ' (이미 끝냄. 지금 열린 미션은 없어)' : ''}`,
    ...when(o.why, `왜 하는지: ${o.why}`),
    ...when(steps.length, '단계 (처음 해보는 플레이어용):'),
    ...steps.map(
      (s, i) =>
        `${i + 1}. ${s.text}${s.cmd ? ` — 명령: ${s.cmd}` : ''}${s.why ? ` (${s.why})` : ''}${inp.stepsDone[i] ? ' [했음]' : i === next ? ' ← 지금 할 단계' : ''}`,
    ),
    ...cards.map((c) => `관련 개념 카드: ${c.name} — 비유: ${c.analogy} — ${c.definition}`),
    ...when(inp.active.length, `지금 난 장애(제목만, 이 이야기는 터미널의 hint로): ${inp.active.map((s) => s.title).join(' / ')}`),
  ].join('\n');
}

const SPEAKER: Record<HistoryItem['from'], string> = { mentor: '쿠사수', player: '플레이어' };

/** `mask`: what the snapshot must not show the model (the incident's values), so it can't repeat them. */
export function buildUser(inp: HintInput, mask: readonly RegExp[] = []): string {
  let snap = maskValues(JSON.stringify(inp.snapshot), mask);
  if (snap.length > MAX_SNAPSHOT) snap = `${snap.slice(0, MAX_SNAPSHOT)}…`;
  // The client already appends the current question to the history (and a button or the terminal's `hint`
  // puts its own line there with no question); don't say it twice.
  const history = [...inp.history];
  const last = history[history.length - 1];
  if (last?.from === 'player' && (inp.question ? last.text.slice(0, MAX_QUESTION) === inp.question : true)) history.pop();
  return [
    '[현재 상황]',
    snap,
    '',
    // Listed separately so a truncated snapshot never hides what was already tried.
    '[플레이어가 최근에 친 명령]',
    inp.recentCommands.length ? inp.recentCommands.join(' / ') : '(없음)',
    '',
    '[지금까지 대화]',
    history.length ? history.map((m) => `${SPEAKER[m.from]}: ${m.text}`).join('\n') : '(없음)',
    '',
    '[플레이어 질문]',
    inp.question || GUIDE_ASK,
    '',
    inp.want === 'guide' ? '(guide로, 상황·할 일·명령 세 칸. JSON 하나만 답해)' : '(질문에 맞게 guide나 explain으로, 짧게. JSON 하나만 답해)',
  ].join('\n');
}

// ---------- upstream ----------

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface UpstreamResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Hints are short, so turn model thinking off (it would otherwise spend the small max_tokens budget).
 * Each model family spells "off" differently; models that can't turn it off get low effort instead.
 */
function thinkingOff(model: string): Record<string, unknown> {
  if (model === 'claude-sonnet-5-5') return { thinking: { type: 'between_tools' } };
  if (/^claude-(opus-5-5|fable|mythos)/.test(model)) return { output_config: { effort: 'low' } };
  return { thinking: { type: 'disabled' } };
}

class UpstreamError extends Error {}

/** Leave this much time for at least one more upstream call; otherwise give up and fall back. */
const MIN_CALL_MS = 1_500;

/** Drop a response body we won't read (Workers keep the connection busy until it is consumed). */
const discard = (res: Response) => res.body?.cancel().catch(() => {});

/**
 * `deadline` is shared by every upstream call of one /api/hint request (thinking retry + leak retry),
 * so the whole request stays within TIMEOUT_MS and answers before the game client gives up (15 s).
 */
async function callModel(env: Env, model: string, system: string, messages: ChatMessage[], deadline: number): Promise<UpstreamResult> {
  const base = { model, max_tokens: MAX_TOKENS, system, messages };
  const send = async (body: Record<string, unknown>) => {
    const left = deadline - Date.now();
    if (left < MIN_CALL_MS) throw new UpstreamError('upstream: out of time');
    return fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.CHATKHU_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(left),
    });
  };

  let res = await send({ ...base, ...thinkingOff(model) });
  // If the gateway rejects the thinking/effort field, retry once with the plain request.
  if (res.status === 400) {
    await discard(res);
    res = await send(base);
  }
  if (!res.ok) {
    await discard(res);
    throw new UpstreamError(`upstream ${res.status}`);
  }

  const data: unknown = await res.json();
  if (!isRecord(data)) throw new UpstreamError('upstream: bad body');
  if (data.stop_reason === 'refusal') throw new UpstreamError('upstream: refusal');
  const blocks = Array.isArray(data.content) ? data.content.filter(isRecord) : [];
  const first = blocks.find((b) => b.type === 'text' && typeof b.text === 'string');
  const text = first ? String(first.text).trim() : '';
  if (!text) throw new UpstreamError('upstream: no text');
  const usage = isRecord(data.usage) ? data.usage : {};
  return { text, inputTokens: Number(usage.input_tokens) || 0, outputTokens: Number(usage.output_tokens) || 0 };
}

export type AnswerKind = 'guide' | 'explain';

export interface Answer {
  /** What the player reads: a guide's three lines, or an explanation (and its example) */
  reply: string;
  kind: AnswerKind;
  concept: string;
}

/** One field of the model's JSON: one line, capped (a cut field ends in '…'). */
function field(v: unknown, max: number): string {
  const t = typeof v === 'string' ? v.replace(/\s*\n\s*/g, ' ').trim() : '';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A string field of JSON the model cut short (max_tokens): only when its closing quote made it. */
function closedField(t: string, name: string): string | undefined {
  const m = t.match(new RegExp(String.raw`"${name}"\s*:\s*"((?:[^"\\]|\\.)*)"`));
  if (!m) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

function fromFields(o: Record<string, unknown>): Answer | null {
  const concept = field(o.concept, 40);
  if (o.kind === 'guide' || o.situation !== undefined) {
    const g = { situation: field(o.situation, MAX_FIELD.situation), todo: field(o.todo, MAX_FIELD.todo), command: field(o.command, MAX_FIELD.command) };
    // A guide is all three lines or nothing.
    if (!g.situation || !g.todo || !g.command) return null;
    return { reply: formatGuide(g), kind: 'guide', concept };
  }
  if (o.kind === 'explain' || o.answer !== undefined) {
    const answer = field(o.answer, MAX_FIELD.answer);
    if (!answer) return null;
    const example = field(o.example, MAX_FIELD.example);
    return { reply: example ? `${answer}\n예: ${example}` : answer, kind: 'explain', concept };
  }
  if (typeof o.reply === 'string' && o.reply.trim()) return fromText(o.reply.trim(), concept);
  return null;
}

/** Text that isn't the JSON asked for (an older {reply}, plain words): a guide if it reads like one. */
const fromText = (reply: string, concept: string): Answer => ({ reply, kind: parseGuide(reply) ? 'guide' : 'explain', concept });

/**
 * The answer in the model text: the JSON asked for (plain, fenced or cut short), the older {reply}, or plain
 * text. null when it is no usable answer (a guide missing a line, JSON cut before anything closed).
 */
export function parseAnswer(text: string): Answer | null {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      const o: unknown = JSON.parse(obj[0]);
      if (isRecord(o)) return fromFields(o);
    } catch {
      /* fall through */
    }
  }
  if (t.startsWith('{')) {
    const names = ['kind', 'situation', 'todo', 'command', 'answer', 'example', 'reply', 'concept'];
    const o = Object.fromEntries(names.flatMap((n) => (closedField(t, n) === undefined ? [] : [[n, closedField(t, n)]])));
    return fromFields(o);
  }
  return t ? fromText(t, '') : null;
}

/** What the reply must not contain: the incident's answer, or (mission) any incident going on, bar what the mission shows. */
export function bannedForInput(inp: HintInput): RegExp[] {
  if (inp.mode === 'incident') return bannedFor(inp.scenario);
  return missionBanned(inp.active, missionShown(inp.objective));
}

// ---------- handler ----------

interface LogLine {
  ts: string;
  mode: HintInput['mode'];
  /** Incident id, or 'D-4:vlan' for a mission */
  scenarioId: string;
  want: Want;
  /** The kind of answer given ('' when none) */
  kind: AnswerKind | '';
  model: string;
  latencyMs: number;
  leaked: boolean;
  retried: boolean;
  replyLength: number;
  outcome: 'ok' | 'fallback' | 'error';
  inputTokens: number;
  outputTokens: number;
  questionLength: number;
  error?: string;
}

/** POST /api/hint. `manuals` are the day manuals, by day (index.ts bundles them). */
export async function handleHint(request: Request, env: Env, cors: Headers0, manuals: readonly string[]): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413, cors);
  let raw: unknown;
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413, cors);
    raw = JSON.parse(body);
  } catch {
    return json({ error: 'invalid JSON' }, 400, cors);
  }
  const inp = parseInput(raw);
  if (typeof inp === 'string') return json({ error: inp }, 400, cors);

  if (!env.CHATKHU_API_KEY) return json({ fallback: true }, 200, cors);

  const started = Date.now();
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  if (rateLimited(ip, started)) return json({ fallback: true, reason: 'rate_limited' }, 429, cors);

  const model = env.HINT_MODEL || DEFAULT_MODEL;
  const log: LogLine = {
    ts: new Date(started).toISOString(),
    mode: inp.mode,
    scenarioId: inp.mode === 'incident' ? inp.scenario.id : `${DAY_LABEL[inp.stage]}:${inp.objective.id}`,
    want: inp.want,
    kind: '',
    model,
    latencyMs: 0,
    leaked: false,
    retried: false,
    replyLength: 0,
    outcome: 'fallback',
    inputTokens: 0,
    outputTokens: 0,
    questionLength: inp.question.length,
  };

  try {
    const system = inp.mode === 'incident' ? buildSystem(inp, manuals) : buildMissionSystem(inp, manuals);
    const banned = bannedForInput(inp);
    const messages: ChatMessage[] = [{ role: 'user', content: buildUser(inp, banned) }];
    const deadline = started + TIMEOUT_MS;
    // Emoji go before the guard reads the reply, so one wedged inside an answer can't hide it.
    const read = (text: string) => {
      const o = parseAnswer(text);
      if (!o) throw new UpstreamError('upstream: incomplete answer');
      return { ...o, reply: stripEmoji(o.reply) };
    };

    let res = await callModel(env, model, system, messages, deadline);
    log.inputTokens += res.inputTokens;
    log.outputTokens += res.outputTokens;
    let out = read(res.text);

    if (leaks(out.reply, banned)) {
      log.leaked = true;
      log.retried = true;
      messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: inp.mode === 'incident' ? LEAK_RETRY : MISSION_LEAK_RETRY });
      res = await callModel(env, model, system, messages, deadline);
      log.inputTokens += res.inputTokens;
      log.outputTokens += res.outputTokens;
      out = read(res.text);
      if (leaks(out.reply, banned)) return json({ fallback: true }, 200, cors);
    }

    const reply = out.reply.slice(0, MAX_REPLY).trim();
    if (!reply) throw new UpstreamError('upstream: empty reply');
    const ownConcept = inp.mode === 'incident' ? inp.scenario.concept : inp.objective.concept;
    const concept = out.concept || (ownConcept ? CONCEPTS[ownConcept]?.name : '') || '';
    log.outcome = 'ok';
    log.kind = out.kind;
    log.replyLength = reply.length;
    return json({ reply, kind: out.kind, concept }, 200, cors);
  } catch (e) {
    log.outcome = 'error';
    log.error = e instanceof Error ? e.message.slice(0, 120) : 'unknown';
    return json({ fallback: true }, 200, cors);
  } finally {
    log.latencyMs = Date.now() - started;
    // One line per AI call for `wrangler tail` (AI usage log). Never logs the key or the question text.
    console.log(JSON.stringify({ event: 'hint', ...log }));
  }
}
