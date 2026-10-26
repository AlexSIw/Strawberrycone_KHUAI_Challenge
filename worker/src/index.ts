// AI hint backend for "KHU 데이터센터: 수강신청을 지켜라".
//
// POST /api/hint
//   {scenarioId, level, question, history, snapshot}                    → an incident hint (Lv1–3)
//   {objectiveId, stage, stepsDone, activeScenarioIds, question, …}       → a mission question (no scenarioId)
//   → {reply, concept}            AI 사수 "쿠사수"의 답
//   → {fallback: true}            키 없음 / 업스트림 오류 / 정답 유출 → 게임이 기본 답을 보여줌
// The handler lives in ./hint.ts (testable); this file bundles the day manuals and routes.
// Every other path is served from ../dist by the [assets] config (run_worker_first = ["/api/*"]).

import manual0 from '../../src/content/manual/day0.md';
import manual1 from '../../src/content/manual/day1.md';
import manual2 from '../../src/content/manual/day2.md';
import manual3 from '../../src/content/manual/day3.md';
import manual4 from '../../src/content/manual/day4.md';
import manual5 from '../../src/content/manual/day5.md';
import { corsHeaders, DEFAULT_MODEL, handleHint, json, type Env } from './hint';

/** Operations manual per day (an incident uses the manual of the day it is first taught; a mission, its own day's). */
const MANUALS = [manual0, manual1, manual2, manual3, manual4, manual5];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (url.pathname === '/api/hint' || url.pathname === '/api/hint/') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { ...cors, allow: 'POST, OPTIONS' });
      return handleHint(request, env, cors, MANUALS);
    }
    if (url.pathname === '/api/health') return json({ ok: true, ai: !!env.CHATKHU_API_KEY, model: env.HINT_MODEL || DEFAULT_MODEL }, 200, cors);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404, cors);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
