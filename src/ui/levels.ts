// One set of good / warning / bad cut-offs, shared by the HUD, the dashboard and the results screen,
// so the same number never gets two different colors.

export type Level = 'ok' | 'warn' | 'bad';

/** Availability as a 0–1 share of successful requests. */
export const availLevel = (v: number): Level => (v >= 0.99 ? 'ok' : v >= 0.9 ? 'warn' : 'bad');

/** Response time in milliseconds. */
export const latencyLevel = (ms: number): Level => (ms < 300 ? 'ok' : ms < 1000 ? 'warn' : 'bad');
