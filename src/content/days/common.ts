import type { ClockDef } from '../../sim/clock';
import type { InteractionKind, Objective, SpotId } from '../types';

/**
 * The last mission of D-5 … D-1: the 퇴근 퀴즈 at the 설계 보드 (the board opens it while this is on the list).
 * It shows up once every other mission is done and every incident is settled; it awards no card of its own
 * (the missions it reviews already did).
 */
export const QUIZ_OBJECTIVE: Objective = {
  id: 'quiz',
  text: '관제실 설계 보드에서 퇴근 전 복습 퀴즈 풀기 (3문제를 한 번에 다 맞히기)',
  why: '오늘 직접 해 본 일을 세 문제로 확인해요. 틀리면 해설을 보고 새로 뽑은 문제로 처음부터 다시 풀고, 세 문제를 한 번에 다 맞히면 퇴근이에요. 헷갈리면 도감(C)에서 오늘 받은 카드를 다시 읽어 봐요.',
  spot: 'board',
  finale: true,
  done: (_w, c) => c.events.includes('quiz:correct'),
};

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
