import type { CSSProperties } from 'react';
import { CONCEPTS } from '../../content/concepts';
import { getStage } from '../../content/stages';
import { fmtClock, gameSec, stageAt } from '../../sim/clock';
import { scoreRun, type StageRun } from '../../sim/engine';
import type { ScenarioRuntime } from '../../sim/scenario';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { Portrait } from '../Portrait';
import { useStageState } from '../useStageState';
import './PostmortemBoard.css';

// D-Day design board: the postmortem (장애 보고서) written after the 10:30 first close. Every incident
// that happened today, in the order it started: when it started, when it was acknowledged (MTTD) and
// fixed (MTTR), then the player picks the cause, the action taken and one way to prevent it.

type Field = 'cause' | 'fix' | 'prevent';

/** What the report asks about one kind of D-Day incident (keyed by incident template id). */
interface Report {
  template: string;
  cause: { options: string[]; answer: number };
  fix: { options: string[]; answer: number };
  /** Every idea is reasonable; the player just picks one. */
  prevent: string[];
}

const REPORTS: Report[] = [
  {
    template: 'dday-capacity',
    cause: {
      options: ['DNS 장부에서 수강신청 이름이 빠졌다', '오픈 순간 접속(1초에 1만 건 넘게)에 비해 신청 pod 수(4개)가 부족했다', '신청 서비스 새 버전에 버그가 있었다'],
      answer: 1,
    },
    fix: {
      options: ['신청 pod 개수를 접속량에 맞게 늘렸다 (scale)', '이전 버전으로 되돌렸다 (rollback)', 'L4를 재부팅했다'],
      answer: 0,
    },
    prevent: ['피크 전에 pod를 미리 넉넉히 늘려 두기', '오토스케일링: 접속량에 맞춰 pod 개수를 자동 조절', '부하 테스트로 필요한 pod 수를 미리 계산하기'],
  },
  {
    template: 'dday-db',
    cause: {
      options: ['pod 수 × pod당 DB 연결 수가 DB 연결 한도(200)를 넘었다', 'DB 서버 디스크가 꽉 찼다', '방화벽이 DB로 가는 길을 막았다'],
      answer: 0,
    },
    fix: {
      options: ['DB 서버를 재부팅했다', 'DB 서버 케이블을 바꿨다', 'pod 하나가 여는 DB 연결 수(환경변수)를 줄였다'],
      answer: 2,
    },
    prevent: ['pod를 늘리기 전에 "pod 수 × 연결 수 ≤ DB 한도"부터 계산하기', '여러 pod가 연결을 나눠 쓰는 연결 중계기(커넥션 풀러) 두기', 'DB 연결 수 경보를 한도의 80%에 걸어 두기'],
  },
  {
    template: 'dday-uplink',
    cause: {
      options: ['3번 랙 스위치(TOR-02) 케이블이 끊어졌다', 'TOR-02 포트의 VLAN이 바뀌었다', 'TOR-02에서 코어로 가는 길이 10G 한 가닥뿐이라 신청 집중 때 꽉 찼다'],
      answer: 2,
    },
    fix: {
      options: ['TOR-02를 재부팅했다', '놀던 예비 선을 켜고 두 가닥을 LACP로 묶어 20G로 넓혔다', 'STP를 꺼서 막혀 있던 길을 열었다'],
      answer: 1,
    },
    prevent: ['랙마다 업링크를 처음부터 두 가닥 이상 묶어 두기', '링크 사용률 경보를 70%에 걸어 미리 보기', '부하 테스트 때 랙별 링크 사용률까지 재 보기'],
  },
  {
    template: 'dday-macro',
    cause: {
      options: ['학생 수가 갑자기 두 배로 늘었다', '매크로(자동 클릭 프로그램)가 L4의 세션 자리를 차지했다', 'L4 헬스체크 경로가 틀렸다'],
      answer: 1,
    },
    fix: {
      options: ['L4 세션 한도를 무제한으로 올렸다', '방화벽에서 외부 접속을 전부 막았다', '방화벽에서 매크로 출발지 대역만 막았다 (fw deny)'],
      answer: 2,
    },
    prevent: ['주소 하나당 요청 수 제한(rate limit) 걸기', '접속 대기열(번호표)에 매크로 막기(캡차) 붙이기', '수상한 대역 목록을 미리 받아 막아 두기'],
  },
];

