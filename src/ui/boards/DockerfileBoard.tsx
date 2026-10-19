import { useState, type DragEvent } from 'react';
import { writeDockerfile } from '../../sim/actions';
import { APP_PORT, ENROLL_DOCKERFILE } from '../../sim/commands/docker';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { Portrait } from '../Portrait';
import './DockerfileBoard.css';

// Stage 5 design board: put the Dockerfile ("레시피 카드") lines in the right order.

interface Line {
  id: 'from' | 'workdir' | 'copy' | 'run' | 'expose' | 'cmd';
  code: string;
  icon: string;
  tag: string;
  detail: string;
}

/** Card text for each recipe line. The code comes from ENROLL_DOCKERFILE (which `docker build` prints), matched by instruction. */
const CARDS: Omit<Line, 'code'>[] = [
  { id: 'from', icon: '🥕', tag: '재료 준비', detail: '파이썬 3.12가 들어 있는 기본 이미지에서 시작해요. 서버에 뭐가 깔려 있든 상관없어져요.' },
  { id: 'workdir', icon: '🍳', tag: '작업대', detail: '컨테이너 안의 /app 폴더를 작업대로 정해요. 다음 줄부터는 여기서 일해요.' },
  { id: 'copy', icon: '📦', tag: '재료 넣기', detail: '내 코드(지금 폴더 ".")를 컨테이너 안 /app 으로 복사해요.' },
  { id: 'run', icon: '🔪', tag: '손질', detail: 'requirements.txt에 적힌 라이브러리를 설치해요. 이미지를 만들 때 한 번 실행돼요.' },
  { id: 'expose', icon: '🏷️', tag: '창구 번호 메모', detail: `"이 앱은 안쪽 ${APP_PORT.enroll}번 창구에서 손님을 받아요"라고 적어두는 메모예요.` },
  { id: 'cmd', icon: '🍽️', tag: '완성 후 실행', detail: '컨테이너가 켜질 때 실행할 명령이에요. 요리가 다 된 뒤 손님에게 내기!' },
];

/** Each card shows the recipe line that starts with its instruction (FROM, WORKDIR, …). */
const LINES: Line[] = CARDS.map((c) => ({
  ...c,
  code: ENROLL_DOCKERFILE.find((l) => l.split(' ')[0] === c.id.toUpperCase()) ?? c.id.toUpperCase(),
}));

const BY_ID = Object.fromEntries(LINES.map((l) => [l.id, l])) as Record<Line['id'], Line>;

/** First rule the order breaks (with the lines to highlight), or null when it is a valid Dockerfile. */
function checkOrder(ids: Line['id'][]): { msg: string; lines: Line['id'][] } | null {
  const at = (id: Line['id']) => ids.indexOf(id);
  if (at('from') !== 0) return { msg: 'FROM이 맨 위에 와야 해. 어떤 재료(기본 이미지)로 시작할지부터 정해야지!', lines: ['from'] };
  if (at('cmd') !== ids.length - 1) return { msg: 'CMD는 맨 마지막이야. 요리가 다 끝난 다음에 "실행"하는 거니까.', lines: ['cmd'] };
  if (at('workdir') > at('copy')) return { msg: '작업대(WORKDIR)를 먼저 펴야 재료를 그 위에 올리지. WORKDIR → COPY 순서!', lines: ['workdir', 'copy'] };
  if (at('copy') > at('run')) {
    return { msg: 'requirements.txt가 아직 안 들어왔는데 설치할 순 없어. 재료부터 넣고(COPY) 손질(RUN)!', lines: ['copy', 'run'] };
  }
  return null;
}

function shuffledOrder(): Line['id'][] {
  for (;;) {
    const a = LINES.map((l) => l.id);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (checkOrder(a)) return a;
  }
}

/** Colleague's memo. Deliberately without -p: the port lesson comes later (s5-port). */
const MEMO: { n: string; parts: { text: string; cmd?: boolean }[] }[] = [
  { n: '①', parts: [{ text: '관리 PC에서 ' }, { text: 'docker build -t enroll:1.0 .', cmd: true }] },
  { n: '②', parts: [{ text: 'docker push enroll:1.0', cmd: true }] },
  { n: '③', parts: [{ text: 'ssh srv-new', cmd: true }, { text: ' 후 ' }, { text: 'docker run enroll:1.0', cmd: true }] },
];

export function DockerfileBoard() {
  const done = useGame((s) => s.run?.world.flags['dockerfile:enroll'] === 'ok');
  // Like the stage 4 board: packaging the app before seeing the new server fail would skip the lesson.
  const problemSeen = useGame((s) => {
    const r = s.run;
    if (!r) return true;
    return 'log' in r.objectivesDone || r.scenarios.some((x) => x.id === 's5-drift' && x.state !== 'waiting');
  });
  const [justDone, setJustDone] = useState(false);
  if (done) return <Finished celebrate={justDone} />;
  if (!problemSeen) {
    return (
      <ModalFrame title="설계 보드 · 레시피 카드" icon="📋" size="narrow">
        <p style={{ lineHeight: 1.7, margin: 0 }}>새 서버(srv-new)에 신청 앱을 설치하는 중이에요.</p>
        <p className="muted">
          새 서버 배포 결과부터 확인해봐요: 관리 PC 터미널에서 <code>ssh srv-new</code> → <code>deploy log</code>
        </p>
      </ModalFrame>
    );
  }
  return <Recipe onSolved={() => setJustDone(true)} />;
}

