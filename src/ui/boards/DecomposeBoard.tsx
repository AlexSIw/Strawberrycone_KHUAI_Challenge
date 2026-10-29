import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { decompose } from '../../sim/actions';
import type { AppService } from '../../sim/types';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { Portrait } from '../Portrait';
import { useStageState } from '../useStageState';
import './DecomposeBoard.css';

// Stage 4 design board: cut the monolith into services by business capability (not by layer).

interface Card {
  id: string;
  label: string;
  kind: 'feature' | 'layer';
}

const CARDS: Card[] = [
  { id: 'login', label: '로그인', kind: 'feature' },
  { id: 'course', label: '과목조회', kind: 'feature' },
  { id: 'cart', label: '장바구니', kind: 'feature' },
  { id: 'enroll', label: '수강신청', kind: 'feature' },
  { id: 'notify', label: '알림', kind: 'feature' },
  { id: 'ui', label: '화면(UI)', kind: 'layer' },
  { id: 'logic', label: '비즈니스 로직', kind: 'layer' },
  { id: 'db', label: '데이터베이스', kind: 'layer' },
];

const BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

const BOX_COUNT = 5;
const LAYER_MSG = '그건 기능이 아니라 층이야! 화면/로직/DB로 자르면 결국 다 같이 바뀌어.';

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function DecomposeBoard() {
  const app = useGame((s) => s.run?.world.app);
  if (!app) {
    return (
      <ModalFrame title="설계 보드" size="narrow">
        <p className="muted">오늘은 설계 보드를 쓰지 않아요.</p>
      </ModalFrame>
    );
  }
  if (app.arch === 'msa') return <ArchView services={app.services} />;
  // v2: splitting the monolith is D-3's own build mission (it opens after the SMS look), not a fix after a crash.
  return <Puzzle />;
}

// ---------- puzzle (monolith → services) ----------

type Spot = number | null; // box index, or null = still in the card pool
type Feedback = { tone: 'bad' | 'warn'; text: string; cards: string[] };

