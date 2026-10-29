import type { ReactNode } from 'react';
import { applyDesired } from '../../sim/actions';
import { podsOf, readyPods, unscheduled } from '../../sim/k8s';
import type { K8sState } from '../../sim/types';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { Portrait } from '../Portrait';
import { useStageState } from '../useStageState';
import './DesiredBoard.css';

// Stage 6 design board: write the "desired state" card for the enroll Deployment.

const APP = 'enroll';
const IMAGES = ['enroll:v1', 'enroll:latest'];
const MIN = 1;
const MAX_FIRST = 6;
const MAX_LATER = 12;

const LATEST_MSG = ':latest는 나중에 어떤 버전인지 몰라서 되돌릴 수 없어요. 버전을 정확히!';
const ONE_MSG = '1개면 그게 죽는 순간 끝이에요. 2개 이상 추천!';

type Msg = { tone: 'ok' | 'warn' | 'bad'; text: string };

export function DesiredBoard() {
  const k8s = useGame((s) => s.run?.world.k8s);
  const desiredDone = useGame((s) => !!s.run && 'desired' in s.run.objectivesDone);
  const dep = k8s?.deployments[APP];
  if (!k8s || !dep) {
    return (
      <ModalFrame title="설계 보드" size="narrow">
        <p className="muted">오늘은 원하는 상태 카드를 쓰지 않아요.</p>
      </ModalFrame>
    );
  }
  const applied = desiredDone || dep.replicas > 0;
  return <Board k8s={k8s} applied={applied} />;
}

