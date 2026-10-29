// FMS: the facilities (power and cooling), read-only. Fixing them is the facility team's job; ours is to
// watch and tell them.
import { useState } from 'react';
import type { StageRun } from '../../sim/engine';
import type { World } from '../../sim/types';
import { gameStore } from '../../store/game';
import { levelOf, LEVEL_TEXT, Section } from '../Dashboard';
import { facilityView, isFacilityDevice, PDU_AMPS, placeName } from './facility';

type Tone = 'ok' | 'warn' | 'bad';

function Gauge({ label, value, pct, tone, sub }: { label: string; value: string; pct?: number; tone: Tone; sub?: string }) {
  return (
    <div className={`fms-gauge ${tone}`}>
      <span className="fms-label">{label}</span>
      <b className="fms-value">{value}</b>
      {pct !== undefined && (
        <span className={`sms-meter ${tone}`} aria-hidden>
          <i style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
        </span>
      )}
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}

const loadTone = (pct: number): Tone => (pct > 0.9 ? 'bad' : pct > 0.7 ? 'warn' : 'ok');

export function PowerGauges({ w, only }: { w: World; only?: 'ups' | 'pdu' }) {
  const f = facilityView(w);
  return (
    <div className="fms-gauges">
      {!only && <Gauge label="한전 수전 (바깥 전기)" value={f.mains ? '● 정상' : '✕ 정전'} tone={f.mains ? 'ok' : 'bad'} />}
      {only !== 'pdu' && (
        <>
          <Gauge label="UPS 부하" value={`${Math.round(f.ups.loadPct * 100)}%`} pct={f.ups.loadPct} tone={loadTone(f.ups.loadPct)} sub="UPS가 감당하는 전기의 양" />
          <Gauge
            label="UPS 배터리"
            value={`${f.ups.batteryPct}%`}
            pct={f.ups.batteryPct / 100}
            tone={f.ups.onBattery ? 'warn' : 'ok'}
            sub={f.ups.onBattery ? '배터리로 버티는 중' : '충전 완료 · 대기'}
          />
        </>
      )}
      {!only && (
        <Gauge
          label="비상 발전기"
          value={f.generator === 'standby' ? '대기' : '가동 중'}
          tone={f.generator === 'standby' ? 'ok' : 'warn'}
          sub={f.generator === 'standby' ? '정전이 길어지면 켜져요' : '정전이라 전기를 만들고 있어요'}
        />
      )}
      {only !== 'ups' &&
        (['A', 'B'] as const).map((k) => {
          const p = f.pdu[k];
          return (
            <Gauge
              key={k}
              label={`PDU ${k} 전류`}
              value={p.tripped ? '✕ 차단기 내려감' : !p.live ? '✕ 전기 없음' : `${p.amps.toFixed(1)} A`}
              pct={p.live ? p.pct : 0}
              tone={p.tripped || !p.live ? 'bad' : loadTone(p.pct)}
              sub={`${k === 'A' ? 'UPS를 거쳐 오는 줄' : '바깥 전기에서 바로 오는 줄'} · 한도 ${PDU_AMPS} A`}
            />
          );
        })}
    </div>
  );
}

export function CoolingGauges({ w }: { w: World }) {
  const f = facilityView(w);
  return (
    <div className="fms-gauges">
      {f.crac !== null && <Gauge label="항온항습기 (CRAC)" value={f.crac ? '● 정상 가동' : '✕ 멈춤'} tone={f.crac ? 'ok' : 'bad'} sub={`담당 랙: ${(w.cooling?.cracRacks ?? []).map(placeName).join(', ')}`} />}
      {f.racks.map((r) => {
        const lv = r.cut ? 'bad' : levelOf('temp', r.temp);
        return (
          <Gauge
            key={r.rack}
            label={placeName(r.rack)}
            value={r.cut ? '✕ 전원 차단' : `${r.temp.toFixed(1)}°C`}
            pct={(r.temp - 20) / 40}
            tone={lv}
            sub={`습도 ${r.humidity}% · ${LEVEL_TEXT[lv]}`}
          />
        );
      })}
    </div>
  );
}

export function FmsTab({ run }: { run: StageRun }) {
  const w = run.world;
  const f = facilityView(w);
  const [sent, setSent] = useState<string | null>(null);
  const facilityAlarms = run.alarms.filter((a) => a.clearedAt === null && isFacilityDevice(a.device));
  // Racks whose power the facility cut (a fire: the suppression went off): a facility event in its own right.
  const cut = w.power?.racksDown ?? [];
  const events = facilityAlarms.length + cut.length;

  const notify = () => {
    const s = gameStore.getState();
    for (const a of facilityAlarms) if (a.ackAt === null) s.ackAlarm(a.id);
    s.event('fms:notify');
    setSent(events ? `시설팀에 알렸어요. (시설 경보 ${events}건)` : '시설팀에 알렸어요. 지금 울리는 시설 경보는 없어요.');
  };

  return (
    <div className="fms">
      <p className="fms-note">시설은 시설팀 담당이에요. 우리는 지켜보고, 이상하면 알려요.</p>
      {cut.length > 0 && (
        <div className="fms-gauges fms-alert" role="alert">
          {cut.map((r) => (
            <Gauge
              key={r}
              label={r.startsWith('net') ? `${placeName(r)} 화재` : placeName(r)}
              value="✕ 전원 차단"
              tone="bad"
              sub={r.startsWith('net') ? '화재 감지 → 자동 소화 설비 작동 · 랙 전원 차단 (시설팀이 점검 후 복구)' : '랙 전원 차단 (시설팀이 점검 후 복구)'}
            />
          ))}
        </div>
      )}
      <div className="dash-grid">
        <Section title="전기 (Power)" hint="한전 → UPS(배터리) → PDU(랙 멀티탭) 순서로 전기가 와요. B줄은 UPS를 거치지 않아요. 막대가 길수록 많이 쓰는 중이에요.">
          <PowerGauges w={w} />
        </Section>
        <Section title="냉각 (Cooling)" hint="서버는 더위에 약해요. 35°C를 넘으면 주의, 45°C를 넘으면 위험이에요." half>
          <CoolingGauges w={w} />
        </Section>
        <Section title="인입 회선 (Internet lines)" hint="학교 밖 인터넷과 이어진 두 줄이에요. 하나가 끊겨도 다른 줄로 버텨요." half>
          <div className="fms-gauges">
            {f.isp.map((l) => (
              <Gauge key={l.id} label={l.label} value={l.up ? '● 연결' : '✕ 끊김'} tone={l.up ? 'ok' : 'bad'} />
            ))}
          </div>
        </Section>
      </div>
      <div className="fms-actions">
        <button className="btn primary" onClick={notify}>
          시설팀 통보
        </button>
        <span className="muted">{sent ?? (events ? `시설 경보 ${events}건이 울리고 있어요.` : '시설에서 온 경보는 없어요.')}</span>
      </div>
    </div>
  );
}
