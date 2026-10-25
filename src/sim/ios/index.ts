// Cisco-IOS-style CLI for switches and routers (CORE-01#, TOR-01(config-if)# …).
// Parser: per token, exact keyword → unique prefix → "% Ambiguous command" → typed arguments →
// "% Invalid input detected at '^' marker." / "% Incomplete command.". `no`, `do`, Ctrl+Z, `?`, Tab.
// WP2 owns src/sim/ios/*. This file is the contract the terminal, the command layer and the AI leak
// guard build against.
import type { DayId, IosLevel, IosMode, World } from '../types';
import { own } from '../util';

export type { IosLevel, IosMode };

export interface IosResult {
  /** Output. Error lines (the ones starting with '%') are wrapped in red (\x1b[31m…\x1b[0m) like the shell's errors. */
  lines: string[];
  /** Mode after the line. null = the session left the device (exit / logout at exec on an ssh session). */
  mode: IosMode | null;
  /** Events for objectives/scenarios, e.g. 'ios:vlan:TOR-01:10', 'ios:wr:CORE-01' */
  events: string[];
  /** The fully expanded command (`sh ip int br` → 'show ip interface brief'), null if it didn't parse */
  canonical: string | null;
}

export const USER_MODE: IosMode = { level: 'user' };

/**
 * Run one line on network device `host` in `mode`. Mutates `w` (the caller passes a copy).
 * Config changes set nd.dirty and log %SYS-5-CONFIG_I when leaving config mode.
 */
export function runIos(line: string, _w: World, _host: string, mode: IosMode, _day: DayId): IosResult {
  // TODO(WP2)
  const t = line.trim();
  if (!t) return { lines: [], mode, events: [], canonical: null };
  if (t === 'en' || t === 'enable') return { lines: [], mode: { level: 'exec' }, events: [], canonical: 'enable' };
  if (t === 'exit' || t === 'logout') return { lines: [], mode: mode.level === 'user' || mode.level === 'exec' ? null : { level: 'exec' }, events: [], canonical: 'exit' };
  return { lines: ['% Invalid input detected at \'^\' marker.'], mode, events: [], canonical: null };
}

/** `?` help for the half-typed line: one entry per keyword/argument, e.g. '  interfaces    Interface status and configuration'. */
export function iosHelp(_w: World, _host: string, _mode: IosMode, _partial: string): string[] {
  // TODO(WP2)
  return [];
}

/** Tab completion: the line with its last word completed (plus a space), or null when not unique. */
export function iosComplete(_w: World, _host: string, _mode: IosMode, _partial: string): string | null {
  // TODO(WP2)
  return null;
}

const SUFFIX: Record<IosLevel, string> = {
  user: '>',
  exec: '#',
  config: '(config)#',
  'config-if': '(config-if)#',
  'config-vlan': '(config-vlan)#',
};

/** 'CORE-01(config-if)#' */
export function iosPrompt(w: World, host: string, mode: IosMode): string {
  const name = own(w.devices, host)?.label ?? host;
  return `${name}${SUFFIX[mode.level]}`;
}

/** Fully expand a line typed at `level`, or null if it doesn't parse ('sw acc vl 20' → 'switchport access vlan 20'). */
export function canonicalize(_line: string, _level: IosLevel): string | null {
  // TODO(WP2)
  return null;
}

/** A regex matching every way a player (or the AI) could type this canonical line: each keyword from its shortest unique prefix, interface names in any form. For the hint leak guard. */
export function iosVariantsRegex(canonical: string, _level: IosLevel): RegExp {
  // TODO(WP2)
  return new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** Mode-aware cheat sheet for the terminal side panel: [command, Korean gloss]. */
export function iosCheatSheet(_mode: IosMode): [string, string][] {
  // TODO(WP2)
  return [];
}
