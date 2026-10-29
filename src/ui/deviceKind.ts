// A short word for what a device is, shown as a tag next to its name: labels are often bare IDs (TOR-01),
// so the tag says what the box does. Shared by the SMS device cards and the power room table.
import type { DeviceKind } from '../sim/types';

export const KIND_LABEL: Record<DeviceKind, string> = {
  server: '서버',
  switch: '스위치',
  router: '라우터',
  internet: '인터넷',
  firewall: '방화벽',
  lb: 'L4',
};
