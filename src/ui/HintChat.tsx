import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { getStage } from '../content/stages';
import { SEV_LABEL } from '../sim/alarms';
import { activeScenarios, HINT_COST, type StageRun } from '../sim/engine';
import type { AlarmSev, Scenario } from '../sim/scenario';
import { dayLabel, type RoomId } from '../sim/types';
import { gameStore, MISSION_THREAD, useGame, type HintMessage } from '../store/game';
import { ModalFrame } from './ModalFrame';
import { guideOf, objectiveStatus, waitingText } from './objectiveStatus';
import { Portrait } from './Portrait';
import { useStageState } from './useStageState';
import './HintChat.css';

const LADDER_KEY = 'khu-dc-hint-ladder-seen';
const MAX_LEVEL = 3;

const ROOM_NAME: Record<RoomId, string> = {
  server: '서버실',
  network: '네트워크실',
  power: '전기실',
  cooling: '냉각실',
  noc: '관제실',
};

/** Example question for the input box, per day: on that day's topic, but never an incident's answer (no port, VLAN number, IP…). */
const ASK_EXAMPLE: Record<number, string> = {
  0: '전원 A/B는 왜 두 개예요?',
  1: 'VLAN이 뭐예요?',
  2: 'L4 스위치가 뭐예요?',
  3: '컨테이너가 뭐예요?',
  4: '이중화가 뭐예요?',
  5: '뭐부터 확인해야 해요?',
};

/** Points the next hint costs on this incident (Lv1 is free). */
const nextHintCost = (level: number) => (level >= 3 ? 0 : (HINT_COST[level + 1] - HINT_COST[level]) * 5);

/** What 쿠사수 says when nothing is on fire, per day. */
const CALM_LINES: Record<number, string> = {
  0: '지금은 조용하네! 오늘은 몸 쓰는 날이야. 랙, 전원, 케이블부터 하나씩 해보자.',
  1: '조용할 때 관제 화면(NMS)을 한 번 둘러봐. 평소 모습을 알아야 이상한 걸 바로 알아채.',
  2: '서비스 여는 날이야. 목표를 미리 끝내두면 경보가 와도 여유가 있어.',
  3: '잘하고 있어! 경보가 울리면 내가 바로 도와줄게. 그동안 남은 목표를 해두자.',
  4: '내일이 D-Day야. 하나가 꺼져도 버티는지 지금 확인해두자.',
  5: '잠깐 조용하네. 관제 화면에서 경보랑 트래픽을 계속 지켜봐!',
};

/** Severity tone for the colors (the stylesheet has two: red and amber). */
const tone = (sev: AlarmSev) => (sev === 'critical' || sev === 'major' ? 'critical' : 'warning');
const sevBadge = (sev: AlarmSev) => `${tone(sev) === 'critical' ? '🚨' : '⚠️'} ${SEV_LABEL[sev]}`;

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
          {!plain && (
            <span className={`hc-badge ${msg.source === 'ai' ? 'ai' : 'canned'}`}>
              {/* A mission answer has no hint level */}
              {msg.source === 'ai' ? 'AI' : msg.level === undefined ? '기본 답' : '기본 힌트'}
            </span>
          )}
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

/** No run yet: nothing to talk about. */
function NoRunView() {
  return (
    <div className="hc-calm">
      <Portrait who="mentor" size={72} />
      <p className="hc-calm-say">게임을 시작하면 무전이 연결돼!</p>
    </div>
  );
}

/** The question box (Enter sends; the Korean IME's composing Enter doesn't). */
function AskBox({ inputRef, text, setText, onAsk, pending, placeholder }: {
  inputRef: RefObject<HTMLInputElement | null>;
  text: string;
  setText: (t: string) => void;
  onAsk: () => void;
  pending: boolean;
  placeholder: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Korean IME sends an Enter while still composing (Safari reports it as keyCode 229); wait for the real one.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      onAsk();
    }
  };
  return (
    <div className="hc-ask">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={placeholder}
        maxLength={300}
        aria-label="쿠사수에게 질문"
      />
      <button type="button" className="btn" onClick={onAsk} disabled={pending || !text.trim()}>
        질문하기
      </button>
    </div>
  );
}

