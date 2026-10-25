// D-5: 물리 구축. WP5 owns this file (missions, briefing, unbuild/setup, health).
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK, PLACEHOLDER } from './common';

export const day0: DaySpec = {
  id: 0,
  label: 'D-5',
  date: '02-05',
  clock: WEEKDAY_CLOCK,
  fixed: [],
  extras: [0, 0],
  title: '물리 구축',
  subtitle: '랙 · 전원 A/B · 배선',
  topics: ['데이터센터와 정보전산 조직', '랙과 전원 A/B', '케이블과 포트 LED', '시설 구성(UPS·발전기·냉각)'],
  intro: [{ who: 'boss', text: '서버를 랙에 달고, 전원 A/B와 케이블을 꽂는 날이에요.' }],
  outro: [{ who: 'lion', text: '오늘 일 끝! 퇴근합니다.', mood: 'happy' }],
  objectives: [PLACEHOLDER],
  interactions: { ...BASE_INTERACTIONS },
  health: (w) => emptyHealth(w),
  panels: ['traffic'],
};
