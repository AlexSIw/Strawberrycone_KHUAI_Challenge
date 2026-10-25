import type { ClockDef } from '../sim/clock';
import type { Scenario, Trigger } from '../sim/scenario';
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
  /** Only shown once these incidents are resolved (for a step that can't succeed while they're broken) */
  afterIncidents?: string[];
  /** Only shown once these incidents have fired (active or already resolved) */
  afterFired?: string[];
  /** Concept card awarded when this objective is completed */
  concept?: string;
  /** "What just happened" line on that card */
  lesson?: string;
  /** Where on the map this objective is done (gets a "여기" marker while it is the current one) */
  spot?: SpotId;
  /** Short progress suffix shown after the text, e.g. "2/5" */
  progress?: (w: World, ctx: PlayContext) => string;
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
  /** The NOC console (NMS / SMS / FMS / NAC tabs) */
  | { kind: 'noc'; tab?: NocTab }
  /** A facility unit's gauges: read-only (facilities are the facility team's job) */
  | { kind: 'gauge'; target: 'ups' | 'pdu' | 'crac' }
  | { kind: 'board'; board: 'decompose' | 'dockerfile' | 'desired' | 'postmortem' }
  | { kind: 'quiz' }
  | { kind: 'inspect'; text: string };

export type NocTab = 'nms' | 'sms' | 'fms' | 'nac';

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

/** An always-on incident of the day: template id + trigger (the scheduler picks the variant by seed). */
export interface FixedIncident {
  template: string;
  trigger: Trigger;
}

/**
 * One day (the v1 name StageDef is kept so its ~30 users don't churn; DayDef is the same type).
 * `scenarios` is the REGISTRY of every incident instance that may happen today — the run's scheduler
 * picks which ones actually do (see sim/scheduler.ts). days/index.ts fills it from the templates.
 */
export interface StageDef {
  id: StageId;
  /** 'D-4' */
  label: string;
  /** 'MM-DD' (syslog stamps, calendar) */
  date: string;
  clock: ClockDef;
  /** Seconds between SNMP polls (default 15) */
  pollEvery?: number;
  /** Incidents that always happen today (the ones it teaches; the D-Day timeline; optional mistakes) */
  fixed: FixedIncident[];
  /** How many extra incidents to draw from earlier days (and today's non-fixed templates) */
  extras: [number, number];
  /** Device ids the cable / power / rack mini-games and the map show today; the switch the cable game plugs into */
  mapSwitch?: string;
  mapDevices?: string[];
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
  /** Called every tick before incidents (traffic curves, e.g. D-Day's open spike) */
  onTick?: (w: World, t: number) => void;
  /**
   * Day time (s) from which every second with traffic counts toward the day's availability (the daily
   * report and the stars), whatever the incidents are doing. Unset: only the time between incidents counts.
   */
  scoreAvailabilityFrom?: number;
  /** With scoreAvailabilityFrom: the objective whose completion ends the scored stretch (D-Day: `hold`). */
  scoreAvailabilityUntil?: string;
}

export type DayDef = StageDef;

/** What a day file exports. days/index.ts adds the incident registry and the starting world. */
export interface DaySpec extends Omit<StageDef, 'scenarios' | 'initialWorld'> {
  /** Remove from the D-Day topology what this day's missions build (applied for this day and every earlier day) */
  unbuild?: (w: World) => void;
  /** Add this day's own layers / settings to its starting world (web app, docker, traffic …) */
  setup?: (w: World) => void;
}