const FIELDS: { key: Field; label: string; help: string }[] = [
  { key: 'cause', label: '원인', help: '왜 일어났을까?' },
  { key: 'fix', label: '조치', help: '실제로 뭘 해서 고쳤지?' },
  { key: 'prevent', label: '재발 방지', help: '다음엔 어떻게 막을까? (모두 좋은 생각이에요, 하나만!)' },
];

type Answers = Record<string, Record<Field, number | null>>;
const BLANK: Record<Field, number | null> = { cause: null, fix: null, prevent: null };

const CARD = 'postmortem';
const HOLD = 'hold';

/** Two incident cards per row on a wide window, one on a narrow one. */
const GRID: CSSProperties = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' };

const templateOf = (id: string) => id.slice(0, id.lastIndexOf(':'));
const reportOf = (id: string) => REPORTS.find((r) => r.template === templateOf(id));

const optionsOf = (r: Report, f: Field): string[] => (f === 'prevent' ? r.prevent : r[f].options);
const isWrong = (r: Report, f: Field, v: number | null): boolean => f !== 'prevent' && v !== null && v !== r[f].answer;

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function scenarioTitle(run: StageRun, id: string): string {
  return getStage(run.stage).scenarios.find((s) => s.id === id)?.title ?? id;
}

/** Incidents that happened this run, in the order they started. */
function fired(run: StageRun): ScenarioRuntime[] {
  return run.scenarios.filter((s) => s.activatedAt !== null).sort((a, b) => a.activatedAt! - b.activatedAt!);
}

/** What the board says when an incident never raised an alarm (it was fixed before the NMS saw it). */
function noAlarm(rt: ScenarioRuntime): string {
  if (rt.resolvedAt === null) return '경보 아직 없음';
  // Fixed the second it started: the player had prepared for it.
  return rt.resolvedAt - rt.activatedAt! <= 2 ? '경보 없음 (미리 대비해서 바로 해결)' : '경보 없음 (경보가 뜨기 전에 해결)';
}

/** "10:00:30 발생 → 10:00:44 확인 (MTTD 10초) → 10:00:52 해결 (MTTR 16초)". Clock = game time, MTTD/MTTR = real seconds. */
function timeline(run: StageRun, rt: ScenarioRuntime): string {
  const def = getStage(run.stage);
  const at = (t: number) => fmtClock(gameSec(def.clock, t), true);
  const start = rt.activatedAt!;
  const alarm = run.alarms.find((a) => a.scenarioId === rt.id);
  const ack = alarm?.ackAt ?? null;
  const parts = [`${at(start)} 발생`];
  parts.push(!alarm ? noAlarm(rt) : ack !== null ? `${at(ack)} 확인 (MTTD ${ack - start}초)` : '경보 확인(ACK) 안 함');
  parts.push(rt.resolvedAt !== null ? `${at(rt.resolvedAt)} 해결 (MTTR ${rt.resolvedAt - start}초)` : '아직 해결 안 됨');
  return parts.join(' → ');
}

export function PostmortemBoard() {
  const run = useGame((s) => s.run);
  if (!run) return null;
  if (!(HOLD in run.objectivesDone)) return <Waiting run={run} />;
  return <Write run={run} />;
}

