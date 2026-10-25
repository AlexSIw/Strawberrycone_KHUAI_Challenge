// D-1: 점검 · 이중화. WP6 owns this file (missions, briefing, unbuild/setup, health).
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK, PLACEHOLDER } from './common';

export const day4: DaySpec = {
  id: 4,
  label: 'D-1',
  date: '02-09',
  clock: WEEKDAY_CLOCK,
  fixed: [],
  extras: [1, 2],
  title: '점검 · 이중화',
  subtitle: 'k8s · HSRP · 화재 훈련',
  topics: ['k8s Pod · Self-healing · Scale-out', '이중화와 HSRP', '냉각과 랙 온도'],
  intro: [{ who: 'boss', text: '쿠버네티스로 옮기고, 하나가 죽어도 버티게 만드는 날이에요.' }],
  outro: [{ who: 'lion', text: '오늘 일 끝! 퇴근합니다.', mood: 'happy' }],
  objectives: [PLACEHOLDER],
  interactions: { ...BASE_INTERACTIONS },
  health: (w) => emptyHealth(w),
  panels: ['traffic'],
};
