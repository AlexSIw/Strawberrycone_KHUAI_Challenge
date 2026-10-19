// ChatKHU hint backend for "KHU 데이터센터: 수강신청을 지켜라".
//
// POST /api/hint {scenarioId, level, question, history, snapshot}
//   → {reply, concept}            AI 사수 "쿠사수"의 힌트
//   → {fallback: true}            키 없음 / 업스트림 오류 / 정답 유출 → 게임이 기본 힌트를 보여줌
// Every other path is served from ../dist by the [assets] config (run_worker_first = ["/api/*"]).

import { CONCEPTS } from '../../src/content/concepts';
import { ALL_SCENARIOS } from '../../src/content/stages';
import type { Scenario } from '../../src/sim/scenario';
import manual0 from '../../src/content/manual/stage0.md';
import manual1 from '../../src/content/manual/stage1.md';
import manual2 from '../../src/content/manual/stage2.md';
import manual3 from '../../src/content/manual/stage3.md';
import manual4 from '../../src/content/manual/stage4.md';
import manual5 from '../../src/content/manual/stage5.md';
import manual6 from '../../src/content/manual/stage6.md';
import manual7 from '../../src/content/manual/stage7.md';

interface Env {
  CHATKHU_API_KEY?: string;
  HINT_MODEL?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const UPSTREAM = 'https://factchat-cloud.mindlogic.ai/v1/gateway/claude/v1/messages/';
const DEFAULT_MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 400;
const TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 32_000;
const MAX_QUESTION = 300;
const MAX_HISTORY = 8;
const MAX_HISTORY_TEXT = 400;
const MAX_SNAPSHOT = 3_000;
const MAX_REPLY = 600;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const MANUALS = [manual0, manual1, manual2, manual3, manual4, manual5, manual6, manual7];
const SCENARIOS = new Map<string, Scenario>(ALL_SCENARIOS.map((s) => [s.id, s]));
const LEAK_RETRY = '방금 답은 정답을 너무 직접 말했어. 정답 없이 힌트만. 같은 JSON 형식으로 다시.';

// ---------- HTTP helpers ----------

type Headers0 = Record<string, string>;

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** CORS is only needed in dev (Vite on :5173 talking to wrangler on :8787 without the proxy). */
function corsHeaders(request: Request): Headers0 {
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

function json(body: unknown, status: number, extra: Headers0 = {}): Response {
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

interface HintInput {
  scenario: Scenario;
  level: 1 | 2 | 3;
  question: string;
  history: HistoryItem[];
  snapshot: Record<string, unknown>;
  recentCommands: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseInput(raw: unknown): HintInput | string {
  if (!isRecord(raw)) return 'body must be a JSON object';
  const scenario = typeof raw.scenarioId === 'string' ? SCENARIOS.get(raw.scenarioId) : undefined;
  if (!scenario) return 'unknown scenario';

  const n = Number(raw.level);
  const level = (Number.isFinite(n) ? Math.min(3, Math.max(1, Math.round(n))) : 1) as 1 | 2 | 3;
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
  return { scenario, level, question, history, snapshot, recentCommands };
}

// ---------- prompt ----------

const LEVEL_GUIDE: Record<1 | 2 | 3, string> = {
  1: '1단계 = 관찰 질문. 무엇을 보면 좋을지 되물어서 스스로 증상을 관찰하게 해.',
  2: '2단계 = 방향. 어느 계층·어느 쪽이 의심스러운지 방향만 짚어줘.',
  3: '3단계 = 도구/명령 종류. 어떤 종류의 명령어나 화면을 쓰면 되는지 알려줘. 인자·값·대상 이름은 빼고.',
};

function buildSystem(inp: HintInput): string {
  const sc = inp.scenario;
  const concept = CONCEPTS[sc.concept];
  const manual = MANUALS[sc.stage] ?? '';
  return [
    '너는 경희대학교 데이터센터의 선배 엔지니어 "쿠사수"야. 신입 엔지니어(경희대 사자)가 수강신청 서버 장애를 스스로 해결하도록 돕는 멘토야.',
    '플레이어는 서버를 거의 모르는 초보야.',
    '',
    '[규칙]',
    '- 한국어 반말로, 친근하고 짧게. 최대 3문장.',
    '- 정답을 절대 말하지 마: 정확한 명령어 전체, 설정 값, IP 주소, 포트 번호, 고쳐야 할 장비의 이름·위치는 말하지 않아.',
    `- 이번 힌트 단계는 ${inp.level}단계야. 이 단계에 맞는 힌트만 줘. ${LEVEL_GUIDE[inp.level]}`,
    '  (참고: 1단계 = 관찰 질문, 2단계 = 방향, 3단계 = 도구/명령 종류)',
    '- 플레이어가 이미 해본 명령(현재 상황의 recentCommands)이 있으면 먼저 짧게 칭찬하고, 그다음 힌트를 줘.',
    '- 아파트, 전화번호부, 호실 번호, 푸드코트, 밀키트처럼 생활 속 비유를 써서 쉽게 말해.',
    '- 아래 [운영 매뉴얼]에 있는 내용만 근거로 답해. 매뉴얼에 없는 명령어는 지어내지 마.',
    '- 게임과 상관없는 질문이면 한 문장으로 받아주고 장애 이야기로 돌아와.',
    '- 출력은 JSON 객체 하나만: {"reply": "쿠사수가 할 말", "concept": "관련 개념 이름(짧게)"}. 코드 블록이나 다른 글은 붙이지 마.',
    '',
    `[운영 매뉴얼 — Stage ${sc.stage}]`,
    manual.trim(),
    '',
    '[이번 장애 — 비공개 정보, 절대 그대로 말하지 말 것]',
    `제목: ${sc.title}`,
    `증상(플레이어가 받은 알림): ${sc.alert}`,
    `정답(비공개): ${sc.solution}`,
    `절대 쓰면 안 되는 표현: ${sc.bannedPhrases.join(' / ')}`,
    concept ? `관련 개념: ${concept.name} — 비유: ${concept.analogy} — ${concept.definition}` : '',
    '힌트 예시 (말투와 수준만 참고. 그대로 복사하지 말고 지금 상황과 질문에 맞게 바꿔 말해):',
    ...sc.hints.map((h, i) => `${i + 1}단계${i + 1 === inp.level ? ' (지금 단계)' : ''}: ${h}`),
  ].join('\n');
}

const SPEAKER: Record<HistoryItem['from'], string> = { mentor: '쿠사수', player: '플레이어' };

function buildUser(inp: HintInput): string {
  let snap = JSON.stringify(inp.snapshot);
  if (snap.length > MAX_SNAPSHOT) snap = `${snap.slice(0, MAX_SNAPSHOT)}…`;
  // The client already appends the current question to the history; don't say it twice.
  const history = [...inp.history];
  const last = history[history.length - 1];
  if (inp.question && last?.from === 'player' && last.text.slice(0, MAX_QUESTION) === inp.question) history.pop();
  return [
    '[현재 상황]',
    snap,
    '',
    // Listed separately so a truncated snapshot never hides what to praise.
    '[플레이어가 최근에 친 명령]',
    inp.recentCommands.length ? inp.recentCommands.join(' / ') : '(없음)',
    '',
    '[지금까지 대화]',
    history.length ? history.map((m) => `${SPEAKER[m.from]}: ${m.text}`).join('\n') : '(없음)',
    '',
    '[플레이어 질문]',
    inp.question || '다음 힌트 주세요',
    '',
    `(힌트 ${inp.level}단계로, JSON 하나만 답해)`,
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

/** Pull {reply, concept} out of the model text: plain JSON, fenced JSON, truncated JSON, or plain text. */
function parseReply(text: string): { reply: string; concept: string } {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      const o: unknown = JSON.parse(obj[0]);
      if (isRecord(o) && typeof o.reply === 'string' && o.reply.trim()) {
        return { reply: o.reply.trim(), concept: typeof o.concept === 'string' ? o.concept.trim() : '' };
      }
    } catch {
      /* fall through */
    }
  }
  const field = t.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (field) {
    try {
      return { reply: JSON.parse(`"${field[1]}"`) as string, concept: '' };
    } catch {
      return { reply: field[1], concept: '' };
    }
  }
  return { reply: t, concept: '' };
}

// ---------- answer-leak guard ----------

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Exact answer values inside a solution command: IPs (10.0.1.20), port pairs (80:8000) and KEY=VALUE
 * settings. On their own they already give the answer away, even without the rest of the command.
 */
const VALUE_TOKEN = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\d+:\d+|[a-z_][a-z0-9_]*=\S+)$/i;

/**
 * Phrases are matched as substrings, with two kinds of edges:
 * - a phrase starting/ending with a digit must not continue into more digits
 *   (banning 10.0.1.1 must not block a reply that mentions 10.0.1.10);
 * - a leading/trailing space in a bannedPhrase means "word edge": '/enrol ' blocks "/enrol)" and
 *   "/enrol이" but not the correct "/enroll".
 */
function phraseRe(raw: string): RegExp {
  const p = raw.trim();
  const head = /^\s/.test(raw) ? '(?<![a-z0-9_])' : /^\d/.test(p) ? '(?<![\\d.])' : '';
  const tail = /\s$/.test(raw) ? '(?![a-z0-9_])' : /\d$/.test(p) ? '(?!\\d)' : '';
  return new RegExp(head + escapeRe(p) + tail);
}

/** bannedPhrases + every multi-word solution command + the exact values in those commands. */
function bannedFor(sc: Scenario): RegExp[] {
  const cmds = sc.solutionSteps.flatMap((s) => ('cmd' in s ? [s.cmd.trim()] : []));
  const values = cmds.flatMap((c) => c.split(/\s+/).filter((t) => VALUE_TOKEN.test(t)));
  const phrases = [...sc.bannedPhrases, ...cmds.filter((c) => c.includes(' ')), ...values]
    .map(normalize)
    .filter((p) => p.trim() !== '');
  return [...new Set(phrases)].map(phraseRe);
}

function leaks(reply: string, banned: RegExp[]): boolean {
  const r = ` ${normalize(reply)} `;
  return banned.some((re) => re.test(r));
}

// ---------- handler ----------

interface LogLine {
  ts: string;
  scenarioId: string;
  level: number;
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

async function handleHint(request: Request, env: Env, cors: Headers0): Promise<Response> {
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
    scenarioId: inp.scenario.id,
    level: inp.level,
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
    const system = buildSystem(inp);
    const messages: ChatMessage[] = [{ role: 'user', content: buildUser(inp) }];
    const banned = bannedFor(inp.scenario);
    const deadline = started + TIMEOUT_MS;

    let res = await callModel(env, model, system, messages, deadline);
    log.inputTokens += res.inputTokens;
    log.outputTokens += res.outputTokens;
    let out = parseReply(res.text);

    if (leaks(out.reply, banned)) {
      log.leaked = true;
      log.retried = true;
      messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: LEAK_RETRY });
      res = await callModel(env, model, system, messages, deadline);
      log.inputTokens += res.inputTokens;
      log.outputTokens += res.outputTokens;
      out = parseReply(res.text);
      if (leaks(out.reply, banned)) return json({ fallback: true }, 200, cors);
    }

    const reply = out.reply.slice(0, MAX_REPLY).trim();
    if (!reply) throw new UpstreamError('upstream: empty reply');
    const concept = out.concept || CONCEPTS[inp.scenario.concept]?.name || '';
    log.outcome = 'ok';
    log.replyLength = reply.length;
    return json({ reply, concept }, 200, cors);
  } catch (e) {
    log.outcome = 'error';
    log.error = e instanceof Error ? e.message.slice(0, 120) : 'unknown';
    return json({ fallback: true }, 200, cors);
  } finally {
    log.latencyMs = Date.now() - started;
    // One line per AI call for `wrangler tail` → AI 활용 기록 (서식4). Never logs the key or the question text.
    console.log(JSON.stringify({ event: 'hint', ...log }));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (url.pathname === '/api/hint' || url.pathname === '/api/hint/') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { ...cors, allow: 'POST, OPTIONS' });
      return handleHint(request, env, cors);
    }
    if (url.pathname === '/api/health') return json({ ok: true, ai: !!env.CHATKHU_API_KEY, model: env.HINT_MODEL || DEFAULT_MODEL }, 200, cors);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404, cors);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
