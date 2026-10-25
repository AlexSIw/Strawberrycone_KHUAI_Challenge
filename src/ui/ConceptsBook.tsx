import { CONCEPTS } from '../content/concepts';
import { FIRST_STAGE } from '../content/cards';
import { STAGES } from '../content/stages';
import { useGame } from '../store/game';
import { ModalFrame } from './ModalFrame';
import './ConceptsBook.css';

// 개념 도감: every concept card; collected ones are readable, the rest stay locked.


export function ConceptsBook() {
  const cards = useGame((s) => s.save.cards);
  const all = Object.values(CONCEPTS);
  const owned = new Set(cards);
  const count = all.filter((c) => owned.has(c.id)).length;

  return (
    <ModalFrame title="개념 도감" icon="📖" size="wide">
      <div className="cbk-top">
        <p className="cbk-todo">👉 장애를 해결할 때마다 개념 카드가 하나씩 모여요. <kbd>C</kbd> 키로 언제든 열 수 있어요.</p>
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
          if (!owned.has(c.id)) {
            const st = FIRST_STAGE[c.id];
            const where = st === undefined ? '게임 어딘가에서' : `${STAGES[st].label} · ${STAGES[st].title}에서`;
            return (
              <div key={c.id} className="cbk-card locked" aria-label="잠긴 카드">
                <div className="cbk-no">{no}</div>
                <div className="cbk-lock" aria-hidden>
                  🔒
                </div>
                <div className="cbk-name">???</div>
                <div className="cbk-where">{where} 얻을 수 있어요</div>
              </div>
            );
          }
          return (
            <article key={c.id} className="cbk-card">
              <div className="cbk-no">{no}</div>
              <h3 className="cbk-name">{c.name}</h3>
              <div className="cbk-analogy">
                <span className="cbk-label">🧩 비유</span>
                {c.analogy}
              </div>
              <p className="cbk-def">{c.definition}</p>
            </article>
          );
        })}
      </div>
    </ModalFrame>
  );
}