/**
 * Mission mode: the mission being built, and a thread where the player asks about it or about any term on
 * screen (free). With no AI the answer is the mission's own why, its next step and its concept card.
 */
function MissionView({ run, tabbed }: { run: StageRun; tabbed: boolean }) {
  const thread = useGame((s) => s.hints[MISSION_THREAD]) ?? [];
  const pending = useGame((s) => s.hintPending);
  const typingHere = pending && askingFor === MISSION_THREAD;
  // A question typed but not sent yet stays in the box after closing the radio.
  const [text, setText] = useStageState('hint:ask:mission', '');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const st = objectiveStatus(getStage(run.stage), run);
  const o = st.next;
  const guide = guideOf(o, run);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, typingHere]);

  // Put the cursor in the question box. Waiting a frame keeps the "h" that opened the radio out of it.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, []);

  const send = (question?: string) => {
    if (gameStore.getState().hintPending) return;
    askingFor = MISSION_THREAD;
    void gameStore.getState().askMission(question);
  };

  const ask = () => {
    const q = text.trim();
    if (!q || pending) return;
    setText('');
    send(q);
    inputRef.current?.focus();
  };

  const greeting = `${CALM_LINES[run.stage] ?? CALM_LINES[0]} 미션을 하다 모르는 말이 나오면 뭐든 물어봐!`;
  return (
    <div className="hc-incident hc-mission" {...(tabbed ? { role: 'tabpanel', id: 'hc-panel', 'aria-labelledby': 'hc-tab-mission' } : {})}>
      <header className="hc-head mission">
        <div className="hc-head-title">
          <span className="hc-sev mission">🎯 지금 미션</span>
          {o ? <b>{o.text}</b> : <span className="muted">{waitingText({ ...st, incident: false }) ?? '지금은 열린 미션이 없어요.'}</span>}
        </div>
        {guide && (
          <p className="hc-room muted">
            처음 해보는 일이라 단계가 있어요: {guide.doneCount}/{guide.rows.length} 했어요
          </p>
        )}
      </header>

      <div className="hc-thread" ref={listRef} aria-live="polite">
        {thread.length === 0 && !typingHere && <MentorBubble plain msg={{ from: 'mentor', text: greeting, source: 'canned' }} />}
        {thread.map((m, i) => (
          <Message key={i} msg={m} />
        ))}
        {typingHere && <Typing />}
      </div>

      <div className="hc-controls">
        <div className="hc-buttons">
          {o && (
            <button type="button" className="btn primary" onClick={() => send()} disabled={pending}>
              다음 단계 알려줘
            </button>
          )}
          <span className="hc-cost muted">{pending && !typingHere ? '다른 질문에 답하는 중이에요. 잠깐만요!' : '미션 질문은 점수가 깎이지 않아요.'}</span>
        </div>
        <AskBox
          inputRef={inputRef}
          text={text}
          setText={setText}
          onAsk={ask}
          pending={pending}
          placeholder={`미션이나 화면의 말 물어보기 (예: ${ASK_EXAMPLE[run.stage] ?? '이게 뭐예요?'})`}
        />
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

  const doReveal = () => {
    gameStore.getState().reveal(sc.id);
    setConfirming(false);
  };

  return (
    <div className="hc-incident" role="tabpanel" id="hc-panel" aria-labelledby={`hc-tab-${sc.id}`}>
      <header className={`hc-head ${resolved ? 'resolved' : tone(sc.severity)}`}>
        <div className="hc-head-title">
          <span className={`hc-sev ${tone(sc.severity)}`}>{sevBadge(sc.severity)}</span>
          <b>{sc.title}</b>
          {resolved && <span className="hc-badge ok">✅ 해결됨</span>}
        </div>
        <p className="hc-alert">“{sc.alert}”</p>
        <p className="hc-room muted">📍 먼저 가볼 곳: {ROOM_NAME[sc.room]}</p>
      </header>

      {showLadder && !resolved && (
        <div className="hc-ladder">
          <p>
            <b>Lv1</b> 관찰 질문 → <b>Lv2</b> 방향 → <b>Lv3</b> 도구. Lv2부터는 {dayLabel(run.stage)} 일일 리포트 점수가 조금 깎여요.
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
                ? '다른 질문에 답하는 중이에요. 잠깐만요!'
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

          <AskBox
            inputRef={inputRef}
            text={text}
            setText={setText}
            onAsk={ask}
            pending={pending}
            placeholder={`쿠사수에게 질문하기 (예: ${ASK_EXAMPLE[run.stage] ?? '이게 뭐예요?'})`}
          />
        </div>
      )}
    </div>
  );
}

