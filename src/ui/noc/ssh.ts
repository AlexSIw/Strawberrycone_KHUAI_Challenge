import { available, promptFor } from '../../sim/commands';
import type { StageId } from '../../sim/types';
import { gameStore } from '../../store/game';

/** Is `ssh` a command the player has today? (IOS and remote login start on D-4.) */
export const canSsh = (day: StageId): boolean => available(day).some((c) => c.name === 'ssh');

/** Types one line into the 관리 PC session, echoing it with its prompt like the terminal does. */
function type(line: string): void {
  const s = gameStore.getState();
  s.appendTerminal([promptFor(s.terminal.host, s.terminal.mode ?? null, s.run?.world) + line]);
  const res = gameStore.getState().command(line);
  if (res.clear) gameStore.getState().clearTerminal();
  if (res.lines.length) gameStore.getState().appendTerminal(res.lines);
}

/**
 * The NMS "SSH 접속" button: opens the 관리 PC terminal and logs in to `id` there, leaving whatever device
 * the session was on first (the lines show in the terminal, as if typed).
 */
export function sshTo(id: string): void {
  gameStore.getState().openModal({ type: 'terminal', host: 'ops' });
  for (let i = 0; i < 6; i++) {
    const { host, mode } = gameStore.getState().terminal;
    if (host === 'ops' || host === id) break;
    type(mode && (mode.level === 'config' || mode.level === 'config-if' || mode.level === 'config-vlan') ? 'end' : 'exit');
  }
  if (gameStore.getState().terminal.host !== id) type(`ssh ${id}`);
}