function Puzzle() {
  // Card order, placements, the last check's feedback and "solved" are kept for the stage.
  const [order] = useStageState<string[]>('decompose:order', () => shuffle(CARDS).map((c) => c.id));
  const [place, setPlace] = useStageState<Record<string, Spot>>('decompose:place', () => Object.fromEntries(CARDS.map((c) => [c.id, null])));
  const [feedback, setFeedback] = useStageState<Feedback | null>('decompose:feedback', null);
  const [solved, setSolved] = useStageState('decompose:solved', false);
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState<Spot | 'none'>('none');
  const cards = order.map((id) => BY_ID[id]);

  const move = (id: string, to: Spot) => {
    setPlace((p) => ({ ...p, [id]: to }));
    setSelected(null);
    setFeedback(null);
  };

  const inBox = (i: number) => cards.filter((c) => place[c.id] === i);
  const pool = cards.filter((c) => place[c.id] === null);

  const check = () => {
    const boxes = Array.from({ length: BOX_COUNT }, (_, i) => inBox(i));
    const layers = boxes.flat().filter((c) => c.kind === 'layer');
    if (layers.length) return setFeedback({ tone: 'bad', text: LAYER_MSG, cards: layers.map((c) => c.id) });
    const crowded = boxes.filter((b) => b.length > 1);
    if (crowded.length) {
      return setFeedback({
        tone: 'warn',
        text: '한 매장에 기능이 두 개 이상 들어갔어. 매장 하나 = 기능 하나! 그래야 하나가 고장 나도 나머지는 멀쩡해.',
        cards: crowded.flat().map((c) => c.id),
      });
    }
    const empty = boxes.filter((b) => b.length === 0).length;
    if (empty) {
      return setFeedback({ tone: 'warn', text: `아직 빈 매장이 ${empty}개 있어. 남은 "기능" 카드를 하나씩 넣어줘.`, cards: [] });
    }
    setFeedback(null);
    setSolved(true);
  };

  const apply = () => {
    const s = gameStore.getState();
    s.act(decompose, 'board:decompose');
    s.closeModal();
  };

  if (solved) {
    return (
      <ModalFrame
        title="설계 보드 · 서비스 분리"
        size="wide"
        footer={
          <>
            <button className="btn" onClick={() => setSolved(false)}>
              다시 배치하기
            </button>
            <button className="btn primary" onClick={apply}>
              이 설계로 분리하기
            </button>
          </>
        }
      >
        <MentorSays text="완벽해! 이제 큰 식당 하나가 아니라 매장 5개짜리 푸드코트야. 아래를 읽고 분리 버튼을 눌러." />
        <div className="dcb-done-grid">
          {CARDS.filter((c) => c.kind === 'feature').map((c) => (
            <div key={c.id} className="dcb-done-shop">
              <div className="dcb-done-name">{c.label}</div>
              <div className="dcb-db">{c.id}-db</div>
            </div>
          ))}
        </div>
        <ul className="dcb-explain">
          <li>
            <b>매장마다 자기 창고(DB)</b> — 각 서비스는 자기 데이터베이스만 써요. 남의 창고엔 들어가지 않아요.
          </li>
          <li>
            <b>대화는 카운터(API)로</b> — 수강신청이 과목 정보가 필요하면 과목조회 서비스에 API로 물어봐요.
          </li>
          <li>
            <b>"신청 완료" 방송</b> — 수강신청은 "신청 완료!"라고 라디오처럼 방송만 해요. 알림은 그 방송을 구독(subscribe)해서
            메일을 보내요. 이게 <b>pub-sub</b>! 알림이 죽어도 신청은 계속돼요.
          </li>
        </ul>
      </ModalFrame>
    );
  }

  /** Drop target + click target (a selected card goes here). Keyboard users get a real "여기에 놓기" button instead. */
  const spotProps = (to: Spot) => ({
    onClick: () => selected && move(selected, to),
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== to) setOver(to);
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      // Moving onto a child card also fires dragleave; only clear when the pointer really left the box.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver('none');
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setOver('none');
      const id = e.dataTransfer.getData('text/plain');
      if (Object.hasOwn(place, id)) move(id, to);
    },
  });

  /** Click a card: select it. With another card already selected, clicking a placed card drops the selected one into that box. */
  const clickCard = (c: Card) => {
    const at = place[c.id];
    if (selected && selected !== c.id && at !== null) return move(selected, at);
    setSelected((cur) => (cur === c.id ? null : c.id));
  };

  /** Shown in every box (and the pool) while a card is selected, so placing works without a mouse too. */
  const putButton = (to: Spot, label: string) =>
    selected && place[selected] !== to ? (
      <button
        type="button"
        className="dcb-put"
        onClick={(e) => {
          e.stopPropagation();
          move(selected, to);
        }}
      >
        {label}
      </button>
    ) : null;

  // A div (not <button>) so it can be dragged in every browser; Firefox won't drag a <button>.
  const cardEl = (c: Card) => (
    <div
      key={c.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected === c.id}
      draggable
      className={[
        'dcb-card',
        selected === c.id ? 'selected' : '',
        feedback?.cards.includes(c.id) ? `flag-${feedback.tone}` : '',
      ].join(' ')}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', c.id);
        e.dataTransfer.effectAllowed = 'move';
        setSelected(null);
      }}
      onDragEnd={() => setOver('none')}
      onClick={(e) => {
        e.stopPropagation();
        clickCard(c);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        clickCard(c);
      }}
      title="끌어서 매장에 놓거나, 클릭한 뒤 매장을 클릭하세요"
    >
      {c.label}
    </div>
  );

  return (
    <ModalFrame
      title="설계 보드 · 모놀리스 쪼개기"
      size="wide"
      footer={
        <>
          <span className="muted dcb-foot-note">카드를 다시 빼려면 카드 클릭 → 아래 카드 더미 클릭</span>
          <button className="btn primary" onClick={check}>
            설계 완료
          </button>
        </>
      }
    >
      <div className="dcb-now">
        <span className="tag">지금</span>
        <span>
          <b>모놀리스</b> = 주방 하나인 큰 식당. 로그인·과목조회·장바구니·수강신청·알림이 전부 한 덩어리라, 알림 하나가 터지면 다 멈춰요.
        </span>
      </div>
      <p className="dcb-todo">
        기능 카드를 끌어서 빈 매장(서비스)에 하나씩 넣어주세요. <span className="muted">(클릭 → 매장 클릭도 돼요)</span>
      </p>

      <div className="dcb-shops">
        {Array.from({ length: BOX_COUNT }, (_, i) => {
          const cards = inBox(i);
          return (
            <div
              key={i}
              className={`dcb-shop ${over === i ? 'over' : ''} ${selected ? 'armed' : ''}`}
              role="group"
              aria-label={`매장 ${i + 1}`}
              {...spotProps(i)}
            >
              <div className="dcb-shop-head">매장 {i + 1}</div>
              <div className="dcb-shop-body">
                {cards.length ? cards.map(cardEl) : <span className="dcb-empty">비어 있음</span>}
                {putButton(i, '여기에 놓기')}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={`dcb-pool ${over === null ? 'over' : ''} ${selected && place[selected] !== null ? 'armed' : ''}`}
        role="group"
        aria-label="카드 더미"
        {...spotProps(null)}
      >
        <div className="dcb-pool-head">
          카드 더미 {putButton(null, '↩ 더미로 되돌리기')}
        </div>
        <div className="dcb-pool-cards">{pool.length ? pool.map(cardEl) : <span className="dcb-empty">모든 카드를 배치했어요</span>}</div>
      </div>

      {feedback && <MentorSays text={feedback.text} tone={feedback.tone} />}
    </ModalFrame>
  );
}

function MentorSays({ text, tone }: { text: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`dcb-mentor ${tone ? `is-${tone}` : ''}`}>
      <Portrait who="mentor" size={44} />
      <p>{text}</p>
    </div>
  );
}

// ---------- read-only view after the split ----------

const VIEW_W = 1000;
const VIEW_H = 470;
const BOX_W = 230;
const BOX_H = 132;

/** Where each service sits on the whiteboard (box centers). */
const POS: Record<string, { x: number; y: number }> = {
  login: { x: 140, y: 92 },
  enroll: { x: 500, y: 92 },
  course: { x: 860, y: 92 },
  notify: { x: 500, y: 370 },
  cart: { x: 860, y: 370 },
};

const STATUS = {
  up: { label: '정상', color: 'var(--green)' },
  degraded: { label: '과부하', color: 'var(--amber)' },
  down: { label: '다운', color: 'var(--red-2)' },
} as const;

function posOf(name: string, i: number) {
  return POS[name] ?? { x: 140 + (i % 3) * 360, y: 92 + Math.floor(i / 3) * 278 };
}

/** Point where the ray from a box center towards (dx, dy) leaves the box, pushed out by `gap`. */
function edge(c: { x: number; y: number }, dx: number, dy: number, gap: number) {
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(dx ? BOX_W / 2 / Math.abs(dx) : Infinity, dy ? BOX_H / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
}

interface Link {
  key: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** db = flagged as wrong (red); dbPlain = the same access drawn neutrally while it is still the puzzle */
  kind: 'api' | 'db' | 'dbPlain' | 'pubsub';
  label: string;
}

function makeLink(key: string, a: { x: number; y: number }, b: { x: number; y: number }, kind: Link['kind'], label: string, offset: number): Link {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Shift parallel links sideways so they don't overlap.
  const ox = (-dy / len) * offset;
  const oy = (dx / len) * offset;
  const from = edge({ x: a.x + ox, y: a.y + oy }, dx, dy, 6);
  const to = edge({ x: b.x + ox, y: b.y + oy }, -dx, -dy, 10);
  return { key, from, to, kind, label };
}

function ArchView({ services }: { services: Record<string, AppService> }) {
  const status = useGame((s) => s.run?.health.services) ?? {};
  // Reading another service's DB is what s4-shared-db asks the player to notice. Until it is solved
  // (or its answer revealed) the board draws that access neutrally instead of flagging it in red.
  const flagForeignDb = useGame((s) => {
    const r = s.run;
    if (!r) return false;
    return r.revealed.includes('s4-shared-db') || r.scenarios.some((x) => x.id === 's4-shared-db' && x.state === 'resolved');
  });
  const list = Object.values(services);
  const at = new Map(list.map((s, i) => [s.name, posOf(s.name, i)]));

  const links: Link[] = [];
  for (const s of list) {
    for (const target of s.calls) {
      const a = at.get(s.name);
      const b = at.get(target);
      if (a && b) links.push(makeLink(`api-${s.name}-${target}`, a, b, 'api', 'API', 0));
    }
    for (const db of s.dbAccess) {
      const owner = db.replace(/-db$/, '');
      if (owner === s.name) continue;
      const a = at.get(s.name);
      const b = at.get(owner);
      if (a && b) {
        links.push(
          flagForeignDb ? makeLink(`db-${s.name}-${owner}`, a, b, 'db', '남의 DB', 28) : makeLink(`db-${s.name}-${owner}`, a, b, 'dbPlain', `${db} 읽기`, 28),
        );
      }
    }
  }
  const enroll = at.get('enroll');
  const notify = at.get('notify');
  if (enroll && notify) links.push(makeLink('pubsub', enroll, notify, 'pubsub', '"신청 완료" 방송', 0));

  const foreignDb = flagForeignDb && list.some((s) => s.dbAccess.some((d) => d !== `${s.name}-db`));

  return (
    <ModalFrame title="설계 보드 · 현재 구조 (MSA)" size="wide">
      <p className="dcb-todo">
        이미 기능별 서비스로 나눴어요. 이 그림은 보기 전용이고, 조치는 <b>관리 PC 터미널</b>에서 해요.
      </p>
      <div className="dcb-arch-wrap">
        <svg className="dcb-arch" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="서비스 구조도">
          <defs>
            <marker id="dcb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
            </marker>
            <marker id="dcb-arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--red-2)" />
            </marker>
            <marker id="dcb-arrow-pub" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--blue)" />
            </marker>
          </defs>

          {links.map((l) => {
            const mx = (l.from.x + l.to.x) / 2;
            const my = (l.from.y + l.to.y) / 2;
            const vertical = Math.abs(l.to.x - l.from.x) < Math.abs(l.to.y - l.from.y);
            const marker = l.kind === 'db' ? 'dcb-arrow-bad' : l.kind === 'pubsub' ? 'dcb-arrow-pub' : 'dcb-arrow';
            return (
              <g key={l.key} className={`dcb-link ${l.kind}`}>
                <line x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} markerEnd={`url(#${marker})`} />
                <text
                  x={vertical ? mx + 12 : mx}
                  y={vertical ? my + 5 : my - 9}
                  textAnchor={vertical ? 'start' : 'middle'}
                  className="dcb-link-label"
                >
                  {l.label}
                </text>
              </g>
            );
          })}

          {list.map((s, i) => {
            const p = posOf(s.name, i);
            const st = STATUS[status[s.name] ?? (s.up ? 'up' : 'down')];
            const x = p.x - BOX_W / 2;
            const y = p.y - BOX_H / 2;
            const own = `${s.name}-db`;
            return (
              <g key={s.name} className="dcb-svc">
                <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={12} className="dcb-svc-box" style={{ stroke: st.color }} />
                <text x={x + 16} y={y + 32} className="dcb-svc-name">
                  {s.label}
                </text>
                <rect x={x + BOX_W - 82} y={y + 14} width={68} height={26} rx={13} style={{ fill: st.color }} opacity={0.22} />
                <text x={x + BOX_W - 48} y={y + 32} textAnchor="middle" className="dcb-svc-status" style={{ fill: st.color }}>
                  {st.label}
                </text>
                <text x={x + 16} y={y + 64} className="dcb-svc-meta">
                  서버 ×{s.replicas}
                  {s.installing.length ? ` · 설치 중 ${s.installing.length}` : ''}
                </text>
                <text x={x + 16} y={y + 94} className="dcb-svc-db">
                  {own}
                </text>
                {s.dbAccess
                  .filter((d) => d !== own)
                  .map((d, k) => (
                    <text key={d} x={x + 16} y={y + 118 + k * 20} className={`dcb-svc-db ${flagForeignDb ? 'bad' : ''}`}>
                      {flagForeignDb ? `${d} 직접 읽는 중` : `${d} 사용`}
                    </text>
                  ))}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="dcb-legend">
        <span>
          <i className="dcb-key api" /> API 호출 (카운터에 주문)
        </span>
        <span>
          <i className="dcb-key pubsub" /> 방송 구독 (pub-sub): 알림은 "신청 완료"를 듣고 메일을 보내요
        </span>
        {foreignDb && (
          <span className="bad">
            <i className="dcb-key db" /> 남의 창고(DB)를 직접 읽는 중!
          </span>
        )}
      </div>
      <div className="dcb-legend">
        {Object.entries(STATUS).map(([k, v]) => (
          <span key={k}>
            <i className="dcb-dot" style={{ background: v.color }} /> {v.label}
          </span>
        ))}
      </div>
    </ModalFrame>
  );
}
