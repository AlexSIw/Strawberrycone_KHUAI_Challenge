import type { IosMode, StageId, World } from '../types';

/** What kind of CLI a host speaks: a Linux shell, Cisco-IOS-style, the L4's CLI, or the firewall's. */
export type HostOs = 'linux' | 'ios' | 'lb' | 'fw';

export interface CmdCtx {
  /** Mutable copy of the world; changes are kept when the command returns */
  w: World;
  /** Device the terminal is attached to ('ops' is the NOC admin PC) */
  host: string;
  stage: StageId;
  /** IOS mode of the session (network gear only) */
  mode?: IosMode | null;
}

export interface CmdResult {
  lines: string[];
  /** New host after ssh / exit */
  host?: string;
  /** Events for objectives/scenarios, e.g. "dhcp_enabled" */
  events?: string[];
  clear?: boolean;
  /** The player typed `hint`: 쿠사수 answers in the terminal (the store asks, the answer comes later) */
  hint?: boolean;
  /** IOS mode after the line: ssh into a switch sets { level: 'user' }; leaving it sets null */
  mode?: IosMode | null;
}

export interface Command {
  /** Command words, e.g. "ip addr" or "docker run" */
  name: string;
  aliases?: string[];
  minStage: StageId;
  /** Hosts whose CLI has this command (default ['linux']) */
  os?: HostOs[];
  /** Last stage where the command makes sense (defaults to forever) */
  maxStage?: StageId;
  usage: string;
  summary: string;
  run(args: string[], ctx: CmdCtx): CmdResult;
}

export const out = (...lines: string[]): CmdResult => ({ lines });
export const err = (msg: string): CmdResult => ({ lines: [`\x1b[31m${msg}\x1b[0m`] });
export const ok = (msg: string): CmdResult => ({ lines: [`\x1b[32m${msg}\x1b[0m`] });
export const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
