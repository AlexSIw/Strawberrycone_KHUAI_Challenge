// D-2: 컨테이너 · 링크. WP6 owns this file (missions, briefing, unbuild/setup, health).
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK, PLACEHOLDER } from './common';

export const day3: DaySpec = {
  id: 3,
  label: 'D-2',
  date: '02-08',
  clock: WEEKDAY_CLOCK,
  fixed: [],
  extras: [1, 2],
  title: '컨테이너 · 링크',
  subtitle: 'Docker · LACP · STP',
  topics: ['컨테이너와 이미지', '업링크와 오버서브스크립션', 'LACP', 'STP와 루프'],
  intro: [{ who: 'boss', text: '컨테이너로 배포하고, 업링크를 묶어서 넓히는 날이에요.' }],
  outro: [{ who: 'lion', text: '오늘 일 끝! 퇴근합니다.', mood: 'happy' }],
  objectives: [PLACEHOLDER],
  interactions: { ...BASE_INTERACTIONS },
  health: (w) => emptyHealth(w),
  panels: ['traffic'],
};
