import { getStage, STAGES } from './stages';
import type { StageId } from '../sim/types';

/** Every concept card a stage can award (objectives first, then incidents), without duplicates. */
export function stageCards(id: StageId): string[] {
  const def = getStage(id);
  const ids = [...def.objectives.flatMap((o) => (o.concept ? [o.concept] : [])), ...def.scenarios.map((s) => s.concept)];
  return [...new Set(ids)];
}

/** Stage where each concept card is first met. */
export const FIRST_STAGE: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const st of STAGES) for (const c of stageCards(st.id)) if (!(c in m)) m[c] = st.id;
  return m;
})();
