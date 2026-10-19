import { useState } from 'react';
import { CONCEPTS } from '../../content/concepts';
import { getStage } from '../../content/stages';
import type { StageRun } from '../../sim/engine';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { Portrait } from '../Portrait';
import './PostmortemBoard.css';

// Stage 7 design board: the postmortem (장애 보고서) written after the 수강신청 rush.

type IncidentId = 's7-traffic' | 's7-cable' | 's7-cooling';
type Field = 'cause' | 'fix' | 'prevent';

interface Incident {
  id: IncidentId;
  icon: string;
  cause: { options: string[]; answer: number };
  fix: { options: string[]; answer: number };
  /** Every idea is reasonable; the player just picks one. */
  prevent: string[];
}

const INCIDENTS: Incident[] = [
  {
    id: 's7-traffic',
    icon: '📈',
    cause: {
      options: ['DNS 장부에 신청 서버 이름이 빠져 있었다', '접속자(12,000 rps)에 비해 신청 pod 수가 부족했다', '신청 서비스 새 버전에 버그가 있었다'],
      answer: 1,
    },
    fix: {
      options: ['신청 pod 개수를 접속자에 맞게 늘렸다 (scale)', '이전 버전으로 되돌렸다 (rollback)', '신청 서버를 재부팅했다'],
      answer: 0,
    },
    prevent: ['오토스케일링: 접속자에 맞춰 pod 개수를 자동 조절', '수강신청 전날 pod를 미리 넉넉히 늘려두기', '부하 테스트로 필요한 pod 수를 미리 계산'],
  },
  {
    id: 's7-cable',
    icon: '🔌',
    cause: {
      options: ['n3가 과열돼서 스스로 꺼졌다', 'n3에 IP 주소 충돌이 났다', 'n3의 네트워크 케이블이 망가졌다 (L1 물리 계층)'],
      answer: 2,
    },
    fix: {
      options: ['n3의 pod를 전부 지웠다', '네트워크실 스위치에서 n3 케이블을 교체했다', '항온항습기를 수리했다'],
      answer: 1,
    },
    prevent: ['케이블 정리 · 라벨 붙이기', '노드마다 케이블 이중 연결 (링크 이중화)', '네트워크실 작업 전 공지 · 작업 기록 남기기'],
  },
  {
    id: 's7-cooling',
    icon: '🌡️',
    cause: {
      options: ['항온항습기(CRAC) 필터가 막혀 1·2번 랙이 뜨거워졌다', 'pod가 너무 많아서 CPU가 과열됐다', 'UPS 배터리가 방전됐다'],
      answer: 0,
    },
    fix: {
      options: ['pod 개수를 줄였다', '노드 n1·n2를 재부팅했다', '냉각실에서 항온항습기를 수리했다'],
      answer: 2,
    },
    prevent: ['냉각기 이중화 (예비 항온항습기)', '온도 알람: 30°C를 넘으면 바로 알림', '필터 정기 점검 일정 만들기'],
  },
];

const FIELDS: { key: Field; label: string; help: string }[] = [
  { key: 'cause', label: '원인', help: '왜 일어났을까?' },
  { key: 'fix', label: '해결', help: '실제로 뭘 해서 고쳤지?' },
  { key: 'prevent', label: '재발 방지', help: '다음엔 어떻게 막을까? (모두 좋은 생각이에요, 하나만!)' },
];

type Answers = Record<IncidentId, Record<Field, number | null>>;

const emptyAnswers = (): Answers =>
  Object.fromEntries(INCIDENTS.map((i) => [i.id, { cause: null, fix: null, prevent: null }])) as Answers;

const CARD = 'postmortem';

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function optionsOf(inc: Incident, f: Field): string[] {
  return f === 'prevent' ? inc.prevent : inc[f].options;
}

function isWrong(inc: Incident, f: Field, v: number | null): boolean {
  return f !== 'prevent' && v !== null && v !== inc[f].answer;
}

function scenarioTitle(run: StageRun, id: string): string {
  return getStage(run.stage).scenarios.find((s) => s.id === id)?.title ?? id;
}

function timeline(run: StageRun, id: string): string {
  const rt = run.scenarios.find((s) => s.id === id);
  if (!rt || rt.activatedAt === null) return '발생 안 함';
  // Times are counted from the moment 수강신청 opened (stage start).
  if (rt.resolvedAt === null) return `오픈 후 ${clock(rt.activatedAt)}에 발생 · 아직 해결 안 됨`;
  return `오픈 후 ${clock(rt.activatedAt)}에 발생 → ${clock(rt.resolvedAt)}에 해결 (${rt.resolvedAt - rt.activatedAt}초 걸림)`;
}

export function PostmortemBoard() {
  const run = useGame((s) => s.run);
  if (!run) return null;
  if (!('survive' in run.objectivesDone)) return <Waiting run={run} />;
  return <Report run={run} />;
}

