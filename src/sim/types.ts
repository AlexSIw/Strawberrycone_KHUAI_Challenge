// World state for the data-center simulation.
// Every section is optional: each day only fills in the layers it teaches.

/** 0 = D-5 … 4 = D-1, 5 = D-Day. */
export type DayId = 0 | 1 | 2 | 3 | 4 | 5;
/** v1 name, kept as an alias so the files that use it don't churn. Means a day now. */
export type StageId = DayId;
export const DAY_LABEL = ['D-5', 'D-4', 'D-3', 'D-2', 'D-1', 'D-Day'] as const;
export const LAST_DAY: DayId = 5;
export const dayLabel = (d: DayId): string => DAY_LABEL[d];

export type RoomId = 'server' | 'network' | 'power' | 'cooling' | 'noc';

export interface L3Config {
  mode: 'dhcp' | 'static';
  ip: string | null;
  mask: number;
  gw: string | null;
}

export type DeviceKind = 'server' | 'switch' | 'router' | 'internet' | 'firewall' | 'lb';

export interface Device {
  id: string;
  kind: DeviceKind;
  /** Shown name. For network gear this is the IOS hostname (CORE-01); servers use theirs (WEB-01). */
  label: string;
  rack?: string;
  installed: boolean;
  feeds: ('A' | 'B')[];
  /** Physical ports (cable endpoints). Network gear uses IOS short names: 'Gi1/0/1', 'Te1/1/1'. */
  ports: string[];
  /** Host addressing (servers, the admin PC). Network gear keeps its addresses in `nd`. */
  l3?: L3Config;
  /** Network-gear state: switches, routers, firewalls, L4. */
  nd?: NetDevice;
}

/** Endpoints are written as "deviceId:port". */
export interface Cable {
  id: string;
  a: string;
  b: string;
  broken: boolean;
  /** Bad crimp / damaged jacket: the link stays up, CRC errors climb and ~20% of frames are lost. */
  degraded?: boolean;
}

// ---------- network gear (v2) ----------

export type IfMode = 'access' | 'trunk' | 'routed';
/** Operational state. Always DERIVED (net/operState), never set by hand. */
export type IfOper = 'up' | 'down' | 'admin-down' | 'err-disabled';

export interface Iface {
  /** `shutdown` in the config */
  shutdown: boolean;
  errDisabled: null | 'bpduguard';
  mode: IfMode;
  /** `switchport access vlan N` (default 1) */
  accessVlan: number;
  /** `switchport trunk allowed vlan …` */
  allowed: 'all' | number[];
  /** `ip address A M` on a routed port */
  ip?: { addr: string; mask: number };
  /** `channel-group N mode active`: member of Port-channel N (key `Po${N}` in `ifs`) */
  group?: number;
  /** Mbps: Gi 1000, Te 10000, Hu 100000 */
  speed: 1000 | 10000 | 100000;
  /** Input CRC error counter (`show interfaces counters errors`) */
  crc: number;
  /** `spanning-tree bpduguard enable` */
  bpduguard?: boolean;
  desc?: string;
  /** Edge-detect cache for syslog. Written ONLY by syncNet. */
  _oper?: IfOper;
  /** Edge-detect cache for %EC-5-BUNDLE: Po number this member was bundled into at the last sync (null = not bundled). Written ONLY by syncNet. */
  _inPo?: number | null;
}

export interface Hsrp {
  group: number;
  vip: string;
  priority: number;
  preempt: boolean;
}

/** `interface VlanN` (an SVI: the switch's own address in that VLAN). */
export interface Svi {
  ip: string | null;
  mask: number;
  shutdown: boolean;
  /** `ip helper-address` (DHCP relay) */
  helper?: string;
  hsrp?: Hsrp;
  /** Edge-detect cache for syslog. Written ONLY by syncNet. */
  _up?: boolean;
}

/** One `show logging` line. `t` is world time; the day's clock formats it ("*Feb 10 10:00:31"). */
export interface SyslogEntry {
  t: number;
  /** Facility-severity-mnemonic, e.g. 'LINK-3-UPDOWN' */
  tag: string;
  msg: string;
}

export interface NetDevice {
  os: 'ios' | 'lb' | 'fw';
  /** Product name shown in show output / NMS, e.g. 'KHU-SW9300' (fictional models) */
  model: string;
  /** Out-of-band management address (10.10.250.x). Reachable from the NOC whenever the device has power. */
  mgmtIp: string;
  /** Every interface, physical and logical (Po1). Keys are canonical short names and include every entry of `Device.ports`. */
  ifs: Record<string, Iface>;
  /** `vlan N` / `name X` */
  vlans: Record<number, string>;
  svis: Record<number, Svi>;
  /** Lower wins the STP root election. Cores 4096/8192, everything else 32768. */
  stpPriority: number;
  /** VLANs where STP is turned off (`no spanning-tree vlan N`) */
  stpOff: number[];
  /** running-config differs from startup-config (not saved with `write memory`) */
  dirty: boolean;
  /** Snapshot taken by `write memory` (JSON of ifs/vlans/svis/stp); null = never saved */
  startup: string | null;
  /** Syslog ring buffer (newest last, at most 100) */
  log: SyslogEntry[];
}

