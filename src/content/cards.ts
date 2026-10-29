import { CONCEPTS } from './concepts';
import { getStage, STAGES } from './stages';
import type { Objective, StageDef } from './types';
import type { StageId } from '../sim/types';

/** The cards a mission awards when it is done: its concept, then its alsoConcepts (no duplicates). */
export function missionCards(o: Pick<Objective, 'concept' | 'alsoConcepts'>): string[] {
  return [...new Set([...(o.concept ? [o.concept] : []), ...(o.alsoConcepts ?? [])])];
}

/** '<template>:<variant>' → '<template>' */
const templateOf = (scenarioId: string) => {
  const i = scenarioId.lastIndexOf(':');
  return i < 0 ? scenarioId : scenarioId.slice(0, i);
};

/** Cards of the incidents that can really happen on this day: its fixed ones, and the extras pool when it draws any. */
function incidentCards(def: StageDef, fixedOnly = false): string[] {
  const fixed = new Set(def.fixed.map((f) => f.template));
  const drawsExtras = !fixedOnly && def.extras[1] > 0;
  return def.scenarios.filter((s) => drawsExtras || fixed.has(templateOf(s.id))).map((s) => s.concept);
}

/** Every concept card a stage can award (missions first, then incidents), without duplicates. */
export function stageCards(id: StageId): string[] {
  const def = getStage(id);
  return [...new Set([...def.objectives.flatMap(missionCards), ...incidentCards(def)])];
}

/** Stage where each concept card is first met (a mission's concept or alsoConcepts, or an incident that can happen). */
export const FIRST_STAGE: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const st of STAGES) for (const c of stageCards(st.id)) if (!(c in m)) m[c] = st.id;
  return m;
})();

/** Cards each day's missions teach (concept + alsoConcepts). */
const MISSION_CARDS: Set<string>[] = STAGES.map((st) => new Set(st.objectives.flatMap(missionCards)));

/** Cards of a day's always-on incidents: what a read-ahead of that day must not show (it would give the cause away). */
export function fixedIncidentCards(id: StageId): Set<string> {
  return new Set(incidentCards(getStage(id), true));
}

/** How the 도감 shows a card: earned, not earned but readable ahead ('아직 못 받은 카드 · 미리 읽기'), or ??? */
export type CardAccess = 'owned' | 'ahead' | 'locked';

/**
 * The 도감 rule. A card not earned yet can be read once its day has come: it was first met on an earlier day, or
 * today's missions teach it. Later days' cards stay hidden. So do today's cards in `spoilers` (the cards of
 * today's incidents not solved yet): reading one ahead would give an incident's cause away.
 */
export function cardAccess(id: string, day: number, owned: ReadonlySet<string>, spoilers: ReadonlySet<string> = new Set()): CardAccess {
  if (owned.has(id)) return 'owned';
  const first = FIRST_STAGE[id];
  if (first === undefined || first > day) return 'locked';
  if (first < day) return 'ahead';
  return MISSION_CARDS[day]?.has(id) && !spoilers.has(id) ? 'ahead' : 'locked';
}

/** What the "지금까지" screen shows for a day started cold. */
export interface DayRecap {
  built: string[];
  /** Concept ids, only known cards */
  concepts: string[];
  primer: { tool: string; role: string }[];
}

/**
 * The day's "지금까지" recap: its own `recap` / `primer`, or, where a day has none, what the days before it were
 * about and the cards their missions teach.
 */
export function dayRecap(id: StageId): DayRecap {
  const def = getStage(id);
  const before = STAGES.filter((st) => st.id < id);
  const built = def.recap?.built ?? before.map((st) => `${st.label} ${st.title}: ${st.subtitle}`);
  const concepts = def.recap?.concepts ?? [...new Set(before.flatMap((st) => st.objectives.flatMap(missionCards)))];
  return { built, concepts: concepts.filter((c) => c in CONCEPTS), primer: def.primer ?? [] };
}
