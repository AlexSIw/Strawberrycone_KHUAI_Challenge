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

export interface PowerState {
  mains: boolean;
  /** UPS connected in front of PDU A */
  ups: boolean;
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
  ports: [number, number] | null;
  volume: string | null;
  running: boolean;
}

export interface DockerHost {
  python: string;
  pulled: string[];
}

export interface DockerState {
  built: string[];
  registry: string[];
  hosts: Record<string, DockerHost>;
  containers: Container[];
  volumes: string[];
  /** Enrollment rows stored by the db container */
  enrollments: number;
  manualDeploy: { host: string; service: string; status: 'failed' | 'ok' } | null;
  nextId: number;
}

export interface Pod {
  name: string;
  app: string;
  node: string;
  ip: string;
  version: string;
  status: 'Running' | 'Pending' | 'CrashLoopBackOff';
  pendingFor: number;
  restarts: number;
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
