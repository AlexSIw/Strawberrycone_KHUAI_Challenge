import { useMemo } from 'react';
import { cardAccess, FIRST_STAGE } from '../content/cards';
import { CONCEPTS } from '../content/concepts';
import { STAGES } from '../content/stages';
import { incidentSpoilers, useGame } from '../store/game';
import { ModalFrame } from './ModalFrame';
import { PixelIcon } from './PixelIcon';
import './ConceptsBook.css';

// 개념 도감: every concept card. Collected ones are readable; so are the ones whose day has come (first met on an
// earlier day, or taught by today's missions) as '아직 못 받은 카드 · 미리 읽기'. Later days' cards stay locked,
// and so do the cards of today's incidents not solved yet (they would give the cause away).

export function ConceptsBook() {
  const cards = useGame((s) => s.save.cards);
  const run = useGame((s) => s.run);
  const unlocked = useGame((s) => s.save.unlocked);
  const day = run?.stage ?? unlocked;
  const spoilers = useMemo(() => (run ? incidentSpoilers(run) : new Set<string>()), [run]);
  const all = Object.values(CONCEPTS);
  const owned = new Set(cards);
  const count = all.filter((c) => owned.has(c.id)).length;
  const where = (id: string) => {
    const st = FIRST_STAGE[id];
    return st === undefined ? '게임 어딘가에서' : `${STAGES[st].label} · ${STAGES[st].title}에서`;
  };

  return (
    <ModalFrame title="개념 도감" size="wide">
      <div className="cbk-top">
        <p className="cbk-todo">
          미션을 끝내고 장애를 해결할 때마다 개념 카드가 하나씩 모여요. <kbd>C</kbd> 키로 언제든 열 수 있어요.
          <br />
          <span className="muted">아직 못 받은 카드도 오늘까지 배울 내용이면 미리 읽을 수 있어요. 일부 카드는 그날 운에 따라 생기는 장애에서 나와요.</span>
        </p>
        <div className="cbk-count" aria-label={`${all.length}개 중 ${count}개 수집`}>
          <span className="cbk-count-num">
            {count} / {all.length} 수집
          </span>
          <span className="cbk-bar">
            <span style={{ width: `${(count / Math.max(1, all.length)) * 100}%` }} />
          </span>
        </div>
      </div>

      <div className="cbk-grid">
        {all.map((c, i) => {
          const no = `No.${String(i + 1).padStart(2, '0')}`;
          const access = cardAccess(c.id, day, owned, spoilers);
          if (access === 'locked') {
            return (
              <div key={c.id} className="cbk-card locked" aria-label="잠긴 카드">
                <div className="cbk-no">{no}</div>
                <div className="cbk-lock">
                  <PixelIcon name="lock" scale={4} />
                </div>
                <div className="cbk-name">???</div>
                <div className="cbk-where">{where(c.id)} 얻을 수 있어요</div>
              </div>
            );
          }
          const ahead = access === 'ahead';
          return (
            <article key={c.id} className={`cbk-card ${ahead ? 'ahead' : ''}`} aria-label={ahead ? `${c.name} (아직 못 받은 카드)` : c.name}>
              <div className="cbk-no">{no}</div>
              {ahead && <div className="cbk-ahead-tag">아직 못 받은 카드 · 미리 읽기</div>}
              <h3 className="cbk-name">{c.name}</h3>
              <div className="cbk-analogy">
                <span className="cbk-label">비유</span>
                {c.analogy}
              </div>
              <p className="cbk-def">{c.definition}</p>
              {ahead && <div className="cbk-where">{where(c.id)} 받을 수 있어요</div>}
            </article>
          );
        })}
      </div>
    </ModalFrame>
  );
}