/** IOS CLI position. Lives here because the store, terminal and command layer all carry it. */
export type IosLevel = 'user' | 'exec' | 'config' | 'config-if' | 'config-vlan';
export interface IosMode {
  level: IosLevel;
  /** Interfaces being configured (config-if) */
  ifs?: string[];
  /** VLAN being configured (config-vlan), or the SVI's VLAN when `ifs` is ['VlanN'] */
  vlan?: number;
}

/**
 * Power path: mains → (UPS) → PDU A, and mains → PDU B.
 * A is the battery-backed line (survives a blackout once the UPS is connected);
 * B is a separate line (survives when PDU A itself fails). A device fed by both survives either fault.
 */
export interface PowerState {
  mains: boolean;
  /** UPS connected in front of PDU A (always true in v2: facilities are monitor-only) */
  ups: boolean;
  /** PDU whose breaker has tripped: that line carries no power until it is reset */
  pduDown?: 'A' | 'B';
  /** Racks cut off entirely (fire suppression): nothing in them has power */
  racksDown?: string[];
}

/** A DHCP scope on dhcp01. Addresses are last-octet numbers inside `network`/`mask`. */
export interface DhcpPool {
  name: string;
  label: string;
  network: string;
  mask: number;
  start: number;
  end: number;
  gw: string;
  dns: string[];
  /** Leases still held by devices that left (expired-but-not-reclaimed); they take addresses too */
  stale: number;
}

/**
 * A crowd of campus endpoints behind one campus-switch port (not modelled one by one). The port has no
 * cable (it stands for the building's wiring); it counts as up unless shut down or err-disabled.
 */
export interface ClientGroup {
  label: string;
  /** DHCP pool these clients take addresses from */
  pool: string;
  /** Campus switch and access port they hang off */
  switch: string;
  port: string;
  /** How many devices are trying to get on the network */
  count: number;
}

/** First matching rule wins; no match = permit (the firewall here only adds blocks). */
export interface FwRule {
  seq: number;
  action: 'permit' | 'deny';
  /** CIDR, e.g. '198.51.100.77/32' or 'any' */
  src: string;
  dst: string;
  port?: number;
}

export interface LbMember {
  name: string;
  /** Device id the member lives on */
  host: string;
  port: number;
  enabled: boolean;
}

export interface LbState {
  /** Inside VIP (VLAN 30) and the public address the firewall maps to it */
  vip: string;
  publicIp: string;
  port: number;
  /** L4-01, L4-02: the first one that is powered and linked is active */
  pair: [string, string];
  members: LbMember[];
  health: { proto: 'tcp' | 'http'; port: number; path: string };
  /** Session table limit of the active unit */
  maxConn: number;
}

/** Extra traffic on top of `traffic.rps` (macro bots, campus users). */
export interface TrafficSource {
  id: string;
  label: string;
  /** Where it comes from: an outside CIDR (macro) or a client group id (campus) */
  cidr: string;
  rps: number;
  kind: 'macro' | 'campus';
}

/** Network services and caches (v2). Replaces the v1 flat-subnet NetState. */
export interface NetState {
  /** name → IP. Lookups are case-insensitive. Works while one of `dnsServers` is up and reachable. */
  dns: Record<string, string>;
  /** Device ids of the DNS servers (ns1, ns2) */
  dnsServers: string[];
  dhcp: { server: string; running: boolean; pools: Record<string, DhcpPool> };
  clients: Record<string, ClientGroup>;
  fw: { rules: FwRule[] };
  lb?: LbState;
  // ---- caches: written ONLY by syncNet ----
  /** VLAN → core device id that is HSRP active (preempt needs the previous winner) */
  hsrpActive: Record<number, string | null>;
  /** Logical link key → offered load and capacity (Mbps) */
  load: Record<string, { mbps: number; cap: number }>;
  /** VLANs with a broadcast storm right now */
  storm: number[];
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
  /** `cordoned` = `kubectl cordon`/`drain`: the scheduler places no new pods there (running ones stay unless drained). */
  nodes: Record<string, { ready: boolean; rack: string; uplink: string; cordoned?: boolean }>;
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
  /** Students hitting 수강신청 (via the internet → L4 VIP) */
  rps: number;
  /** Fraction of students that use the link in the notice */
  noticeShare: number;
  /** Other flows (macro bots, campus users) */
  sources?: TrafficSource[];
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
  /** KHU 포털 / LMS / 웹메일 / 도서관 */
  campus?: Record<string, CampusService>;
  /** The enrollment DB server's connection limit (D-Day: pods × DB_POOL must stay under it) */
  db?: { maxConn: number };
  traffic: Traffic;
  /** Free-form flags scenarios use for story state */
  flags: Record<string, number | boolean | string>;
}

/** A campus service watched in the SMS (shallow: status and response time; fix = restart or hand to its team). */
export interface CampusService {
  label: string;
  up: boolean;
  latencyMs: number;
  /** Team that owns it (담당팀 이관) */
  team: string;
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
