# KHU DC Game v2 — "서버실 D-Day" implementation plan

## Context

남궁호민's v2 doc (10/20) turns the 8-stage game into a 5-day build-up (D-5 → D-1) plus a real-time 수강신청 D-Day. It also widens scope to the whole campus network: Cisco-IOS-style CLI, an NMS/SMS/FMS/NAC NOC, VLAN/HSRP/LACP/STP, L4, and NAC. The repo (~/Desktop/khu-dc-game, 15.5k LOC, 283 vitest tests green) has had nothing committed since 10/20. The submission window closes **10/30 17:00**, so we have about 5 working days.

Decided with the user:
- **Core v2 ships by 10/30** and v1 is tagged as a fallback.
- **The UTP crimp game is dropped.** That is what the red "no UTP" note meant.
- **Campus services get KHU-prefixed generic names** ("KHU 포털", "KHU LMS", "KHU 웹메일", "KHU 도서관"). That is what the "KHU" note meant.
- The "GUI" note next to NAC means NAC is a console screen only, with no `nac` terminal commands.

Verified facts about today's code that shape the plan:
- The sim is pure and deterministic: `World` → `step()` → `tickScenarios()` → objectives, all in `src/sim/`.
- **The network model is one flat subnet behind one router.** There is no Port type, VLAN, MAC, or routing between subnets (`src/sim/network.ts`, `crossesRouter`). Everything VLAN/SVI/HSRP/LACP/STP in the doc needs a new network layer. This is the critical path.
- The app/docker/k8s layers (`src/sim/app.ts`, `k8s.ts`, `commands/docker.ts`, `commands/k8s.ts`) barely touch the network model and can be reused almost as-is.
- The command registry matches exact tokens, gated by `minStage`, with no modes or abbreviations (`src/sim/commands/index.ts`). There is no IOS support anywhere.
- The map already has a 전원실 (UPS/PDU spots) and a NOC (monitor wall, desk), so no new rooms are needed for core v2 (`src/game/map.ts`).
- `StageId` (a 0..7 union) is used in about 12 files. Incidents already support `stageStart`, `gate` and `condition` triggers (`src/sim/scenario.ts`).

---

## Where I depart from the doc, and why

1. **Each day starts from a canonical "start-of-day" world, not the player's literal end state.** The doc says progress is continuous. But today each stage's world is built separately (flat net vs MSA vs docker vs k8s), and real carry-over would let one bad day break every later day. With canonical worlds:
   - day select works for free;
   - tests stay per day;
   - the open question "what if missions aren't finished?" goes away: 퇴근 = all missions done + no Critical alarm open, so nothing carries over.

   The story stays continuous through the briefings. The one deliberate carry-over is the unsaved-config consequence (Tier 2, item 14).
2. **The day loads are rebalanced.** D-4 and D-3 in the doc are each a wall of new ideas for beginners, so two topics move:
   - **HSRP moves to D-1.** D-4 builds a single gateway (an SVI on CORE-01 only, which is a single point of failure). D-1 adds the standby on CORE-02, and the D-1 rack fire tests it. The story becomes "build it simple → make it redundant → prove it".
   - **STP/loop moves to D-2, next to LACP.** "Two cables between switches → loop → STP blocks one → LACP uses both" is one lesson.
   - D-3 becomes HTTP + L4 + MSA, plus NAC if Tier 2 lands.
3. **The cores are two independent L3 switches with HSRP, not a stack.** The doc says "코어 L3 ×2 (스택)" and also uses HSRP between the cores, with a `Standby -> Active` log. Stacked members run one control plane and never run HSRP with each other, so the "stack" part has to go.
4. **The IP plan gets two fixes.**
   - **DHCP pools only exist in client VLANs (campus, NOC).** The doc's "/24 rule: .100–.199 = DHCP pool" collides with VLAN 30's VIP at .100. DC server VLANs are static.
   - **Address classes are history only.** The "클래스 A/B/C" framing is 30 years out of date (CIDR replaced it in 1993). Teach "사설 대역 3개 (RFC 1918)" + CIDR /16 and /24, and mention classes in one line of the IP card.
