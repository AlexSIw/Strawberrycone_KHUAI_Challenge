import type { Toast } from '../store/game';
import type { IconName } from './pixelIcons';

const LABEL: Record<Toast['kind'], string> = { alert: '장애 발생', resolved: '해결 완료', objective: '목표 달성', info: '알림' };

/**
 * A toast's header: what kind of news it is and, for an alert, who raised it. A call from a user or the
 * 팀장 and an NMS alarm read differently at a glance (phone vs siren), since the text no longer says so.
 */
export function toastHead(t: Pick<Toast, 'kind' | 'source'>): { label: string; icon?: IconName } {
  if (t.kind === 'alert' && t.source === 'user') return { label: '전화 제보', icon: 'phone' };
  if (t.kind === 'alert' && t.source === 'nms') return { label: 'NMS 경보', icon: 'siren' };
  return { label: LABEL[t.kind] };
}