function Recipe({ onSolved }: { onSolved: () => void }) {
  const [order, setOrder] = useState<Line['id'][]>(shuffledOrder);
  const [dragId, setDragId] = useState<Line['id'] | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [problem, setProblem] = useState<{ msg: string; lines: Line['id'][] } | null>(null);

  const moveTo = (id: Line['id'], to: number) => {
    setOrder((o) => {
      const rest = o.filter((x) => x !== id);
      rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
      return rest;
    });
    setProblem(null);
  };

  const check = () => {
    const p = checkOrder(order);
    if (p) return setProblem(p);
    onSolved();
    gameStore.getState().act((w) => writeDockerfile(w, 'enroll'), 'board:dockerfile');
  };

  return (
    <ModalFrame
      title="설계 보드 · 레시피 카드 (Dockerfile)"
      icon="📋"
      size="wide"
      footer={
        <>
          <label className="dfb-toggle">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 설명 모두 펼치기
          </label>
          <button className="btn primary" onClick={check}>
            순서 확인
          </button>
        </>
      }
    >
      <p className="dfb-lead">
        <b>Dockerfile</b> = 앱을 밀키트(이미지)로 포장하는 <b>레시피 카드</b>예요. 위에서부터 한 줄씩 차례로 실행돼요.
      </p>
      <p className="dfb-todo">👉 줄을 끌어서(또는 ↑↓ 버튼으로) 요리 순서대로 맞춰주세요. 줄에 마우스를 올리면 설명이 나와요.</p>

      <div className="dfb-card">
        <div className="dfb-card-head">
          <span>📄 Dockerfile</span>
          <span className="muted">enroll (수강신청)</span>
        </div>
        <ol className="dfb-lines">
          {order.map((id, i) => {
            const l = BY_ID[id];
            const flagged = problem?.lines.includes(id);
            return (
              <li
                key={id}
                className={['dfb-row', dragId === id ? 'dragging' : '', overIdx === i && dragId !== id ? 'over' : '', flagged ? 'flag' : ''].join(' ')}
                draggable
                onDragStart={(e: DragEvent) => {
                  e.dataTransfer.setData('text/plain', id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragId(id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverIdx(null);
                }}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  if (overIdx !== i) setOverIdx(i);
                }}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.getData('text/plain');
                  if (Object.hasOwn(BY_ID, dropped)) moveTo(dropped as Line['id'], i);
                  setDragId(null);
                  setOverIdx(null);
                }}
                tabIndex={0}
              >
                <span className="dfb-grip" aria-hidden>
                  ⋮⋮
                </span>
                <span className="dfb-num">{i + 1}</span>
                <code className="dfb-code">{l.code}</code>
                <span className="dfb-tag">
                  {l.icon} {l.tag}
                </span>
                <span className="dfb-arrows">
                  <button className="btn" disabled={i === 0} onClick={() => moveTo(id, i - 1)} aria-label={`${l.code} 위로`}>
                    ↑
                  </button>
                  <button className="btn" disabled={i === order.length - 1} onClick={() => moveTo(id, i + 1)} aria-label={`${l.code} 아래로`}>
                    ↓
                  </button>
                </span>
                <span className={`dfb-tip ${showAll ? 'open' : ''}`}>{l.detail}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {problem && (
        <div className="dfb-mentor is-bad">
          <Portrait who="mentor" size={44} />
          <p>{problem.msg}</p>
        </div>
      )}
    </ModalFrame>
  );
}

function Finished({ celebrate }: { celebrate: boolean }) {
  return (
    <ModalFrame title="설계 보드 · 레시피 카드 (Dockerfile)" icon="📋" size="wide">
      <div className="dfb-mentor">
        <Portrait who="mentor" size={44} />
        <p>
          {celebrate
            ? '완벽해! 레시피 카드 완성. 이걸로 어느 서버에서나 똑같은 밀키트(이미지)를 만들 수 있어.'
            : '레시피 카드는 이미 완성했어. 이제 동료 메모대로 해보자.'}
        </p>
      </div>
      <div className="dfb-done">
        <div className="dfb-card done">
          <div className="dfb-card-head">
            <span>📄 Dockerfile ✅</span>
            <span className="muted">enroll (수강신청)</span>
          </div>
          <ol className="dfb-lines">
            {LINES.map((l, i) => (
              <li key={l.id} className="dfb-row static">
                <span className="dfb-num">{i + 1}</span>
                <code className="dfb-code">{l.code}</code>
                <span className="dfb-tag">
                  {l.icon} {l.tag}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="dfb-memo" role="note">
          <div className="dfb-memo-title">📌 동료 메모</div>
          <ul>
            {MEMO.map((m) => (
              <li key={m.n}>
                <span className="dfb-memo-n">{m.n}</span>
                <span>
                  {m.parts.map((p, i) => (p.cmd ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="dfb-todo">👉 관리 PC 터미널에서 메모 순서대로 입력해보세요.</p>
    </ModalFrame>
  );
}