5. **MTTD gets a measurable definition.** "경보 → 첫 조치" is undefined, because nobody can say what counts as an action. Alarms get an **ACK (확인)** button:
   - MTTD = incident start → ACK;
   - MTTR = incident start → resolved.

   Polled metrics (utilization, CRC, temperature) only raise an alarm at the next SNMP poll (every 15 real seconds, see #19), while syslog/trap alarms are instant. This makes the doc's "why did the alarm come late" lesson visible in the number.
6. **Random incidents can't skip the lesson.** If every incident were drawn at random, a player might never see the day's key fault. So each D-5..D-1 day has **1 guaranteed teaching incident** (the one first introduced that day) plus **0–2 seeded extras from earlier days' pools**. The seed is created per save, and tests sweep seeds 1..N.
7. **"담당팀 이관" (escalation) is not a free skip.** It is offered only on shallow alarms (campus services, campus links). It resolves after a fixed delay that counts toward MTTR, which teaches when escalating is the right call.
8. **D-Day macro blocking uses the firewall, not NAC.** The doc's own note is right: outside traffic isn't NAC's job. NAC stays for campus endpoints.
9. **D-Day incidents follow cause and effect instead of a list.**
   - 10:00: the open spike saturates the L4 backend, so the player scales out pods.
   - That scale-out exhausts DB connections (per-pod pool × pods > DB max), which teaches that scaling one tier stresses the next. Fix: lower the pool or raise the DB max.
   - The hot rack's ToR uplink then saturates, and the LACP built on D-2 pays off when the player adds a member.
   - 10:15: macro IPs get a firewall deny rule.

   The device each fault hits is seeded and the times are fixed, as the doc wants.
10. **D-Day time compression varies by phase, not a flat 1:10.** At a flat 1:10, the 10:00–10:05 peak lasts 30 real seconds, which is too short to type IOS commands. Calm phases run fast and the peak slows down, for about 8–10 real minutes in total.
11. **Judges need to reach D-Day in a minute.** Five days of play takes 60–90 min, and judges won't spend that. So the calendar opens every day from the start, and the title screen gets a "D-Day 바로 체험" button. Canonical worlds make this free. This also answers the open question about keeping a replay screen: yes, as "날짜 다시 하기".
12. **IOS abbreviations aren't forced on beginners.** Full and abbreviated forms both work, with `?` and Tab completion. Hints and manuals teach the full form first (`show interfaces status`) and then the short form (`sh int status`). Output keeps the real IOS format but colors err-disabled/down states, so beginners can scan it.
13. **Facilities are monitor-only, as the doc says, without new rooms for now.**
    - The existing 전원실 becomes "전기실 (UPS·분전반)" with read-only gauges, and the 냉각실 is also read-only.
    - EPS, TPS, generator/ATS and the incoming lines appear as FMS tab gauges and concept cards.
    - RepairGame and the UPS plug actions are removed. PowerGame keeps only PDU A/B plugging.
14. **The doc's 설정 저장 checklist gets a consequence (Tier 2, not shipped).** Leaving with an unsaved running-config would start the next morning with "밤사이 재부팅 → 설정 유실". Not built: saving is enforced by the D-4 `wr`, D-2 `lacp` and D-1 `hsrp` missions instead, and the day end lists any gear still unsaved.
15. **LACP never spans the two cores.** A port-channel split across two independent switches needs MLAG/vPC, which the doc assumes without saying so. Every Po runs TOR → one core, and the TOR's path to the other core stays STP-blocked.
16. **The OOB network is modelled as separate, not as VLAN 250 on the data switches.** Data switches carrying VLAN 250 would not be out-of-band. Management IPs are reachable whenever the device has power; "VLAN 250" stays only as the address label.
17. **D-5's CRC incident is diagnosed in the NMS port view (CRC counter, amber/green LED), not with `sh int count err`.** IOS isn't taught until D-4. The doc uses IOS on D-5.
18. **D-4's gateway is single-member HSRP on CORE-01** (`ip address .2` + `standby 1 ip .1`). This keeps ".1 = VIP" true from day one, and `show standby brief` → `Standby: unknown` is the visible single point of failure that D-1 fixes. (No helper: DC VLANs 10/20 are static, departure 4.)
19. **Weekday clock: 1 real s = 30 game s** (09:00 → about 16:30 over a 15-min day; past 18:00 shows "야근"). The SNMP poll interval is set in real seconds (every 15 s; 10 on D-Day), so the polling delay is actually visible. At 1 s = 1 min, a 60-game-second poll would fire every real second and the delay would be invisible.
21. **Campus switches connect to the cores over routed (L3) links, not trunks.** The doc's campus third octet "40 = 본관" would collide with DC VLAN 40 (k8s) on the cores. With routed links, each campus distribution switch is the gateway for its own building subnets (with a DHCP helper to dhcp01), and each VLAN number only means something on its own switch. Each campus switch has one uplink to each core.
20. **D-Day can't soft-lock.** Clearing needs a `hold` objective (clock ≥ 10:30) plus every incident resolved, and overtime runs at the calm rate until then.

## Architecture

### Migration strategy (least churn for parallel agents)
- **Keep the `StageId` type name; it becomes an alias of `DayId = 0..5`, and `DayDef = StageDef` with new fields.** Five agents renaming across 12 files would collide on every merge. User-facing text says D-n everywhere (`DAY_LABEL`).
- **`def.scenarios` becomes a registry** of every incident instance that may appear that day. The run picks a subset via the scheduler, so `run.scenarios` holds only the runtimes that were picked. That way the ~10 existing `def.scenarios.find()` callers keep working.
- Content: `src/content/days/day{0..5}.ts` replace `stages/stage0..7`. Incident templates live in `src/content/incidents/*`, built from the v1 scenario text where possible.
- The `minStage` values are remapped: web/svc → day 2, docker → 3, k8s → 4. v1 `ip set` and `dhcp` are removed.
- The save key moves to `khu-dc-save-v2`.
- v1 tests that drive `startStage(0..7)` move to an excluded `tests/v1/` folder. Expect about 60 tests to survive (audio, store/windows, k8s/docker sim) and about 150 new ones.

### Network v2 (`src/sim/net/*`; `src/sim/network.ts` becomes the facade)
- **Extended, signatures kept:**
  - `Device` widens `kind` (`firewall`, `lb`, `pc`) and gains `nd?: NetDevice` (switches, routers, firewall, L4 only).
  - `Cable` keeps the `"dev:port"` endpoints and gains `degraded?`, which means up, CRC rising, and about 20% loss.
  - `PowerState` gains `racksDown?` (for the fire).
  - `powered`, `cableAt`, `linkUp` and `ping` keep their signatures, so curl/ssh/web/docker/k8s need no rewrite.
  - k8s `updateNodes` takes an "is node online" predicate, so k8s doesn't import the network module.
  - Shared host ids stay unchanged: `ops`, `srv-db`, `srv-new`, `web`, `n1`–`n4`.
- **Replaced:** `NetState` becomes `dns`/`dnsServers`, `dhcp{server, running, pools}`, `clients` (aggregate campus client groups, not individual devices), `fw{rules}`, `lb?{vip, pair, members, health, maxConn}`, plus caches (`hsrpActive`, `load`, `storm`). `World` gains `db?{maxConn}` and `traffic.sources?` (student and macro CIDRs). v1's `applyDhcp` and `crossesRouter` are deleted.
- **`NetDevice`** = `{ os: 'ios'|'lb'|'fw', model, mgmtIp, ifs: Record<'Gi1/0/1'|'Te1/1/1'|'Po1', Iface>, vlans, svis: Record<vlan, {ip, mask, shutdown, helper?, hsrp?}>, stpPriority, stpOff[], dirty, startup, log: SyslogEntry[] }`.
  - `Iface` = `{ shutdown, errDisabled, mode: access|trunk|routed, accessVlan, allowed, ip?, group?, speed, crc, bpduguard? }`.
  - Operational state, STP roles, SVI up and Po membership are **derived on demand, never stored.**
- **Algorithms:**
  - `operState`: power → err-disabled → admin-down → cable/peer.
  - `logicalLinks`: groups Po members; a member configured on one side only is suspended (`s`).
  - Per-VLAN L2 graph.
  - `stpView`: root = lowest priority (cores 4096/8192, aligned with HSRP active); block one end of each non-tree edge. **A storm happens only if neither end of a looping edge runs STP for that VLAN.** That is real PVST behaviour, so the D-2 loop inject disables STP on both ends.
  - `sviUp`: IOS autostate.
  - `electHsrp`: priority, then IP, with preempt memory.
  - `reach(from, dstIp)`: walks host → gateway (HSRP-active core) → destination VLAN; checks the return path, firewall and border routers for external traffic, and returns the links it traversed.
  - `computeLoad`: traffic flows are summed onto the links they cross; `delivery = Π min(1, cap/load)`.
  - `syncNet(w, dt)`: an idempotent pass that emits real-format syslog on state changes (LINK/LINEPROTO UPDOWN, PM-4-ERR_DISABLE, HSRP-5-STATECHANGE, SW_MATM-4-MACFLAP_NOTIF, EC-5-BUNDLE, SYS-5-CONFIG_I), applies bpduguard, increments CRC, and writes the load cache.
  - It runs from `step()` (after k8s and app), after every command or action, and once more after `tickScenarios`.
- **Topology data:** `src/content/topology.ts` = the full D-Day-start network (devices, cables, VLANs, SVIs, IPs, DNS, pools, firewall, L4, `ADDR` table) plus `validateWorld()`. **Each day's world is the full topology minus what hasn't been built yet**: `dayWorld(d) = strip(baseTopology(), d)`. Each content agent owns its own strip functions.
  - TORs are 16-port models, so `show int status` fits on one screen.
  - A spare TOR → core port is pre-cabled for the D-Day LACP fix.

### Engine (`src/sim/{engine,scenario,scheduler,clock,alarms}.ts`)
- **`StageDef` gains:**
  - `label`, `date`
  - `clock: {start, rate, phases?}`
  - `pollEvery`
  - `teaching: {template, trigger}[]` (1–2 per day)
  - `extras: [min, max]` (`[0,0]` on D-5 and D-Day)
  - `mapSwitch?`, `mapDevices?` (CableGame and worldView are hardwired to `sw1` today)
- **`Scenario` gains:**
  - severity `critical|major|minor|warning`
  - `alarm: {source: trap|syslog|poll, device, text}`
  - `escalate?: {delay, fix}` (shallow alarms only)
  - `bannedIos?`
  - `SolutionStep` gains `{ios: string[], host}`, a keystroke script that threads the mode
  - `stageStart` gains `overlap?`, which skips the 10 s breather on D-Day
- **Incident templates:** `IncidentTemplate {id, day, variants, make(v)}` with instance id `tpl:variantIdx`. `allInstances()` gives the worker a finite map. There are at most 16 templates with at most 3 variants each, and variants change parameters only (which port, which VLAN), never text.
- **Scheduler** (`mulberry32(hash(save.seed, day))`):
  - It places the day's teaching incidents plus 0–2 extras. Extras come from earlier days' templates and the same day's non-teaching ones.
  - Each extra is chained as a gate on the previous incident, with a 20–60 s delay, so it can never deadlock `isCleared`.
- **Clock** (pure functions): `gameSec(def.clock, t)`, `stageAt(def.clock, 'HH:MM:SS')`.
  - D-Day phases:

    | Phase | Game time | Real time |
    |---|---|---|
    | precheck | 09:50 → 10:00 | 90 s |
    | open peak | → 10:05 | 210 s |
    | 신청 집중 | → 10:15 | 120 s |
    | macro | → 10:20 | 90 s |
    | calm | → 10:30 | 60 s |

  - Total ≈ 9.5 min.
- **Alarms:** `StageRun` gains `seed` and `alarms: {sev, device, text, source, raisedAt, ackAt, clearedAt}`.
  - Trap and syslog alarms appear on activation; polled ones appear at the next poll boundary.
  - The user complaint (`alert`) can toast before the NMS catches it, so "users noticed first" shows up in MTTD.
  - New engine actions: `ackAlarm`, `escalate`.
  - Toasts are driven by `raised`, not `activated`.
- **Score:**
  - MTTD = (ack ?? resolve) − activation, with low weight (max −10) so spam-ACKing doesn't pay.
  - MTTR is unchanged.
  - `Score` gains `mttd` and `escalated`.
- **New k8s pieces:** `kubectl cordon`/`drain` (about 40 LOC) for the D-1 temperature incident.

### IOS CLI (`src/sim/ios/{parse,tree,config,show,ifname,leak}.ts`)
- **Dispatch:** `runCommand(line, w, host, day, mode?)` sends `os === 'ios'` hosts to `runIos`. Other hosts use the existing registry, filtered by `Command.os`. The terminal session gains `mode`. `ssh CORE-01` or `ssh 10.10.250.21` from the 관리 PC enters `CORE-01>`.
- **Parser:**
  - It works per token: exact keyword → unique prefix → `% Ambiguous command: "..."` → typed arg nodes (`ifname` accepts `gi 1/0/5`) → `% Invalid input detected at '^' marker.` with the caret at the right column → `% Incomplete command.`
  - It supports `no`, `do`, and falling back from config-if to config level, as real IOS does.
  - Hidden decoy keywords make bare `s` ambiguous while `sh` still resolves.
  - Ctrl+Z = `end`.
  - `?` is caught per keystroke in `Terminal.tsx`, and Tab completes a unique prefix.
  - The side panel shows a mode-aware cheat sheet with Korean glosses (`ko` field on each node).
- **Tier 1 command set (capped):**
  - Exec: `enable`, `exit`, `configure terminal`, `write memory` / `wr` / `copy run start`, `ping`.
  - Show: `interfaces [if]`, `ip interface brief`, `interfaces status`, `interfaces counters errors`, `vlan brief`, `etherchannel summary`, `standby brief`, `spanning-tree [vlan N]`, `logging`, `running-config`.
  - Config: `interface X`, `vlan N`, `name`, `[no] shutdown`, `switchport mode access|trunk`, `switchport access vlan N`, `switchport trunk allowed vlan`, `channel-group N mode active`, `ip address`, `standby 1 ip|priority|preempt`, `ip helper-address`, `[no] spanning-tree vlan N`, `end`.
  - Config changes mark the device dirty and log `%SYS-5-CONFIG_I`.
  - Output follows real IOS layouts, with down/err-disabled in red and up in green.
  - *Tier 2:* `mac address-table`, `cdp neighbors`, `ip route`, `interface range`, `interfaces trunk`.
- **Other CLIs** (existing registry, `os`-tagged):
  - L4: `lb status|pool|health|health set path|port|sessions`.
  - Firewall: `fw rules|top|deny <cidr>|del <seq>`. `top` lists top talkers, a stand-in for NetFlow.
  - dhcp01: `dhcp pool list|show|set <pool> range A B`.
  - ns1: `dns list|add|del`.
- **Syslog limit:** the terminal can't print asynchronously, so logs appear after each command, in `show logging`, and in the NMS syslog view.

### UI
- **NOC console:** `src/ui/noc/`, opened by the monitor spot, the N key, or Tab. It has four tabs:
  - **NMS:** a fixed-coordinate SVG of the doc's tree. Links are colored by utilization or state (green/yellow/red/grey). Clicking a device shows its ports, CRC counters and syslog, with an "SSH" button that opens the terminal at `DEV>`. A unified alarm list sorted by severity has ACK, "쿠사수에게 묻기" and, on shallow alarms, "담당팀 이관".
  - **SMS:** today's `Dashboard` panels (services, pods, traffic) plus DHCP pool usage, DNS status, and the KHU 포털/LMS/웹메일/도서관 response times.
  - **FMS:** read-only. UPS load and battery, PDU A/B current, generator standby, rack temperature and humidity, incoming lines. Its only button is "시설팀 통보" (ACK).
  - **NAC:** Tier 2.
- **ObjectivePanel:** shows missions only, plus an alarm chip ("경보 2 · Critical 1 → N"). The chip names no cause and no room.
- **HUD:** `D-4 · 14:32`, or `10:03:17` on D-Day.
- **Calendar** replaces StageSelect. Every day is open, each with a "다시 하기" option.
- **Title screen:** 새로 시작 / 이어하기 / **D-Day 바로 체험**.
- **Results → 일일 리포트:** availability, MTTD, MTTR, missions, incidents, escalations, stars, and a preview of tomorrow.
- **Map:** relabels only.
  - The 네트워크실 spots become BR/FW/CORE.
  - The racks become ToR plus servers.
  - 전원실 becomes 전기실 (read-only gauges, plus PDU).
  - The 냉각실 becomes read-only.
  - The NOC monitor opens the NOC console.
  - RepairGame is removed. PowerGame becomes A/B only. CableGame and worldView use `def.mapSwitch` (TOR-01).

### Day content (reusing v1 content where marked)

| Day | Missions | Teaching incidents | Extras pool adds |
|---|---|---|---|
| D-5 물리 (v1 s0+s1) | tour, rack mount, PDU A/B, cable to TOR-01, check LEDs, look at FMS | degraded cable → CRC (found in the NMS port view, fixed by swapping the cable) | – |
| D-4 네트워크 (v1 s2 + new) | SSH to TOR over OOB, create VLANs 10/20/40, assign access ports, CORE-01 SVI + `standby 1 ip .1` + helper, DHCP pool, DNS records, `wr` | VLAN misassignment; DHCP exhaustion | DNS record (v1 s2-dns), err-disabled bpduguard, SVI shutdown |
| D-3 서비스 오픈 (v1 s3+s4) | start the web server and fix its port, curl, L4 VIP + pool + health check, monolith → MSA (DecomposeBoard) | L4 health check (path or port) | core uplink down, v1 s3-404 / s4-notify, campus service slow (escalate) |
| D-2 컨테이너·링크 (v1 s5) | Dockerfile, build, push, run with `-p` and a volume; second TOR → CORE-01 uplink + `channel-group 1 mode active` on both ends | uplink saturation (load test → LACP); loop/storm (STP off both ends) | deploy bug → rollback, v1 s5-volume |
| D-1 이중화 (v1 s6) | k8s desired state with replicas ≥ 2, CORE-02 SVI + HSRP priority/preempt, redundancy checklist (`sh standby br`, `sh eth sum`, PSU A/B) | rack temperature → `kubectl drain` + 시설팀 통보; rack fire → HSRP failover check | v1 s6-rollout, s6-ip |
| D-Day (v1 s7) | `hold` until 10:30, postmortem board | timeline in departure #9 above. DB exhaustion is a `condition` trigger with guaranteed numbers (12 pods × DB_POOL 20 > 200), fixed with `env set enroll DB_POOL=10` (existing command). | – |

Writing rules (from memory, for a general audience):
- Alerts describe symptoms only.
- Hints point to what to observe and never give the answer.
- Glosses are in plain words.
- No course or class wording.
- Each day gets a manual (`src/content/manual/day{0..5}.md`).
- New concept cards: vlan, l2l3, ios, syslog, hsrp, oob, l4, health check, stp, lacp, oversubscription, nms/polling, mttd, escalation, ups·eps·tps, private ranges.

### AI worker
- `bannedFor`/`leaks` move to `src/ai/leak.ts`, which the worker imports.
- IOS solution lines that carry a VLAN, IP or interface are banned in every abbreviated form, via `iosVariantsRegex`. Interface names count as banned values.
- Pure navigation (`enable`, `conf t`, `wr`) isn't banned.
- `MANUALS` is indexed by day, and scenarios come from `allInstances()`.

## Schedule (agents run in parallel git worktrees after WP0)

| When | Work |
|---|---|
| 10/25 eve → 10/26 AM | **WP0 contract (me, sequential):** `git tag v1` and branch `v2`; all types; `topology.ts` + `validateWorld`; stub implementations of every signature; autoplay helper with IOS steps; `days.test.ts` skeleton; v1 tests moved to `tests/v1/`. |
| 10/26 → 10/27 | **Parallel:** **WP1** network core + tests (~1.6k LOC) · **WP2** IOS + lb/fw/dhcp/dns CLIs + tests (~1.8k) · **WP3** engine/scheduler/clock/alarms/store/Terminal/HUD/worker leak (~1k) · **WP4** NOC console, calendar, report, title, map relabel (~1.2k) · **WP5** content D-5/D-4/D-3 (writing against stubs, checked against real code once WP1/WP2 land). |
| 10/27 PM → 10/28 | **WP6** D-2/D-1 content (WP1/WP2 owners) · **WP7** D-Day timeline (WP3 owner) · **WP8** integration: seed sweep green, e2e, D-Day balance. |
| **10/28 evening** | **Go/no-go.** v2 needs every day clearable on seeds 1–12, e2e green, and no console errors. If it isn't ready, submit the `v1` tag and keep v2 for the 11/10 finals. |
| 10/29 | Tier 2 only if green, a manual QA playthrough, manuals and AI hint check, README and screenshots. |
| 10/30 AM | Freeze → `npm run build` → Cloudflare deploy → smoke test on the deployed URL → submit before 17:00. |

**Items only the user can do (submission blockers, independent of v2):**
- **ChatKHU API key:** `worker/.dev.vars` doesn't exist, and ChatKHU use is mandatory.
- Confirm the deadline from the official notice. My dates came from another team's notes.
- AI-usage form (서식4).
- Share the departures above with 남궁호민 so the doc and the game agree.

## Verification
- `npm test`:
  - `tests/net2.test.ts`:
    - VLAN, trunk and inter-VLAN reachability;
    - SVI shutdown → gateway failure;
    - HSRP failover, with and without preempt;
    - parallel uplinks without LACP → one blocked port and util 150%;
    - Po → 2G capacity;
    - a one-sided group → `s`;
    - storm only when STP is off on both ends, and recovery;
    - bpduguard;
    - degraded cable → CRC;
    - firewall deny on the macro CIDR only;
    - DHCP exhaustion, range widening and a missing helper;
    - `validateWorld(dayWorld(d))` for every day.
  - `tests/ios.test.ts` (table-driven):
    - abbreviations and `gi 1/0/5`;
    - ambiguous `s`, caret column, incomplete commands;
    - `?` and Tab;
    - prompt and exit/end/Ctrl+Z chain;
    - `do`, and falling back from config-if;
    - dirty → `wr` ≡ `copy run start`;
    - snapshots of every show command.
  - `tests/days.test.ts`, **days 0–5 × seeds 1–12**:
    - autoplay the missions;
    - ACK each alarm 2 s after it appears and solve it 2 s later;
    - assert every incident is broken at activation and resolved, polled alarms land on poll boundaries, no red output, and `isCleared`.
  - Template matrix: each template × variant × every later day → inject, broken, solution, fixed.
  - Scheduler, clock and alarm tests:
    - same seed → same plan;
    - seeds 1–200 cover every template;
    - D-Day real-time total ≈ 9.5 min.
  - Leak guard: abbreviated IOS answers are caught, and generic Korean hints pass.
- `npm run typecheck && npm run typecheck:worker && npm run build`.
- `npx playwright test`:
  - smoke: D-5 start and "D-Day 바로 체험";
  - `full.spec`: a loop over all days on seed 1 with screenshots;
  - no console errors.
- Manual pass:
  - play D-4 and D-Day by hand in `npm run dev`;
  - with `npm run dev:worker` and a ChatKHU key, ask 쿠사수 about one IOS incident and confirm the answer isn't leaked.

## Scope

**Tier 1 — must ship 10/30**
- Day progression (D-5..D-Day), calendar and daily report, game clock in the HUD, seeded incident scheduler, D-Day real-time mode.
- Network v2 model: interfaces, VLAN, SVI+HSRP, port-channel/LACP, STP storm, CRC, utilization, syslog, firewall rules, L4, DHCP pools.
- IOS CLI: modes, abbreviations, `?`, real error strings.
- A small L4 CLI and the firewall rule command.
- NOC console:
  - NMS: SVG topology with link colors, alarm list with ACK, syslog, SSH button;
  - SMS: the current Dashboard plus DHCP/DNS and campus services with escalation;
  - FMS: read-only.
- Content for 6 days: missions, incidents, briefings, manuals, new concept cards. Existing stage 1–7 content is reused inside them.
- AI worker manuals for each day, with the leak guard covering IOS forms.
- Tests: network v2 unit tests, IOS parser tests, a per-day autoplay seed sweep, and updated e2e smoke + full run.

**Tier 2 — only if Tier 1 is green by 10/28 evening**
- NAC console GUI and the D-3 NAC incident.
- Unsaved-config carry-over.
- SwitchPanel: front LEDs, back PSU A/B.
- A 퇴근 checklist screen. Until then the checklist is just gated objectives.

**Cut (finals or later)**
- UTP crimp game.
- New EPS/TPS rooms and a pixel-art overhaul.
- `nac` terminal commands.
- NetFlow views beyond a "top talkers" list on the macro alarm.
