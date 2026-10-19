import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getStage } from '../content/stages';
import { activeScenarios, HINT_COST, visibleObjectives, type StageRun } from '../sim/engine';
import type { Scenario } from '../sim/scenario';
import type { RoomId } from '../sim/types';
import { gameStore, useGame, type HintMessage } from '../store/game';
import { ModalFrame } from './ModalFrame';
import { objectiveStatus, waitingText } from './objectiveStatus';
import { Portrait } from './Portrait';
import { useStageState } from './useStageState';
import './HintChat.css';

const LADDER_KEY = 'khu-dc-hint-ladder-seen';
const MAX_LEVEL = 3;

const ROOM_NAME: Record<RoomId, string> = {
  server: '서버실',
  network: '네트워크실',
  power: '전원실',
  cooling: '냉각실',
  noc: '관제실',
};

/** Example question for the input box: on this stage's topic, but never an incident's answer (no UPS, port, API…). */
const ASK_EXAMPLE: Record<number, string> = {
  0: '데이터센터가 뭐예요?',
  1: '랙이 뭐예요?',
  2: 'ping이 뭐예요?',
  3: 'curl이 뭐예요?',
  4: '모놀리스가 뭐예요?',
  5: '레지스트리가 뭐예요?',
  6: 'pod가 뭐예요?',
  7: '뭐부터 고쳐야 해요?',
};

/** Points the next hint costs on this incident (Lv1 is free). */
const nextHintCost = (level: number) => (level >= 3 ? 0 : (HINT_COST[level + 1] - HINT_COST[level]) * 5);

const CALM_LINES = [
  '지금은 조용하네! 이럴 때 목표를 하나씩 끝내두자.',
  '장애가 없을 때 장비를 미리 둘러봐 두면 나중에 편해. 천천히 살펴봐.',
  '잘하고 있어! 알람이 울리면 내가 바로 도와줄게.',
];

/**
 * Incident the pending answer belongs to. The store only keeps a yes/no `hintPending`, so without
 * this the "typing…" bubble would show in whichever tab is open. Lives outside React so it
 * survives closing and reopening the radio while the answer is on its way.
 */
let askingFor: string | null = null;

function ladderSeen(): boolean {
  try {
    return localStorage.getItem(LADDER_KEY) === '1';
  } catch {
    return false;
  }
}

function markLadderSeen(): void {
  try {
    localStorage.setItem(LADDER_KEY, '1');
  } catch {
    /* storage blocked: the note just shows again next time */
  }
}

/** `plain` = a greeting, not a hint: no level / source badges. */
function MentorBubble({ msg, plain = false }: { msg: HintMessage; plain?: boolean }) {
  return (
    <div className="hc-row mentor">
      <Portrait who="mentor" size={36} />
      <div className="hc-bubble">
        <div className="hc-meta">
          <span className="hc-who">쿠사수</span>
          {!plain && msg.level !== undefined && <span className="hc-badge lv">Lv{msg.level}</span>}
          {!plain && <span className={`hc-badge ${msg.source === 'ai' ? 'ai' : 'canned'}`}>{msg.source === 'ai' ? 'AI' : '기본 힌트'}</span>}
        </div>
        <p>{msg.text}</p>
      </div>
    </div>
  );
}

