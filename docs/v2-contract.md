# v2 contract — who owns what, and the names everyone shares

Read with `docs/v2-plan.md` (the why). The types are the source of truth: `src/sim/types.ts`,
`src/sim/scenario.ts`, `src/content/types.ts`, `src/content/topology.ts`. Stubs marked `TODO(WPn)` are
the real work.

## File ownership

Only edit files your package owns. If you truly must touch another package's file, keep it to the
smallest possible change and list it in your final report.

| Package | Owns |
|---|---|
| WP1 network core | `src/sim/net/{topo,stp,hsrp,reach,load,services,sync}.ts`, `src/sim/network.ts`, `src/sim/step.ts`, `src/sim/k8s.ts` (online predicate, cordon/drain), `src/sim/commands/net.ts` (ping, traceroute, nslookup, ssh, exit, ip addr, hostname, **dns list/add/del**), `src/sim/commands/web.ts` (curl via `listening`), `src/sim/commands/k8s.ts` (cordon/drain/uncordon only), `tests/net2.test.ts` |
| WP2 IOS + appliance CLIs | `src/sim/ios/*`, `src/sim/commands/index.ts`, new `src/sim/commands/infra.ts` (dhcp pool / lb / fw), `tests/ios.test.ts`, `tests/infra.test.ts` |
| WP3 engine/store/terminal/AI | `src/sim/engine.ts`, `src/sim/{scenario,scheduler,clock,alarms}.ts`, `src/store/game.ts`, `src/ui/Terminal.tsx`, `src/ui/HintChat.tsx`, `src/ai/*`, `worker/*`, `tests/core.test.ts`, `tests/store.test.ts`, `tests/leak.test.ts`, `e2e/ui.spec.ts`, `e2e/persist.spec.ts`, `e2e/audio.spec.ts` |
| WP4 UI + map | `src/ui/noc/*` (new), `src/ui/{ModalHost,Hud,ObjectivePanel,Results,TitleScreen,Ending,Toasts,Dashboard}.tsx`, `src/ui/Calendar.tsx` (replaces `StageSelect.tsx`), `src/ui/minigames/*`, `src/ui/boards/*`, `src/game/*`, `src/App.tsx`, `e2e/smoke.spec.ts` |
| WP5 content D-5, D-4, D-3 | `src/content/days/day{0,1,2}.ts`, `src/content/incidents/{d5,d4,d3}.ts`, `src/content/manual/day{0,1,2}.md`, its rows in `tests/autoplay.ts` `AUTOPLAY`, new concept cards in `src/content/concepts.ts` (append only) |
| WP6 content D-2, D-1 | `src/content/days/day{3,4}.ts`, `src/content/incidents/{d2,d1}.ts`, `src/content/manual/day{3,4}.md`, its `AUTOPLAY` rows, concept cards (append only) |
| WP7 D-Day | `src/content/days/day5.ts`, `src/content/incidents/dday.ts`, `src/content/manual/day5.md`, its `AUTOPLAY` rows |
| lead | `src/sim/types.ts`, `src/content/{types,topology,stages/index}.ts`, `src/content/days/{index,common}.ts`, `src/content/incidents/index.ts`, `tests/autoplay.ts` (helpers), `tests/days.test.ts`, `docs/*` |

Need a new field on a lead-owned type? Add it (optional, with a doc comment) and list it in your report.

## Hosts and their CLIs

| Host | Device id(s) | CLI | Reached by |
|---|---|---|---|
| 관리 PC | `ops` | Linux shell | NOC desk (the terminal opens here) |
| Switches / routers | `CORE-01/02`, `TOR-01/02`, `BR-01/02`, `CAMPUS-ENG/LIB/MAIN` | IOS (`runIos`) | `ssh CORE-01` / `ssh 10.10.250.21` from ops; rack/console spots |
| L4 | `L4-01`, `L4-02` | `lb …` (os `lb`) | `ssh L4-01` |
| Firewall | `FW-01`, `FW-02` | `fw …` (os `fw`) | `ssh FW-01` |
| DHCP server | `dhcp01` | Linux + `dhcp …` | `ssh dhcp01` |
| DNS servers | `ns1`, `ns2` | Linux + `dns …` | `ssh ns1` |
| Servers / k8s nodes | `web`, `web2`, `db`, `srv-new`, `srv-db`, `n1`–`n4` | Linux (+ server / docker / kubectl as today) | `ssh <id>` |

