// D-Day: 수강신청 당일. WP7 owns this file (missions, briefing, unbuild/setup, health).
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, DDAY_CLOCK, PLACEHOLDER } from './common';

export const day5: DaySpec = {
  id: 5,
  label: 'D-Day',
  date: '02-10',
  clock: DDAY_CLOCK,
  fixed: [],
  extras: [0, 0],
  title: '수강신청 당일',
  subtitle: '10:00 오픈 · 실시간 관제',
  topics: ['접속 대기열과 트래픽 피크', '장애 우선순위(triage)', 'MTTD · MTTR', '장애 보고서'],
  intro: [{ who: 'boss', text: '오늘은 만들지 않아요. 지켜보고, 터지면 막아요.' }],
  outro: [{ who: 'lion', text: '오늘 일 끝! 퇴근합니다.', mood: 'happy' }],
  objectives: [PLACEHOLDER],
  interactions: { ...BASE_INTERACTIONS },
  health: (w) => emptyHealth(w),
  panels: ['traffic'],
};