function Board({ k8s, applied }: { k8s: K8sState; applied: boolean }) {
  const dep = k8s.deployments[APP];
  // The card being filled in (count, version) and the last message are kept for the stage.
  const [draft, setDraft] = useStageState<number | null>('desired:replicas', null);
  const [image, setImage] = useStageState('desired:image', '');
  const [msg, setMsg] = useStageState<Msg | null>('desired:msg', null);

  const max = applied ? MAX_LATER : MAX_FIRST;
  const replicas = draft ?? (applied ? Math.max(MIN, dep.replicas) : MIN);
  const step = (d: number) => {
    setDraft(Math.max(MIN, Math.min(max, replicas + d)));
    setMsg(null);
  };

  const applyFirst = () => {
    if (!image) return setMsg({ tone: 'warn', text: '어떤 버전을 띄울지 먼저 골라주세요.' });
    if (image.endsWith(':latest')) return setMsg({ tone: 'bad', text: LATEST_MSG });
    if (replicas < 2) return setMsg({ tone: 'warn', text: ONE_MSG });
    const n = replicas;
    const img = image;
    gameStore.getState().act((w) => applyDesired(w, APP, n, img), 'board:desired');
    setDraft(null);
    setMsg({ tone: 'ok', text: '적용 완료! 쿠버네티스가 pod 개수를 맞추는 중이야. 관리 PC 터미널에서 pods 로 확인해봐.' });
  };

  const applyCount = () => {
    if (replicas < 2) return setMsg({ tone: 'warn', text: ONE_MSG });
    const n = replicas;
    // Only the count changes here: no image, so a version that is deployed or still rolling out stays as it is.
    gameStore.getState().act((w) => applyDesired(w, APP, n), 'board:desired');
    setDraft(null);
    setMsg({ tone: 'ok', text: `원하는 개수를 ${n}개로 바꿨네. 나머지는 쿠버네티스가 알아서 맞춰.` });
  };

  const ready = !!image && replicas >= 2;
  const todo = applied
    ? draft !== null && draft !== dep.replicas
      ? '바꾼 개수를 적용하려면 버튼을 눌러주세요.'
      : '숫자를 바꾸면 쿠버네티스가 pod 개수를 다시 맞춰요.'
    : !image
      ? '이미지 버전을 골라주세요.'
      : replicas < 2
        ? '2개 이상이어야 적용할 수 있어요.'
        : '준비 완료! 적용하기를 눌러주세요.';

  const footer = (
    <>
      <span className="dsb-foot-todo">{todo}</span>
      {applied ? (
        <button className="btn primary" disabled={draft === null || draft === dep.replicas || replicas < 2} onClick={applyCount}>
          개수 바꾸기
        </button>
      ) : (
        <button className="btn primary" disabled={!image || replicas < 2} onClick={applyFirst} title={ready ? '' : todo}>
          적용하기
        </button>
      )}
    </>
  );

  return (
    <ModalFrame title="설계 보드 · 원하는 상태 카드" size="wide" footer={footer}>
      <p className="dsb-lead">
        몇 개를 띄울지, 어떤 버전인지 적으면 <b>쿠버네티스</b>가 알아서 맞춰요. <span className="muted">(원하는 상태 = desired state)</span>
      </p>

      <div className="dsb-layout">
        <div className="dsb-yaml" aria-label="원하는 상태 카드">
          <div className="dsb-yaml-head">
            <span>enroll-deployment.yaml</span>
            {applied && <span className="dsb-applied">적용됨</span>}
          </div>
          <div className="dsb-yaml-body">
            <Row k="kind" v={<span className="dsb-str">Deployment</span>} />
            <Row k="metadata" />
            <Row indent k="name" v={<span className="dsb-str">enroll</span>} note="수강신청 서비스" />
            <Row k="spec" />
            <Row
              indent
              k="replicas"
              note="몇 개 띄울까?"
              v={
                <span className="dsb-stepper">
                  <button className="btn" onClick={() => step(-1)} disabled={replicas <= MIN} aria-label="하나 줄이기">
                    −
                  </button>
                  <span className={`dsb-num ${replicas < 2 ? 'is-warn' : ''}`} aria-live="polite">
                    {replicas}
                  </span>
                  <button className="btn" onClick={() => step(1)} disabled={replicas >= max} aria-label="하나 늘리기">
                    +
                  </button>
                </span>
              }
            />
            <Row
              indent
              k="image"
              note="어떤 버전?"
              v={
                applied ? (
                  <span className="dsb-str">
                    {dep.image}
                    {dep.rolling && <span className="dsb-rolling"> → {dep.rolling.target} 교체 중</span>}
                  </span>
                ) : (
                  <select
                    aria-label="이미지 버전"
                    className={`dsb-select ${msg?.tone === 'bad' ? 'is-bad' : ''}`}
                    value={image}
                    onChange={(e) => {
                      setImage(e.target.value);
                      setMsg(null);
                    }}
                  >
                    <option value="" disabled>
                      버전 고르기 ▾
                    </option>
                    {IMAGES.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                )
              }
            />
          </div>
          {replicas === 1 && <p className="dsb-inline warn">{ONE_MSG}</p>}
        </div>

        <div className="dsb-side">
          {msg ? (
            <div className={`dsb-mentor is-${msg.tone}`}>
              <Portrait who={msg.tone === 'ok' ? 'mentor' : 'system'} size={32} />
              <p>{msg.text}</p>
            </div>
          ) : (
            <div className="dsb-mentor">
              <Portrait who="mentor" size={32} />
              <p>
                {applied
                  ? '네가 적은 숫자가 "약속"이야. 아래 표에서 실제 pod 수가 그 숫자와 맞는지 가끔 확인해봐.'
                  : '"3명 근무" 같은 근무표를 써두는 거야. 관제사(쿠버네티스)가 그 근무표대로 사람을 배치해.'}
              </p>
            </div>
          )}
          {applied && <Deployments k8s={k8s} />}
        </div>
      </div>
    </ModalFrame>
  );
}

function Row({ k, v, note, indent }: { k: string; v?: ReactNode; note?: string; indent?: boolean }) {
  return (
    <div className="dsb-row">
      <span className={indent ? 'dsb-indent' : ''} />
      <span className="dsb-key">{k}:</span>
      {v && <span className="dsb-val">{v}</span>}
      {note && <span className="dsb-note"># {note}</span>}
    </div>
  );
}

function Deployments({ k8s }: { k8s: K8sState }) {
  return (
    <div className="dsb-deploys">
      <div className="dsb-deploys-head">지금 실제 상태 (보기 전용)</div>
      <table>
        <thead>
          <tr>
            <th>앱</th>
            <th>준비 / 원함</th>
            <th>버전</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(k8s.deployments).map(([name, d]) => {
            const ready = readyPods(k8s, name).length;
            const waiting = podsOf(k8s, name).filter((p) => p.status !== 'Running');
            // No node had room for these: they stay Pending until a node frees up.
            const noRoom = waiting.filter(unscheduled).length;
            const pending = waiting.length - noRoom;
            const tone = ready >= d.replicas ? 'ok' : ready === 0 && d.replicas > 0 ? 'bad' : 'warn';
            return (
              <tr key={name} className={name === APP ? 'mine' : ''}>
                <td>{name}</td>
                <td>
                  <span className={tone}>
                    {ready} / {d.replicas}
                  </span>
                  {pending > 0 && <span className="muted"> · 준비 중 {pending}</span>}
                  {noRoom > 0 && <span className="warn"> · 자리 없음 {noRoom}</span>}
                  <span className="dsb-bar" aria-hidden>
                    <span style={{ width: `${d.replicas ? Math.min(100, (ready / d.replicas) * 100) : 100}%` }} className={`is-${tone}`} />
                  </span>
                </td>
                <td>
                  <code>{d.image}</code>
                  {d.rolling && <span className="dsb-rolling"> → {d.rolling.target}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
