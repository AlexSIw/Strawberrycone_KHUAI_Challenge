// End-to-end measures the days build their health and incident checks from. WP1 owns this file.
import type { World } from '../types';
import { own } from '../util';
import { addressOf } from './basics';
import { delivery, utilization } from './load';
import { dnsServerFor, reach, reachFromClients, resolve, type ReachFailure } from './reach';
import { dhcpShare, lbShares, lbView, studentFw } from './services';
import { withNetMemo } from './topo';

export interface PathReport {
  /** Share of requests that get through, 0..1 */
  ok: number;
  /** Symptom notes in plain Korean for the SMS / dashboard (never the cause) */
  notes: string[];
  /** Why it fails outright, for checks and tests (never shown to players) */
  failure?: ReachFailure;
}

/** A link this busy makes pages slow. */
const SLOW_UTIL = 0.9;
const slow = (w: World, links: string[]) => links.some((k) => utilization(w, k) > SLOW_UTIL);

/**
 * Students on the internet → 수강신청: public VIP → firewall → L4 (active unit) → a healthy pool member
 * that is listening, with link loads and degraded cables priced in. The students come evenly from
 * STUDENT_BLOCKS, and a firewall rule that catches a block (or part of one) turns that share away. A full
 * L4 session table refuses the excess. (App capacity — pods × POD_RPS — is the day's health function's
 * business.)
 */
export function studentDelivery(w: World): PathReport {
  return withNetMemo(w, () => {
    const lb = w.net?.lb;
    const down = (failure?: ReachFailure): PathReport => ({ ok: 0, notes: ['수강신청 사이트가 열리지 않아요'], failure });
    if (!lb) return down('no_route');
    const fw = studentFw(w);
    if (!fw.allowIp) return down('fw_deny');
    // The path in is the same for every student the firewall lets through.
    const r = reach(w, 'internet', lb.publicIp, { srcIp: fw.allowIp, port: lb.port });
    if (!r.ok) return down(r.failure);
    const view = lbView(w);
    let ok = 0;
    let busy = slow(w, r.links);
    for (const { member, share } of lbShares(w, view)) {
      const ip = addressOf(w, member.host).ip;
      const m = ip && view.active ? reach(w, view.active, ip, { port: member.port }) : null;
      if (!m?.ok) continue;
      ok += share * delivery(w, [...r.links, ...m.links]);
      busy ||= slow(w, m.links);
    }
    if (view.over && view.demand > 0) ok *= (w.net!.lb!.maxConn / view.demand);
    ok *= fw.allowed;
    if (ok <= 0) return down('no_route');
    const notes: string[] = [];
    if (ok < 0.99) notes.push('수강신청 접속이 일부 실패해요');
    if (busy) notes.push('수강신청 응답이 느려요');
    return { ok, notes };
  });
}

/** Campus client groups: share that got a DHCP address and can reach the internet. */
export function campusDelivery(w: World): PathReport {
  return withNetMemo(w, () => {
    const groups = Object.entries(w.net?.clients ?? {});
    const total = groups.reduce((a, [, c]) => a + c.count, 0);
    if (!total) return { ok: 1, notes: [] };
    let sum = 0;
    const notes: string[] = [];
    for (const [id, c] of groups) {
      const addressed = dhcpShare(w, id);
      const r = reachFromClients(w, id);
      const ok = addressed * (r.ok ? 1 - r.loss : 0);
      sum += ok * c.count;
      if (ok <= 0) notes.push(`${c.label}: 인터넷이 안 돼요`);
      else if (addressed < 0.99) notes.push(`${c.label}: 일부 기기가 네트워크에 못 붙어요`);
      else if (ok < 0.99) notes.push(`${c.label}: 인터넷이 자꾸 끊겨요`);
    }
    return { ok: sum / total, notes };
  });
}

/** One host → another by name (DNS included), e.g. web → db. */
export function hostDelivery(w: World, from: string, to: string): PathReport {
  return withNetMemo(w, () => {
    const label = (id: string) => own(w.devices, id)?.label ?? id;
    const res = resolve(w, to, from);
    if (!res.ip) {
      // DNS is up but this host can't reach it: report the host's own network problem, not "DNS down".
      const up = res.failure === 'dns_down' ? dnsServerFor(w) : null;
      const why = up ? (reach(w, from, addressOf(w, up).ip!).failure ?? res.failure) : res.failure;
      return { ok: 0, notes: [`${label(from)}에서 ${to}(으)로 연결이 안 돼요`], failure: why };
    }
    const r = reach(w, from, res.ip);
    if (!r.ok) return { ok: 0, notes: [`${label(from)}에서 ${label(to)}(으)로 연결이 안 돼요`], failure: r.failure };
    const ok = 1 - r.loss;
    return { ok, notes: ok < 0.99 ? [`${label(from)} → ${label(to)} 연결이 불안정해요`] : [], failure: r.failure };
  });
}