function Waiting({ run }: { run: StageRun }) {
  const def = getStage(run.stage);
  const left = Math.max(0, (def.survive ?? 0) - run.ctx.stageTime);
  return (
    <ModalFrame title="설계 보드 · 장애 보고서" icon="📋" size="narrow">
      <div className="pmb-wait">
        <div className="pmb-wait-title">수강신청이 끝난 뒤에 작성해요</div>
        {left > 0 ? (
          <div className="pmb-timer">
            남은 시간 <b>{clock(left)}</b>
          </div>
        ) : (
          <div className="pmb-timer ok">시간은 다 버텼어요! 남은 장애만 해결하면 돼요.</div>
        )}
      </div>
      <ul className="pmb-status">
        {INCIDENTS.map((inc) => {
          const state = run.scenarios.find((s) => s.id === inc.id)?.state ?? 'waiting';
          return (
            <li key={inc.id}>
              <span>
                {inc.icon} {scenarioTitle(run, inc.id)}
              </span>
              <span className={state === 'resolved' ? 'ok' : state === 'active' ? 'bad' : 'muted'}>
                {state === 'resolved' ? '✅ 해결' : state === 'active' ? '🚨 진행 중' : '대기'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted pmb-wait-note">👉 지금은 대시보드를 보며 장애부터 막아주세요. 보고서는 그다음!</p>
    </ModalFrame>
  );
}

function Report({ run }: { run: StageRun }) {
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [checked, setChecked] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const pick = (id: IncidentId, f: Field, v: number) => {
    setAnswers((a) => ({ ...a, [id]: { ...a[id], [f]: v } }));
    setMsg(null);
  };

  const check = () => {
    setChecked(true);
    const missing = INCIDENTS.some((inc) => FIELDS.some((f) => answers[inc.id][f.key] === null));
    const wrong = INCIDENTS.some((inc) => FIELDS.some((f) => isWrong(inc, f.key, answers[inc.id][f.key])));
    if (wrong) return setMsg('빨간 칸을 다시 골라봐. 대시보드에서 본 증상과, 네가 실제로 한 조치를 떠올려봐.');
    if (missing) return setMsg('아직 빈 칸이 있어. 장애마다 원인 · 해결 · 재발 방지를 하나씩 골라줘.');
    setMsg(null);
    setComplete(true);
  };

  const submit = () => {
    gameStore.getState().event('board:postmortem');
  };

  if (complete) {
    const availability = run.ticks ? run.availabilitySum / run.ticks : 1;
    return (
      <ModalFrame
        title="설계 보드 · 장애 보고서"
        icon="📋"
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
          <Portrait who="mentor" size={44} />
          <p>
            <b>회고 완료!</b> 보고서는 누굴 혼내려는 게 아니라, 같은 장애를 두 번 겪지 않으려고 쓰는 거야. 제출하면 수강신청 운영 끝! 📖 개념 카드{' '}
            <b>{CONCEPTS[CARD].name}</b>도 받아요.
          </p>
        </div>
        <div className="pmb-summary-head">
          <span className="tag">📄 본 수강신청 장애 보고서</span>
          <span className="tag">평균 가용성 {(availability * 100).toFixed(1)}%</span>
        </div>
        <div className="pmb-summary">
          {INCIDENTS.map((inc) => {
            const a = answers[inc.id];
            return (
              <div key={inc.id} className="pmb-sum-card">
                <div className="pmb-sum-title">
                  {inc.icon} {scenarioTitle(run, inc.id)}
                </div>
                <div className="pmb-sum-time">{timeline(run, inc.id)}</div>
                <dl>
                  <dt>원인</dt>
                  <dd>{inc.cause.options[a.cause ?? 0]}</dd>
                  <dt>해결</dt>
                  <dd>{inc.fix.options[a.fix ?? 0]}</dd>
                  <dt>재발 방지</dt>
                  <dd>{inc.prevent[a.prevent ?? 0]}</dd>
                </dl>
              </div>
            );
          })}
        </div>
        <p className="pmb-todo">👉 내용이 맞으면 "보고서 제출"을 눌러주세요.</p>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame
      title="설계 보드 · 장애 보고서 (Postmortem)"
      icon="📋"
      size="wide"
      footer={
        <>
          <span className={`pmb-foot-todo ${msg ? 'is-alert' : ''}`} role={msg ? 'alert' : undefined}>
            {msg ? `⚠️ ${msg}` : '👉 장애마다 원인 · 해결 · 재발 방지를 골라주세요.'}
          </span>
          <button className="btn primary" onClick={check}>
            작성 완료
          </button>
        </>
      }
    >
      <p className="pmb-lead">
        수강신청을 끝까지 버텼어요! 이제 <b>장애 보고서</b>를 써요. 경기 끝나고 보는 리플레이처럼, 무슨 일이 왜 일어났고 어떻게 고쳤는지 남겨요.
      </p>
      <div className="pmb-incidents">
        {INCIDENTS.map((inc) => (
          <section key={inc.id} className="pmb-incident">
            <header>
              <div className="pmb-inc-title">
                {inc.icon} {scenarioTitle(run, inc.id)}
              </div>
              <div className="pmb-inc-time">{timeline(run, inc.id)}</div>
            </header>
            {FIELDS.map((f) => {
              const v = answers[inc.id][f.key];
              return (
                <div key={f.key} className="pmb-field" role="radiogroup" aria-label={`${scenarioTitle(run, inc.id)} ${f.label}`}>
                  <div className="pmb-field-label">
                    <b>{f.label}</b> <span className="muted">{f.help}</span>
                  </div>
                  <div className="pmb-options">
                    {optionsOf(inc, f.key).map((text, i) => {
                      const on = v === i;
                      const bad = checked && on && isWrong(inc, f.key, v);
                      const empty = checked && v === null;
                      return (
                        <button
                          key={i}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className={['pmb-opt', on ? 'on' : '', bad ? 'is-bad' : '', empty ? 'empty' : ''].join(' ')}
                          onClick={() => pick(inc.id, f.key, i)}
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
