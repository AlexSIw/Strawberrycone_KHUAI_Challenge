// D-3: 서비스 오픈. WP5 owns this file (missions, briefing, unbuild/setup, health).
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK, PLACEHOLDER } from './common';

export const day2: DaySpec = {
  id: 2,
  label: 'D-3',
  date: '02-07',
  clock: WEEKDAY_CLOCK,
  fixed: [],
  extras: [1, 2],
  title: '서비스 오픈',
  subtitle: 'HTTP · L4 · MSA',
  topics: ['포트·TCP·HTTP', 'L4 로드밸런서와 헬스체크', '모놀리스 vs MSA'],
  intro: [{ who: 'boss', text: '수강신청 웹 서비스를 열고, L4 뒤에 세우는 날이에요.' }],
  outro: [{ who: 'lion', text: '오늘 일 끝! 퇴근합니다.', mood: 'happy' }],
  objectives: [PLACEHOLDER],
  interactions: { ...BASE_INTERACTIONS },
  health: (w) => emptyHealth(w),
  panels: ['traffic'],
};
