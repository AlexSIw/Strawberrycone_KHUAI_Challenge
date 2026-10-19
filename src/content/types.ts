import type { Scenario } from '../sim/scenario';
import type { Health, PlayContext, RoomId, StageId, World } from '../sim/types';

export type Speaker = 'lion' | 'mentor' | 'boss' | 'system';
export type Mood = 'happy' | 'worried' | 'neutral';

export interface DialogueLine {
  who: Speaker;
  text: string;
  mood?: Mood;
}

export interface Objective {
  id: string;
  text: string;
  done: (w: World, ctx: PlayContext) => boolean;
  /** Only shown once these objectives are done */
  after?: string[];
}

/** What pressing E on an interactable opens in this stage. */
export type InteractionKind =
  | { kind: 'rack' }
  | { kind: 'cable'; mode: 'build' | 'repair' }
  | { kind: 'power' }
  | { kind: 'console'; host: string }
  | { kind: 'consolePick'; hosts: string[] }
  | { kind: 'terminal' }
  | { kind: 'dashboard' }
  | { kind: 'mentor' }
  | { kind: 'repair'; target: 'crac' }
  | { kind: 'board'; board: 'decompose' | 'dockerfile' | 'desired' | 'postmortem' }
  | { kind: 'quiz' }
  | { kind: 'inspect'; text: string };

export type SpotId =
  | 'rack1' | 'rack2' | 'rack3' | 'rack4'
  | 'switch' | 'router' | 'patch'
  | 'pdu' | 'ups'
  | 'crac'
  | 'monitor' | 'desk' | 'mentor' | 'board';

export interface Quiz {
  question: string;
  choices: string[];
  answer: number;
  explain: string;
}

export interface StageDef {
  id: StageId;
  title: string;
  subtitle: string;
  /** What the stage teaches, shown on stage select */
  topics: string[];
  intro: DialogueLine[];
  outro: DialogueLine[];
  initialWorld: () => World;
  objectives: Objective[];
  scenarios: Scenario[];
  interactions: Partial<Record<SpotId, InteractionKind>>;
  health: (w: World) => Health;
  /** Dashboard panels unlocked in this stage */
  panels: ('power' | 'links' | 'traffic' | 'services' | 'temp' | 'pods')[];
  quiz?: Quiz;
  /** Stage 7 only: seconds the player must hold the service up */
  survive?: number;
  /** Rooms shown on the map (others are dim) */
  rooms?: RoomId[];
}
