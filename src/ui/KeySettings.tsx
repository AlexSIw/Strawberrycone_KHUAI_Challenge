import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FallbackReason } from '../ai/answer';
import { checkKey } from '../ai/client';
import { cleanKey, isKeyShape } from '../ai/key';
import { clearKey, keyRemembered, ownKey, saveKey, subscribeKey } from './keyStorage';
import { ModalFrame } from './ModalFrame';
import './KeySettings.css';

/** Is a key of the player's own in use? Re-renders when one is saved or cleared. */
export const useOwnKey = (): boolean => useSyncExternalStore(subscribeKey, () => ownKey() !== '');

/** What a failed 연결 확인 means for the player. */
function checkText(reason: FallbackReason): string {
  switch (reason) {
    case 'badkey':
      return '키가 맞지 않아요. ChatKHU에서 만든 키를 다시 붙여 넣어 주세요.';
    case 'offline':
      return '힌트 서버(Worker)에 닿지 않아서 지금은 키를 확인할 수 없어요.';
    case 'rate':
      return '확인 요청이 많아요. 잠시 뒤에 다시 눌러 주세요.';
    default:
      return 'ChatKHU가 답하지 않았어요. 잠시 뒤에 다시 눌러 주세요.';
  }
}

type Status = { tone: 'ok' | 'bad' | 'muted'; text: string } | null;

/**
 * The player's own ChatKHU key: paste it, test it (one tiny call), and keep it for this tab or this browser.
 * Opened from the title screen and from the radio; `over` puts it above the radio.
 */
export function KeySettings({ onClose, over = false }: { onClose: () => void; over?: boolean }) {
  const [text, setText] = useState(() => ownKey());
  const [remember, setRemember] = useState(() => keyRemembered());
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const inUse = useOwnKey();
  const key = cleanKey(text);
  const valid = isKeyShape(key);

  // Esc closes only this window, not the radio underneath (its own Esc listens later, on the way back up).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const check = async () => {
    if (!valid || checking) return;
    setChecking(true);
    setStatus({ tone: 'muted', text: 'ChatKHU에 물어보는 중…' });
    const r = await checkKey(key);
    setChecking(false);
    setStatus(r.ok ? { tone: 'ok', text: '연결됐어요! 저장하면 쿠사수가 이 키로 답해요.' } : { tone: 'bad', text: checkText(r.reason) });
  };

  const save = () => {
    if (!saveKey(key, remember)) {
      setStatus({ tone: 'bad', text: '저장하지 못했어요. 키를 다시 확인해 주세요.' });
      return;
    }
    setText(key);
    setStatus({ tone: 'ok', text: remember ? '저장했어요. 이 브라우저에서 계속 이 키로 답해요.' : '저장했어요. 이 탭을 닫을 때까지 이 키로 답해요.' });
  };

  const clear = () => {
    clearKey();
    setText('');
    setStatus({ tone: 'muted', text: '지웠어요. 이제 서버의 키가 있으면 그 키로, 없으면 기본 힌트로 답해요.' });
  };

  return (
    <ModalFrame
      title="ChatKHU 키"
      size="narrow"
      onClose={onClose}
      className={over ? 'modal-over' : ''}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
      }
    >
      <div className="ks">
        <p className="ks-lead">
          내 ChatKHU API 키를 넣으면 쿠사수가 그 키로 답해요. <span className="muted">(선택)</span>
        </p>
        <p className="ks-now muted">
          지금: {inUse ? (keyRemembered() ? '내 키 사용 중 (이 브라우저에 기억됨)' : '내 키 사용 중 (이 탭에서만)') : '내 키 없음'}
        </p>

        <div className="ks-field">
          <input
            type={show ? 'text' : 'password'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setStatus(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) save();
            }}
            placeholder="ChatKHU API 키 붙여 넣기"
            aria-label="ChatKHU API 키"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button type="button" className="btn ghost ks-show" onClick={() => setShow((v) => !v)} aria-pressed={show}>
            {show ? '숨기기' : '보기'}
          </button>
        </div>
        {text.trim() !== '' && !valid && <p className="ks-status bad">키 모양이 아니에요. 띄어쓰기 없이 통째로 붙여 넣어 주세요.</p>}

        <label className="ks-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />이 브라우저에 기억하기{' '}
          <span className="muted">(공용 PC에서는 끄세요. 끄면 탭을 닫을 때 잊어요)</span>
        </label>

        <div className="ks-buttons">
          <button type="button" className="btn" onClick={check} disabled={!valid || checking}>
            연결 확인
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={!valid}>
            저장
          </button>
          <button type="button" className="btn ghost" onClick={clear} disabled={!inUse && text === ''}>
            지우기
          </button>
        </div>
        {status && (
          <p className={`ks-status ${status.tone}`} role="status">
            {status.text}
          </p>
        )}

        <ul className="ks-info muted">
          <li>키 만들기: ChatKHU 로그인 → 왼쪽 아래 API Gateway → API 키 생성</li>
          <li>키는 이 브라우저에만 있어요. 힌트를 물을 때만 힌트 서버를 거쳐 ChatKHU로 가고, 서버에 저장하거나 기록하지 않아요.</li>
          <li>비워 두면 서버에 키가 있으면 그 키로, 없으면 미리 적어 둔 기본 힌트로 답해요. 연결 확인은 ChatKHU를 아주 짧게 한 번 불러요.</li>
        </ul>
      </div>
    </ModalFrame>
  );
}
