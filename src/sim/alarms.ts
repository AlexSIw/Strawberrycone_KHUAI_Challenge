// NOC alarm list. An incident becomes an alarm when the monitoring system notices it:
// traps and syslog at once, polled metrics only at the next SNMP poll. The player acknowledges (ACK)
// alarms; MTTD is measured to that moment.
import type { AlarmSev, Scenario, ScenarioRuntime } from './scenario';

export interface Alarm {
  /** Same as the scenario id for incident alarms */
  id: string;
  scenarioId: string | null;
  sev: AlarmSev;
  /** Device id the NMS pins it on */
  device: string;
  text: string;
  source: 'trap' | 'syslog' | 'poll';
  raisedAt: number;
  ackAt: number | null;
  clearedAt: number | null;
}

/** Default seconds between SNMP polls (day time). */
export const POLL_EVERY = 15;

/** The first poll at or after `t`. */
export const nextPoll = (t: number, every: number): number => Math.ceil(t / every) * every;

export const SEV_ORDER: Record<AlarmSev, number> = { critical: 0, major: 1, minor: 2, warning: 3 };

/**
 * Raise alarms for incidents the monitoring has noticed and clear those whose incident is fixed.
 * Pure: returns the new list and the ids raised this tick.
 */
export function updateAlarms(
  alarms: Alarm[],
  rt: ScenarioRuntime[],
  registry: (id: string) => Scenario,
  t: number,
  pollEvery = POLL_EVERY,
): { alarms: Alarm[]; raised: string[] } {
  const next = alarms.map((a) => ({ ...a }));
  const byId = new Map(next.map((a) => [a.id, a]));
  const raised: string[] = [];
  for (const r of rt) {
    if (r.activatedAt === null) continue;
    const sc = registry(r.id);
    const polled = sc.alarm.source === 'poll';
    let a = byId.get(r.id);
    if (!a && (r.state === 'active' || r.state === 'resolved')) {
      const seenAt = polled ? nextPoll(r.activatedAt, pollEvery) : r.activatedAt;
      // Fixed before the poll ever saw it: the NMS never knew.
      if (r.state === 'resolved' && r.resolvedAt !== null && r.resolvedAt < seenAt) continue;
      if (t >= seenAt) {
        a = { id: r.id, scenarioId: r.id, sev: sc.severity, device: sc.alarm.device, text: sc.alarm.text, source: sc.alarm.source, raisedAt: seenAt, ackAt: null, clearedAt: null };
        next.push(a);
        byId.set(a.id, a);
        raised.push(a.id);
      }
    }
    if (a && a.clearedAt === null && r.state === 'resolved' && r.resolvedAt !== null) {
      const clearAt = polled ? nextPoll(r.resolvedAt, pollEvery) : r.resolvedAt;
      if (t >= clearAt) a.clearedAt = clearAt;
    }
  }
  return { alarms: next, raised };
}

/** Open (not cleared) alarms, worst first, newest first within a severity. */
export function openAlarms(alarms: Alarm[]): Alarm[] {
  return alarms.filter((a) => a.clearedAt === null).sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || b.raisedAt - a.raisedAt);
}