DNS names resolve case-insensitively. Every gear name resolves to its management IP.

## Command syntax (exact; content and hints use these)

**Shell (WP1, `commands/net.ts`, every Linux host from D-4):**
`ping <name|ip>`, `traceroute <name|ip>` (alias `trace`), `nslookup <name>`, `ssh <name|ip>`, `exit`,
`ip addr`, `hostname`.

**DNS (WP1, on `ns1`/`ns2` only):** `dns list`, `dns add <name> <ip>`, `dns del <name>`.

**DHCP (WP2, on `dhcp01` only):**
- `dhcp pool list` lists pools with size/used/free/stale/starving;
- `dhcp pool show <pool>`;
- `dhcp pool set <pool> range <a.b.c.start> <a.b.c.end>`;
- `dhcp leases <pool>`;
- `dhcp leases clear <pool>` reclaims stale leases.

**L4 (WP2, on `L4-01`/`L4-02`):**
- `lb status` shows the VIP, the active unit, sessions/max;
- `lb pool` shows members and their health;
- `lb pool add <host> <port>`, `lb pool del <host>`, `lb pool enable|disable <host>`;
- `lb health` shows the check;
- `lb health set path <path>`, `lb health set port <port>`.

**Firewall (WP2, on `FW-01`/`FW-02`; both share `w.net.fw.rules`):**
- `fw rules`;
- `fw top` lists top talkers by source address;
- `fw deny <cidr> [port]` and `fw permit <cidr> [port]` add a rule at the front;
- `fw del <seq>`.

**IOS (WP2):** the Tier 1 set in docs/v2-plan.md → "IOS CLI". Error lines start with `%` and are wrapped in red.

**Existing, reused:** `server …`, `curl …`, `notice …` (D-3), `svc …` (D-3), `docker …` (D-2), `kubectl` /
`k` / bare (`get pods`, `scale`, `rollout undo`, `env set`, `logs` …) (D-1+), plus WP1's
`kubectl cordon|uncordon|drain <node>`.

## Event names objectives can listen for

- `open:<modal type>`: `open:noc`, `open:terminal`, `open:gauge`, `open:mentor`, `open:cable` …
- `noc:<tab>` when a NOC tab is shown (`noc:nms`, `noc:sms`, `noc:fms`); `noc:device:<id>` when a device is opened in the NMS.
- `ssh:<deviceId>`.
- `ios:<deviceId>:<canonical command>` for every IOS line that parses (e.g. `ios:TOR-01:show vlan brief`).
- `room:<room>`, `interact:<spot>`.
- **Prefer world-state checks over events** for build missions (e.g. `TOR-01 Gi1/0/1 accessVlan === 10`). They hold however the player got there.

## Writing rules (players are the general public)

- Alerts and alarm text describe symptoms only, never the cause.
- Hints go observation question → direction → kind of tool. They never contain the command, value, IP, port or interface.
- Jargon gets a plain-Korean gloss the first time it appears. No course, lecture or class wording.
- Campus services: KHU 포털, KHU LMS, KHU 웹메일, KHU 도서관 (generic, KHU-prefixed).
- Fictional device models only (KHU-SW9300 …). Real products appear only in concept cards ("실제로는 Cisco Catalyst 9300 같은 장비").
- Incidents are symptom-based and checked by observable state (`reach`, `delivery`, `dhcpView`, `lbView`, health), not by a flag the solution sets.

## Done means

`npx tsc --noEmit -p .` is clean, `npx vitest run` is green (tests depending on another package's stubs
may be marked `it.todo` with a note), and the work is committed on your branch:
`v2 WPn: <summary>` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
