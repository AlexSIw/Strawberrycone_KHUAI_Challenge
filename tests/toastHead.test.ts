import { describe, expect, it } from 'vitest';
import { toastHead } from '../src/ui/toastHead';

describe('toast header', () => {
  it('names who raised an alert: a call or the NMS', () => {
    expect(toastHead({ kind: 'alert', source: 'user' })).toEqual({ label: '전화 제보', icon: 'phone' });
    expect(toastHead({ kind: 'alert', source: 'nms' })).toEqual({ label: 'NMS 경보', icon: 'siren' });
  });

  it('falls back to the kind label without an icon', () => {
    expect(toastHead({ kind: 'alert' })).toEqual({ label: '장애 발생' });
    expect(toastHead({ kind: 'resolved' })).toEqual({ label: '해결 완료' });
    expect(toastHead({ kind: 'objective' })).toEqual({ label: '목표 달성' });
    expect(toastHead({ kind: 'info' })).toEqual({ label: '알림' });
  });

  it('only an alert takes the source label', () => {
    expect(toastHead({ kind: 'info', source: 'user' })).toEqual({ label: '알림' });
    expect(toastHead({ kind: 'resolved', source: 'nms' })).toEqual({ label: '해결 완료' });
  });
});