function Waiting({ run }: { run: StageRun }) {
  const def = getStage(run.stage);
  const left = Math.max(0, stageAt(def.clock, '10:30:00') - run.ctx.stageTime);
  const list = fired(run);
  return (
    <ModalFrame title="설계 보드 · 장애 보고서" size="narrow">
      <div className="pmb-wait">
        <div className="pmb-wait-title">10:30 1차 마감 뒤에 작성해요</div>
        {left > 0 ? (
          <div className="pmb-timer">
            남은 시간 <b>{mmss(left)}</b>
          </div>
        ) : (
          <div className="pmb-timer ok">10:30은 지났어요! 남은 장애를 해결하면 보고서를 쓸 수 있어요.</div>
        )}
      </div>
      <ul className="pmb-status">
        {list.length === 0 && (
          <li>
            <span className="muted">아직 장애 없음</span>
          </li>
        )}
        {list.map((rt) => (
          <li key={rt.id}>
            <span>{scenarioTitle(run, rt.id)}</span>
            <span className={rt.state === 'resolved' ? 'ok' : 'bad'}>{rt.state === 'resolved' ? '✓ 해결' : '● 진행 중'}</span>
          </li>
        ))}
      </ul>
      <p className="muted pmb-wait-note">지금은 관제 화면(N)을 보며 장애부터 막아주세요. 보고서는 그다음!</p>
    </ModalFrame>
  );
}