export function HintChat({ initialScenario }: { initialScenario?: string }) {
  const run = useGame((s) => s.run);
  /** Incident tab that was showing when the radio closed last time */
  const [lastTab, saveTab] = useStageState<string | null>('hint:tab', null);
  // Opened for an incident: that one. Otherwise the incident tab from last time, if it is still going on
  // (a long-solved one would only push the live incidents aside), or the first live one: an incident going
  // on comes first. With none, the mission tab (it stays put if an incident starts while the radio is open).
  const [picked, setPicked] = useState<string>(() => {
    if (initialScenario) return initialScenario;
    const live = run ? activeScenarios(run) : [];
    if (lastTab && live.some((a) => a.rt.id === lastTab)) return lastTab;
    return live[0]?.rt.id ?? MISSION_THREAD;
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
  // The incident tab showing, or none: the mission tab (also when no incident is going on).
  const selected = picked === MISSION_THREAD ? undefined : (tabs.find((t) => t.sc.id === picked) ?? tabs[0]);
  const selectedId = selected?.sc.id ?? MISSION_THREAD;

  // Remember the tab that is showing, so it stays (as "해결됨") if that incident gets solved meanwhile,
  // and so it is the one shown when the radio opens again.
  useEffect(() => {
    if (selectedId !== picked) setPicked(selectedId);
  }, [selectedId, picked]);
  useEffect(() => {
    if (selectedId !== MISSION_THREAD) saveTab(selectedId);
  }, [selectedId, saveTab]);

  return (
    <ModalFrame title="쿠사수 무전기 📻" size="narrow">
      <p className="hc-next muted">
        {selected ? '막히면 힌트를 받아봐요. 궁금한 걸 직접 물어봐도 돼요.' : '미션을 하다 막히거나 모르는 말이 나오면 물어봐요.'}
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
              className={`hc-tab ${selected?.sc.id === t.sc.id ? 'on' : ''} ${t.resolved ? 'resolved' : tone(t.sc.severity)}`}
              onClick={() => setPicked(t.sc.id)}
            >
              {t.resolved ? '✅' : tone(t.sc.severity) === 'critical' ? '🚨' : '⚠️'} {t.sc.title}
            </button>
          ))}
          {run && (
            <button
              id="hc-tab-mission"
              type="button"
              role="tab"
              aria-controls="hc-panel"
              aria-selected={!selected}
              className={`hc-tab mission ${selected ? '' : 'on'}`}
              onClick={() => setPicked(MISSION_THREAD)}
            >
              🎯 미션
            </button>
          )}
        </div>
      )}
      {!run ? (
        <NoRunView />
      ) : selected ? (
        <IncidentView key={selected.sc.id} run={run} sc={selected.sc} resolved={selected.resolved} />
      ) : (
        <MissionView run={run} tabbed={tabs.length > 0} />
      )}
    </ModalFrame>
  );
}
