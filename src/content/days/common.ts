import type { ClockDef } from '../../sim/clock';
import type { InteractionKind, Objective, SpotId } from '../types';

/** Weekdays: 09:00 출근, 1 real second = 30 game seconds (a 15-minute day ends around 16:30). */
export const WEEKDAY_CLOCK: ClockDef = { start: '09:00:00', rate: 30 };

/**
 * D-Day: fast through the pre-check, slow through the peak, about 9.5 real minutes to 10:30.
 * After 10:30 (overtime until everything is fixed) it keeps the calm rate.
 */
export const DDAY_CLOCK: ClockDef = {
  start: '09:50:00',
  rate: 10,
  phases: [
    { until: '10:00:00', realS: 90 },
    { until: '10:05:00', realS: 210 },
    { until: '10:15:00', realS: 120 },
    { until: '10:20:00', realS: 90 },
    { until: '10:30:00', realS: 60 },
  ],
};

export const ROOMS = ['server', 'network', 'power', 'cooling', 'noc'] as const;

/**
 * Spots every day has: the NOC console on the monitor wall, the 관리 PC, the mentor, the facility gauges,
 * and the cable check at the network-room switch (cable incidents such as d5-crc / d3-uplink can be
 * drawn on any later day, and this is where their cables are tested and replaced).
 */
export const BASE_INTERACTIONS: Partial<Record<SpotId, InteractionKind>> = {
  monitor: { kind: 'noc' },
  desk: { kind: 'terminal' },
  mentor: { kind: 'mentor' },
  ups: { kind: 'gauge', target: 'ups' },
  pdu: { kind: 'gauge', target: 'pdu' },
  crac: { kind: 'gauge', target: 'crac' },
  switch: { kind: 'cable', mode: 'repair' },
};

/** Placeholder mission until the day's content lands. */
export const PLACEHOLDER: Objective = {
  id: 'noc',
  text: '관제실 모니터(관제 화면) 켜보기',
  spot: 'monitor',
  done: (_w, c) => c.events.includes('open:noc'),
};