function Message({ msg }: { msg: HintMessage }) {
  if (msg.from === 'mentor') return <MentorBubble msg={msg} />;
  if (msg.from === 'player') {
    return (
      <div className="hc-row player">
        <div className="hc-bubble">
          <p>{msg.text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={`hc-system ${msg.source === 'solution' ? 'solution' : ''}`}>
      {msg.source === 'solution' && <span className="hc-badge sol">정답 공개</span>}
      <p>{msg.text}</p>
    </div>
  );
}

function Typing() {
  return (
    <div className="hc-row mentor">
      <Portrait who="mentor" size={36} />
      <div className="hc-bubble hc-typing">
        <span className="hc-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="muted">쿠사수가 무전 치는 중…</span>
      </div>
    </div>
  );
}

/** Nothing is on fire: encourage the player and remind them what's left to do. */
function CalmView({ run }: { run: StageRun | null }) {
  if (!run) {
    return (
      <div className="hc-calm">
        <Portrait who="mentor" size={72} />
        <p className="hc-calm-say">게임을 시작하면 무전이 연결돼!</p>
      </div>
    );
  }
  const def = getStage(run.stage);
  const objectives = visibleObjectives(def, run);
  const line = CALM_LINES[run.stage % CALM_LINES.length];
  return (
    <div className="hc-calm">
      <div className="hc-calm-top">
        <Portrait who="mentor" size={72} />
        <div className="hc-bubble big">
          <div className="hc-meta">
            <span className="hc-who">쿠사수</span>
          </div>
          <p>{line}</p>
        </div>
      </div>
      <div className="hc-objectives">
        <h4>지금 할 일</h4>
        <ul>
          {objectives.map((o) => {
            const done = o.id in run.objectivesDone;
            return (
              <li key={o.id} className={done ? 'done' : ''}>
                <span aria-hidden>{done ? '✅' : '⬜'}</span> {o.text}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function IncidentView({ run, sc, resolved }: { run: StageRun; sc: Scenario; resolved: boolean }) {
  const thread = useGame((s) => s.hints[sc.id]) ?? [];
  const pending = useGame((s) => s.hintPending);
  /** The answer being typed is for this incident (not another tab's). */
  const typingHere = pending && askingFor === sc.id;
  const level = run.hintLevel[sc.id] ?? 0;
  const revealed = run.revealed.includes(sc.id);
  // A question typed but not sent yet stays in the box (per incident) after closing the radio.
  const [text, setText] = useStageState(`hint:ask:${sc.id}`, '');
  const [confirming, setConfirming] = useState(false);
  const [showLadder, setShowLadder] = useState(() => !ladderSeen());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, typingHere]);

  // Put the cursor in the question box. Waiting a frame keeps the "h" that opened the radio out of it.
  useEffect(() => {
    if (resolved) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [resolved]);

  const closeLadder = () => {
    markLadderSeen();
    setShowLadder(false);
  };

  const send = (question?: string) => {
    if (gameStore.getState().hintPending) return;
    askingFor = sc.id;
    void gameStore.getState().askHint(sc.id, question);
  };

  const nextHint = () => {
    if (showLadder) closeLadder();
    send();
  };

  const ask = () => {
    const q = text.trim();
    if (!q || pending) return;
    if (showLadder) closeLadder();
    setText('');
    send(q);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Korean IME sends an Enter while still composing (Safari reports it as keyCode 229); wait for the real one.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      ask();
    }
  };

  const doReveal = () => {
    gameStore.getState().reveal(sc.id);
    setConfirming(false);
  };

  return (
    <div className="hc-incident" role="tabpanel" id="hc-panel" aria-labelledby={`hc-tab-${sc.id}`}>
      <header className={`hc-head ${resolved ? 'resolved' : sc.severity}`}>
        <div className="hc-head-title">
          <span className={`hc-sev ${sc.severity}`}>{sc.severity === 'critical' ? '🚨 긴급' : '⚠️ 주의'}</span>
          <b>{sc.title}</b>
          {resolved && <span className="hc-badge ok">✅ 해결됨</span>}
        </div>
        <p className="hc-alert">“{sc.alert}”</p>
        <p className="hc-room muted">📍 먼저 가볼 곳: {ROOM_NAME[sc.room]}</p>
      </header>

      {showLadder && !resolved && (
        <div className="hc-ladder">
          <p>
            <b>Lv1</b> 관찰 질문 → <b>Lv2</b> 방향 → <b>Lv3</b> 도구.
          </p>
          <button type="button" className="btn ghost hc-ladder-ok" onClick={closeLadder}>
            알겠어요
          </button>
        </div>
      )}

      <div className="hc-thread" ref={listRef} aria-live="polite">
        {thread.length === 0 && !typingHere && (
          <MentorBubble
            plain
            msg={{
              from: 'mentor',
              text: resolved ? '해결했구나! 잘했어. 👏' : '무슨 일이야? "힌트 받기"를 누르면 차근차근 알려줄게. 궁금한 걸 직접 물어봐도 돼.',
              source: 'canned',
            }}
          />
        )}
        {thread.map((m, i) => (
          <Message key={i} msg={m} />
        ))}
        {typingHere && <Typing />}
      </div>

      {resolved ? (
        <p className="hc-done ok">🎉 이 장애는 해결됐어요. 다른 탭이나 목표를 확인해보세요.</p>
      ) : (
        <div className="hc-controls">
          <div className="hc-buttons">
            {level < MAX_LEVEL ? (
              <button type="button" className="btn primary" onClick={nextHint} disabled={pending}>
                힌트 받기 (Lv {level + 1}/{MAX_LEVEL})
              </button>
            ) : (
              <button type="button" className="btn" disabled>
                힌트 다 받았어요 ({MAX_LEVEL}/{MAX_LEVEL})
              </button>
            )}
            {level >= MAX_LEVEL && !revealed && !confirming && (
              <button type="button" className="btn hc-reveal" onClick={() => setConfirming(true)} disabled={pending}>
                정답 보기
              </button>
            )}
            {revealed && <span className="tag">정답 확인함</span>}
            <span className="hc-cost muted">
              {pending && !typingHere
                ? '다른 장애에 답하는 중이에요. 잠깐만요!'
                : level >= MAX_LEVEL
                  ? ''
                  : nextHintCost(level) === 0
                    ? `Lv${level + 1} 힌트는 무료예요.`
                    : `다음 힌트(Lv${level + 1})는 −${nextHintCost(level)}점이에요.`}
            </span>
          </div>

          {confirming && (
            <div className="hc-confirm" role="alertdialog" aria-label="정답 보기 확인">
              <p>정답을 보면 점수가 15점 깎여요. 볼까요?</p>
              <div>
                <button type="button" className="btn primary" onClick={doReveal}>
                  볼래요
                </button>
                <button type="button" className="btn" onClick={() => setConfirming(false)}>
                  아니요
                </button>
              </div>
            </div>
          )}

          <div className="hc-ask">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder={`쿠사수에게 질문하기 (예: ${ASK_EXAMPLE[run.stage] ?? '이게 뭐예요?'})`}
              maxLength={300}
              aria-label="쿠사수에게 질문"
            />
            <button type="button" className="btn" onClick={ask} disabled={pending || !text.trim()}>
              질문하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function HintChat({ initialScenario }: { initialScenario?: string }) {
  const run = useGame((s) => s.run);
  /** Tab that was showing when the radio closed last time */
  const [lastTab, saveTab] = useStageState<string | null>('hint:tab', null);
  // Opened for an incident: that one. Otherwise the tab from last time, if that incident is still going on
  // (a long-solved one would only push the live incidents aside).
  const [picked, setPicked] = useState<string | undefined>(() => {
    if (initialScenario) return initialScenario;
    const live = run ? activeScenarios(run) : [];
    return lastTab && live.some((a) => a.rt.id === lastTab) ? lastTab : undefined;
  });

  // Follow the store when another window re-opens the radio for a specific incident.
  useEffect(() => {
    if (initialScenario) setPicked(initialScenario);
  }, [initialScenario]);

  const active = run ? activeScenarios(run) : [];
  const stageScenarios = run ? getStage(run.stage).scenarios : [];
  // An incident solved while the radio is open stays as a tab so the player sees the "해결됨" moment.
  const pickedResolved =
    run && picked && !active.some((a) => a.rt.id === picked) && run.scenarios.find((s) => s.id === picked)?.state === 'resolved'
      ? stageScenarios.find((s) => s.id === picked)
      : undefined;
  const tabs: { sc: Scenario; resolved: boolean }[] = [
    ...active.map((a) => ({ sc: a.def, resolved: false })),
    ...(pickedResolved ? [{ sc: pickedResolved, resolved: true }] : []),
  ];
  const selected = tabs.find((t) => t.sc.id === picked) ?? tabs[0];
  const selectedId = selected?.sc.id;
  // Nothing on fire: point at the remaining objectives, or say what the player is waiting for when none is open.
  const goals = run ? objectiveStatus(getStage(run.stage), run) : null;
  const calmLine = (goals && waitingText(goals)) ?? '지금은 장애가 없어요. 남은 목표를 해볼까요?';

  // Remember the tab that is showing, so it stays (as "해결됨") if that incident gets solved meanwhile,
  // and so it is the one shown when the radio opens again.
  useEffect(() => {
    if (selectedId && selectedId !== picked) setPicked(selectedId);
  }, [selectedId, picked]);
  useEffect(() => {
    if (selectedId) saveTab(selectedId);
  }, [selectedId, saveTab]);

  return (
    <ModalFrame title="쿠사수 무전기 📻" size="narrow">
      <p className="hc-next muted">
        {tabs.length ? '막히면 힌트를 받아봐요. 궁금한 걸 직접 물어봐도 돼요.' : calmLine}
      </p>
      {tabs.length > 0 && (
        <div className="hc-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.sc.id}
              id={`hc-tab-${t.sc.id}`}
              type="button"
              role="tab"
              aria-controls="hc-panel"
              aria-selected={selected?.sc.id === t.sc.id}
              className={`hc-tab ${selected?.sc.id === t.sc.id ? 'on' : ''} ${t.resolved ? 'resolved' : t.sc.severity}`}
              onClick={() => setPicked(t.sc.id)}
            >
              {t.resolved ? '✅' : t.sc.severity === 'critical' ? '🚨' : '⚠️'} {t.sc.title}
            </button>
          ))}
        </div>
      )}
      {run && selected ? <IncidentView key={selected.sc.id} run={run} sc={selected.sc} resolved={selected.resolved} /> : <CalmView run={run} />}
    </ModalFrame>
  );
}
