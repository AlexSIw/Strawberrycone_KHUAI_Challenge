// D-4: 네트워크. WP5 owns this file (missions, briefing, unbuild/setup, health).
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK, PLACEHOLDER } from './common';

export const day1: DaySpec = {
  id: 1,
  label: 'D-4',
  date: '02-06',
  clock: WEEKDAY_CLOCK,
  fixed: [],
  extras: [0, 1],
  title: '네트워크',
  subtitle: 'IP · VLAN · DHCP · DNS · IOS',
  topics: ['IP와 사설 대역', 'VLAN', '게이트웨이와 HSRP', 'DHCP · DNS', 'IOS 명령어와 syslog'],
  intro: [{ who: 'boss', text: '장비마다 주소와 VLAN을 정해서 서로 대화하게 만드는 날이에요.' }],
  outro: [{ who: 'lion', text: '오늘 일 끝! 퇴근합니다.', mood: 'happy' }],
  objectives: [PLACEHOLDER],
  interactions: { ...BASE_INTERACTIONS },
  health: (w) => emptyHealth(w),
  panels: ['traffic'],
};