function Write({ run }: { run: StageRun }) {
  // Picked answers, whether they were checked, the message and the summary page are kept for the day.
  const [answers, setAnswers] = useStageState<Answers>('postmortem:answers', {});
  const [checked, setChecked] = useStageState('postmortem:checked', false);
  const [msg, setMsg] = useStageState<string | null>('postmortem:msg', null);
  const [complete, setComplete] = useStageState('postmortem:complete', false);

  const all = fired(run);
  const main = all.flatMap((rt) => {
    const r = reportOf(rt.id);
    return r ? [{ rt, r }] : [];
  });
  const others = all.filter((rt) => !reportOf(rt.id));
  const get = (id: string) => answers[id] ?? BLANK;

  const pick = (id: string, f: Field, v: number) => {
    setAnswers((a) => ({ ...a, [id]: { ...(a[id] ?? BLANK), [f]: v } }));
    setMsg(null);
  };

  const check = () => {
    setChecked(true);
    const missing = main.some(({ rt }) => FIELDS.some((f) => get(rt.id)[f.key] === null));
    const wrong = main.some(({ rt, r }) => FIELDS.some((f) => isWrong(r, f.key, get(rt.id)[f.key])));
    if (wrong) return setMsg('빨간 칸을 다시 골라봐. 관제 화면에서 본 증상과, 네가 실제로 한 조치를 떠올려봐.');
    if (missing) return setMsg('아직 빈 칸이 있어. 장애마다 원인 · 조치 · 재발 방지를 하나씩 골라줘.');
    setMsg(null);
    setComplete(true);
  };

  // Filing the report is the day's last step: the board closes with it (the outro follows once no window is open).
  const submit = () => {
    const s = gameStore.getState();
    s.event('board:postmortem');
    if (s.modal?.type === 'board') s.closeModal();
  };

  const extras = others.map((rt) => (
    <span key={rt.id} className="tag">
      {scenarioTitle(run, rt.id)}: {timeline(run, rt)}
    </span>
  ));

  if (complete) {
    const score = scoreRun(run);
    // D-Day scores every second from the 10:00 open (StageDef.scoreAvailabilityFrom): the daily report's number.
    const avail = run.ticks > 0 ? score.availability : null;
    const fromOpen = getStage(run.stage).scoreAvailabilityFrom !== undefined;
    return (
      <ModalFrame
        title="설계 보드 · 장애 보고서"
        size="wide"
        footer={
          <>
            <button className="btn" onClick={() => setComplete(false)}>
              고치기
            </button>
            <button className="btn primary" onClick={submit}>
              보고서 제출
            </button>
          </>
        }
      >
        <div className="pmb-mentor is-ok">
          <Portrait who="mentor" size={32} />
          <p>
            <b>회고 완료!</b> 보고서는 누굴 혼내려는 게 아니라, 같은 장애를 두 번 겪지 않으려고 쓰는 거야. 제출하면 수강신청 운영 끝! 개념 카드{' '}
            <b>{CONCEPTS[CARD].name}</b>도 받을 수 있어.
          </p>
        </div>
        <div className="pmb-summary-head">
          <span className="tag">수강신청 당일 장애 보고서</span>
          {avail !== null && (
            <span className="tag">
              {fromOpen ? '10:00 오픈부터 ' : ''}평균 가용성 {(avail * 100).toFixed(1)}%
            </span>
          )}
          {score.mttd !== null && <span className="tag">평균 MTTD {Math.round(score.mttd)}초</span>}
          {score.mttr !== null && <span className="tag">평균 MTTR {Math.round(score.mttr)}초</span>}
          {extras}
        </div>
        <div className="pmb-summary" style={GRID}>
          {main.map(({ rt, r }) => {
            const a = get(rt.id);
            return (
              <div key={rt.id} className="pmb-sum-card">
                <div className="pmb-sum-title">{scenarioTitle(run, rt.id)}</div>
                <div className="pmb-sum-time">{timeline(run, rt)}</div>
                <dl>
                  <dt>원인</dt>
                  <dd>{r.cause.options[a.cause ?? 0]}</dd>
                  <dt>조치</dt>
                  <dd>{r.fix.options[a.fix ?? 0]}</dd>
                  <dt>재발 방지</dt>
                  <dd>{r.prevent[a.prevent ?? 0]}</dd>
                </dl>
              </div>
            );
          })}
        </div>
        <p className="pmb-todo">내용이 맞으면 "보고서 제출"을 눌러주세요.</p>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame
      title="설계 보드 · 장애 보고서 (Postmortem)"
      size="wide"
      footer={
        <>
          <span className={`pmb-foot-todo ${msg ? 'is-alert' : ''}`} role={msg ? 'alert' : undefined}>
            {msg ?? '장애마다 원인 · 조치 · 재발 방지를 골라주세요.'}
          </span>
          <button className="btn primary" onClick={check}>
            작성 완료
          </button>
        </>
      }
    >
      <p className="pmb-lead">
        10:30 1차 마감까지 버텼어요! 이제 <b>장애 보고서</b>를 써요. 경기 끝나고 보는 리플레이처럼, 무슨 일이 언제 왜 일어났고 어떻게 고쳤는지 남겨요.
        <br />
        <span className="muted">시각은 게임 시계, MTTD(경보 확인까지)·MTTR(해결까지)은 실제로 걸린 초예요.</span>
      </p>
      {extras.length > 0 && <div className="pmb-summary-head">{extras}</div>}
      <div className="pmb-incidents" style={GRID}>
        {main.map(({ rt, r }) => (
          <section key={rt.id} className="pmb-incident">
            <header>
              <div className="pmb-inc-title">{scenarioTitle(run, rt.id)}</div>
              <div className="pmb-inc-time">{timeline(run, rt)}</div>
            </header>
            {FIELDS.map((f) => {
              const v = get(rt.id)[f.key];
              return (
                <div key={f.key} className="pmb-field" role="radiogroup" aria-label={`${scenarioTitle(run, rt.id)} ${f.label}`}>
                  <div className="pmb-field-label">
                    <b>{f.label}</b> <span className="muted">{f.help}</span>
                  </div>
                  <div className="pmb-options">
                    {optionsOf(r, f.key).map((text, i) => {
                      const on = v === i;
                      const bad = checked && on && isWrong(r, f.key, v);
                      const empty = checked && v === null;
                      return (
                        <button
                          key={i}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className={['pmb-opt', on ? 'on' : '', bad ? 'is-bad' : '', empty ? 'empty' : ''].join(' ')}
                          onClick={() => pick(rt.id, f.key, i)}
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </ModalFrame>
  );
}
