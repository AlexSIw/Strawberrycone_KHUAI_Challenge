// World state for the data-center simulation.
// Every section is optional: each stage only fills in the layers it teaches.

export type StageId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type RoomId = 'server' | 'network' | 'power' | 'cooling' | 'noc';

export interface L3Config {
  mode: 'dhcp' | 'static';
  ip: string | null;
  mask: number;
  gw: string | null;
}

export interface Device {
  id: string;
  kind: 'server' | 'switch' | 'router' | 'internet';
  label: string;
  rack?: string;
  installed: boolean;
  feeds: ('A' | 'B')[];
  ports: string[];
  l3?: L3Config;
}

/** Endpoints are written as "deviceId:port". */
export interface Cable {
  id: string;
  a: string;
  b: string;
  broken: boolean;
}

/**
 * Power path: mains → (UPS) → PDU A, and mains → PDU B.
 * A is the battery-backed line (survives a blackout once the UPS is connected);
 * B is a separate line (survives when PDU A itself fails). A device fed by both survives either fault.
 */
export interface PowerState {
  mains: boolean;
  /** UPS connected in front of PDU A */
  ups: boolean;
  /** PDU whose breaker has tripped: that line carries no power until it is reset */
  pduDown?: 'A' | 'B';
}

export interface NetState {
  dhcpServer: boolean;
  /** Address DHCP hands to each device */
  dhcpLeases: Record<string, string>;
  dns: Record<string, string>;
  routerIp: string;
  mask: number;
}

export interface WebServer {
  host: string;
  running: boolean;
  port: number;
  threads: 'single' | 'multi';
  routes: string[];
}

export interface AppService {
  name: string;
  label: string;
  up: boolean;
  replicas: number;
  /** Requests per second one replica can serve */
  capacityRps: number;
  /** Share of incoming traffic that reaches this service */
  share: number;
  /** Services this one calls synchronously */
  calls: string[];
  /** Databases this service reads directly */
  dbAccess: string[];
  /** Seconds left before a manually installed replica is ready */
  installing: number[];
  crashLoop: boolean;
  restartTimer: number;
}

export interface AppState {
  arch: 'monolith' | 'msa';
  services: Record<string, AppService>;
  courseDbSchema: number;
  /** Bug that crashes the monolith / notify service under load */
  notifyBug: boolean;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  host: string;
  /** -p host:container — [port on the server, port inside the container] */
  ports: [number, number] | null;
  /** -v source:path — named volume (or bind-mounted server folder) and where it is mounted inside */
  volume: string | null;
  volumePath: string | null;
  /**
   * Enrollment rows in the container's own writable layer (only a DB whose data folder has no volume
   * writes here). Kept across stop/start/restart, gone when the container is removed.
   */
  rows: number;
  running: boolean;
}

export interface DockerHost {
  python: string;
  /** Images on this server */
  pulled: string[];
  /** Volumes (and bind-mounted folders) on this server → enrollment rows MySQL wrote into them; 0 = empty */
  volumes: Record<string, number>;
  /** Host ports already used by programs outside Docker (e.g. a hand-installed app) */
  busyPorts?: number[];
}

export interface DockerState {
  /** Images on the admin PC (ops) */
  built: string[];
  registry: string[];
  hosts: Record<string, DockerHost>;
  containers: Container[];
  manualDeploy: { host: string; service: string; status: 'failed' | 'ok' } | null;
  nextId: number;
}

export interface Pod {
  name: string;
  app: string;
  /** Node it runs on; '' = not scheduled yet (no node had room), so it waits as Pending */
  node: string;
  /** Pod IP; '' until the pod lands on a node */
  ip: string;
  version: string;
  status: 'Running' | 'Pending' | 'CrashLoopBackOff';
  pendingFor: number;
  restarts: number;
  /** World time (w.t) when this pod object was created, for the AGE column */
  born: number;
}

export interface Deployment {
  replicas: number;
  image: string;
  history: string[];
  env: Record<string, string>;
  rolling: { target: string } | null;
}

export interface K8sState {
  nodes: Record<string, { ready: boolean; rack: string; uplink: string }>;
  deployments: Record<string, Deployment>;
  pods: Pod[];
  services: Record<string, { selector: string }>;
  podSeq: number;
  ipSeq: number;
  /** Image versions that are buggy */
  badVersions: string[];
  maxPodsPerNode: number;
  /** Image tags that exist in the registry (set image to anything else fails to pull) */
  images?: string[];
  /** World time the cluster last saw (kept by updateNodes); new pods are born at this time */
  clock?: number;
}

export interface CoolingState {
  cracOk: boolean;
  /** Rack temperatures (°C) */
  temps: Record<string, number>;
  /** Racks the CRAC unit cools */
  cracRacks: string[];
}

export interface Traffic {
  rps: number;
  /** Fraction of students that use the link in the notice */
  noticeShare: number;
}

export interface World {
  t: number;
  devices: Record<string, Device>;
  cables: Record<string, Cable>;
  power?: PowerState;
  net?: NetState;
  web?: WebServer;
  notice?: { url: string };
  app?: AppState;
  docker?: DockerState;
  k8s?: K8sState;
  cooling?: CoolingState;
  traffic: Traffic;
  /** Free-form flags scenarios use for story state */
  flags: Record<string, number | boolean | string>;
}

export interface Health {
  availability: number;
  latencyMs: number;
  errorRate: number;
  rps: number;
  maxTemp: number;
  powerKw: number;
  /** Per-service status for the dashboard */
  services: Record<string, 'up' | 'degraded' | 'down'>;
  notes: string[];
}

/** Things the player did that objectives and scenarios can look at. */
export interface PlayContext {
  visited: string[];
  events: string[];
  commands: string[];
  resolved: string[];
  stageTime: number;
  /** World time (w.t) when each event last happened */
  eventTimes: Record<string, number>;
}
