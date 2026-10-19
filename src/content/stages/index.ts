import type { StageId } from '../../sim/types';
import type { StageDef } from '../types';
import { stage0 } from './stage0';
import { stage1 } from './stage1';
import { stage2 } from './stage2';
import { stage3 } from './stage3';
import { stage4 } from './stage4';
import { stage5 } from './stage5';
import { stage6 } from './stage6';
import { stage7 } from './stage7';

export const STAGES: StageDef[] = [stage0, stage1, stage2, stage3, stage4, stage5, stage6, stage7];

export const getStage = (id: StageId): StageDef => STAGES[id];

export const ALL_SCENARIOS = STAGES.flatMap((s) => s.scenarios);
