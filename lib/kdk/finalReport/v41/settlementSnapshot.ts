// TEYEON FINAL REPORT V4.1 — 회원 전용 벌금 정산 스냅샷(순수 계산 · 네트워크 · DB 미사용).
//
//   입력: get_kdk_final_report_v41_context().settlement(공식 settlement_data 원형 · 회원 청구 · 게스트 납부 · 확인 기록).
//   출력: 발행 시점 스냅샷 — 이름 · 청구액 · 납부액 · 상태만(내부 id · 이메일 · 계좌 없음). SQL kdk_fr_settlement_problem 과 같은 규칙.
//
//   상태(상위):
//     PAID    = 실제 납부 확인
//     UNPAID  = 회원: Finance 공식 청구 + 납부 0 또는 일부(잔액) / 게스트: 참가자별 미납 확인 기록이 유효할 때만
//     PENDING = 재무 확인 중(미등록 · 연결 필요 · 금액 불일치 · 게스트 확인 전)
//     REVIEW  = 대상 또는 금액을 확인할 수 없음 → 금액 표시 · 확정 집계에서 제외
//   항등식: 청구 = 납부 + 미납 확정 + 확인 중(REVIEW 제외).
//
//   정산 공개 기준일(liveFrom)은 코드에 고정하지 않는다 — 운영자 승인 후 DB 설정(kdk_final_report_settings)으로만 정한다.
//     · 미설정 · 회차 날짜 확인 불가 → 'unconfigured'(금액 · 명단 없음 · 단정하지 않음)
//     · 기준일 이전 회차 → 'legacy_closed'(운영 확인: 수납 완료 · 개인 행 · 금액 없음)
//     · 기준일 이후 회차 → 실제 Finance · 게스트 납부 · 확인 기록
//   DB 에 없는 개별 납부 증빙을 만들지 않고, 과거 미연결 · 기록 차이를 미납으로 표시하지 않는다.

export const FR_SETTLEMENT_MAX_ROWS = 300;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SettlementStatus = 'PAID' | 'UNPAID' | 'PENDING' | 'REVIEW';
export type SettlementMode = 'live' | 'legacy_closed' | 'not_ready' | 'none' | 'unconfigured';
export type SettlementNote =
  | 'partial' | 'unregistered' | 'needs_link' | 'finance_unlinked' | 'amount_mismatch' | 'duplicate'
  | 'awaiting_review' | 'unidentified' | 'invalid_flag' | 'invalid_amount' | 'name_missing' | null;

export interface SettlementRow { name: string; guest: boolean; status: SettlementStatus; charged: number; paid: number; note: SettlementNote }
export interface SettlementTotals { charged: number; paid: number; unpaid: number; pending: number }
export interface SettlementCounts { targets: number; paid: number; unpaid: number; pending: number; review: number }
export interface SettlementSnapshot {
  schema: '1';
  mode: SettlementMode;
  rows: SettlementRow[];
  totals: SettlementTotals;
  counts: SettlementCounts;
  /** 면제 · 대상 아님으로 목록에서 뺀 회원 수(운영 정보 · 금액 없음). */
  excluded: number;
}

export interface SettlementSource {
  hasData: boolean;
  items: Array<{ playerId?: unknown; name?: unknown; isGuest?: unknown; penalty?: unknown }>;
  memberIds: unknown[];
  financeLinkAvailable: boolean;
  receivables: Array<{ memberId?: unknown; amountDue?: unknown; status?: unknown; paid?: unknown }>;
  guestTableAvailable: boolean;
  guestPayments: Array<{ participantId?: unknown; status?: unknown; amount?: unknown; paidAt?: unknown; cancelledAt?: unknown; updatedAt?: unknown }>;
  reviews: Array<{ participantId?: unknown; decision?: unknown; officialAmount?: unknown; reviewedAt?: unknown }>;
}

const intOf = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^-?\d{1,9}(\.0+)?$/.test(v.trim())) return Math.trunc(Number(v.trim()));
  return null;
};
const idOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const timeOf = (v: unknown): number => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };
const nameOf = (v: unknown, guest: boolean): string => {
  const base = (typeof v === 'string' ? v : '').replace(/^manual-guest-/i, '').replace(/\s*\(G\)\s*$/i, '').replace(/\s+g$/i, '').trim().slice(0, 30);
  return base ? (guest ? `${base}(G)` : base) : '';
};

const empty = (mode: SettlementMode): SettlementSnapshot => ({
  schema: '1', mode, rows: [], totals: { charged: 0, paid: 0, unpaid: 0, pending: 0 }, counts: { targets: 0, paid: 0, unpaid: 0, pending: 0, review: 0 }, excluded: 0,
});

export function settlementModeFor(sessionDate: string, src: Pick<SettlementSource, 'hasData'>, liveFrom: string | null | undefined): SettlementMode | null {
  if (!liveFrom || !ISO_DATE.test(liveFrom) || !ISO_DATE.test(sessionDate)) return 'unconfigured';
  if (sessionDate < liveFrom) return 'legacy_closed';
  if (!src.hasData) return 'not_ready';
  return null;
}

export function buildSettlementSnapshot(sessionDate: string, src: SettlementSource, liveFrom: string | null | undefined): SettlementSnapshot {
  const pre = settlementModeFor(sessionDate, src, liveFrom);
  if (pre) return empty(pre);

  const memberIds = new Set((src.memberIds || []).map(idOf).filter(Boolean));
  const recvByMember = new Map<string, SettlementSource['receivables']>();
  for (const r of src.receivables || []) { const k = idOf(r.memberId); if (k) recvByMember.set(k, [...(recvByMember.get(k) || []), r]); }
  const payByGuest = new Map<string, SettlementSource['guestPayments']>();
  for (const p of src.guestPayments || []) { const k = idOf(p.participantId); if (k) payByGuest.set(k, [...(payByGuest.get(k) || []), p]); }
  const reviewsByGuest = new Map<string, SettlementSource['reviews']>();
  for (const r of src.reviews || []) { const k = idOf(r.participantId); if (k) reviewsByGuest.set(k, [...(reviewsByGuest.get(k) || []), r]); }

  // 같은 참가자 id 가 두 번 이상 나오면 어느 쪽도 확정하지 않는다.
  const idCount = new Map<string, number>();
  for (const it of src.items || []) { const k = idOf(it.playerId); if (k) idCount.set(k, (idCount.get(k) || 0) + 1); }

  const rows: SettlementRow[] = [];
  let excluded = 0;
  const review = (name: string, guest: boolean, note: SettlementNote): SettlementRow => ({ name: name || '이름 확인 필요', guest, status: 'REVIEW', charged: 0, paid: 0, note });

  for (const it of src.items || []) {
    const rawPen = intOf(it.penalty);
    if (rawPen === null) {
      if (it.penalty === undefined || it.penalty === null || it.penalty === 0) continue; // 벌금 없음
      rows.push(review(nameOf(it.name, it.isGuest === true), it.isGuest === true, 'invalid_amount'));
      continue;
    }
    if (rawPen >= 0) continue; // 벌금 아님(0 · 양수)
    const pen = -rawPen;
    if (typeof it.isGuest !== 'boolean') { rows.push(review(nameOf(it.name, false), false, 'invalid_flag')); continue; }
    const guest = it.isGuest;
    const name = nameOf(it.name, guest);
    const pid = idOf(it.playerId);
    if (!name) { rows.push(review('', guest, 'name_missing')); continue; }
    if (!pid) { rows.push(review(name, guest, 'unidentified')); continue; }
    if ((idCount.get(pid) || 0) > 1) { rows.push(review(name, guest, 'duplicate')); continue; }

    if (!guest) {
      const pending = (note: SettlementNote): SettlementRow => ({ name, guest, status: 'PENDING', charged: pen, paid: 0, note });
      if (!memberIds.has(pid)) { rows.push(pending('needs_link')); continue; }
      if (!src.financeLinkAvailable) { rows.push(pending('finance_unlinked')); continue; }
      const recv = recvByMember.get(pid) || [];
      if (recv.length === 0) { rows.push(pending('unregistered')); continue; }
      if (recv.length > 1) { rows.push(pending('duplicate')); continue; }
      const r = recv[0];
      const st = typeof r.status === 'string' ? r.status : '';
      if (st === 'exempt' || st === 'not_target') { excluded += 1; continue; }
      const due = intOf(r.amountDue);
      if (due === null || due !== pen) { rows.push(pending('amount_mismatch')); continue; }
      const paidRaw = typeof r.paid === 'number' ? r.paid : Number(r.paid);
      const paidAmt = Number.isFinite(paidRaw) && paidRaw > 0 ? Math.floor(paidRaw) : 0;
      if (paidAmt >= pen) rows.push({ name, guest, status: 'PAID', charged: pen, paid: pen, note: null });
      else rows.push({ name, guest, status: 'UNPAID', charged: pen, paid: paidAmt, note: paidAmt > 0 ? 'partial' : null });
      continue;
    }

    // 게스트: 납부 기록 · 참가자별 확인 기록
    if (!src.guestTableAvailable) { rows.push({ name, guest, status: 'PENDING', charged: pen, paid: 0, note: 'awaiting_review' }); continue; }
    const pays = payByGuest.get(pid) || [];
    const paid = pays.filter((p) => p.status === 'paid');
    if (paid.length > 0) {
      if (paid.length === 1 && intOf(paid[0].amount) === pen) rows.push({ name, guest, status: 'PAID', charged: pen, paid: pen, note: null });
      else rows.push(review(name, guest, 'amount_mismatch'));
      continue;
    }
    const lastPayChange = Math.max(0, ...pays.flatMap((p) => [timeOf(p.paidAt), timeOf(p.cancelledAt), timeOf(p.updatedAt)]));
    const evs = [...(reviewsByGuest.get(pid) || [])].sort((a, b) => timeOf(a.reviewedAt) - timeOf(b.reviewedAt));
    const last = evs[evs.length - 1];
    const confirmed = !!last && last.decision === 'unpaid_confirmed' && intOf(last.officialAmount) === pen && timeOf(last.reviewedAt) > lastPayChange;
    rows.push(confirmed
      ? { name, guest, status: 'UNPAID', charged: pen, paid: 0, note: null }
      : { name, guest, status: 'PENDING', charged: pen, paid: 0, note: 'awaiting_review' });
  }

  if (rows.length === 0) return { ...empty('none'), excluded };
  return finalize(rows.slice(0, FR_SETTLEMENT_MAX_ROWS), excluded);
}

function finalize(rows: SettlementRow[], excluded: number): SettlementSnapshot {
  const totals: SettlementTotals = { charged: 0, paid: 0, unpaid: 0, pending: 0 };
  const counts: SettlementCounts = { targets: 0, paid: 0, unpaid: 0, pending: 0, review: 0 };
  for (const r of rows) {
    if (r.status === 'REVIEW') { counts.review += 1; continue; }
    counts.targets += 1;
    totals.charged += r.charged;
    if (r.status === 'PAID') { counts.paid += 1; totals.paid += r.paid; }
    else if (r.status === 'UNPAID') { counts.unpaid += 1; totals.paid += r.paid; totals.unpaid += r.charged - r.paid; }
    else { counts.pending += 1; totals.pending += r.charged; }
  }
  return { schema: '1', mode: 'live', rows, totals, counts, excluded };
}

// ── 응답 파서(회원 화면 · allow-list) ──────────────────────────────────────────
const STATUSES = new Set<SettlementStatus>(['PAID', 'UNPAID', 'PENDING', 'REVIEW']);
const NOTES = new Set(['partial', 'unregistered', 'needs_link', 'finance_unlinked', 'amount_mismatch', 'duplicate', 'awaiting_review', 'unidentified', 'invalid_flag', 'invalid_amount', 'name_missing']);
const MODES = new Set<SettlementMode>(['live', 'legacy_closed', 'not_ready', 'none', 'unconfigured']);
const nn = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null);

/** 서버 응답 스냅샷을 다시 검사한다. 형식이 틀리거나 합계가 맞지 않으면 null(화면은 '불러오지 못함' 처리 — 0원 표시 금지). */
export function parseSettlementSnapshot(v: unknown): SettlementSnapshot | null {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object' || o.schema !== '1' || !MODES.has(o.mode as SettlementMode) || !Array.isArray(o.rows)) return null;
  const rows: SettlementRow[] = [];
  for (const x of o.rows.slice(0, FR_SETTLEMENT_MAX_ROWS)) {
    const r = x as Record<string, unknown>;
    if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !r.name || !STATUSES.has(r.status as SettlementStatus)) return null;
    const charged = nn(r.charged); const paid = nn(r.paid);
    if (charged === null || paid === null || paid > charged) return null;
    rows.push({ name: r.name.slice(0, 40), guest: r.guest === true, status: r.status as SettlementStatus, charged, paid,
      note: typeof r.note === 'string' && NOTES.has(r.note) ? (r.note as SettlementNote) : null });
  }
  if (o.mode !== 'live' && rows.length) return null;
  const snap = o.mode === 'live' ? finalize(rows, nn(o.excluded) ?? 0) : { ...empty(o.mode as SettlementMode), excluded: nn(o.excluded) ?? 0 };
  // 서버가 보낸 합계와 다시 계산한 합계가 다르면 신뢰하지 않는다.
  const t = o.totals as Record<string, unknown> | undefined;
  if (!t || nn(t.charged) !== snap.totals.charged || nn(t.paid) !== snap.totals.paid || nn(t.unpaid) !== snap.totals.unpaid || nn(t.pending) !== snap.totals.pending) return null;
  return snap;
}

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = { PAID: '납부 완료', UNPAID: '미납 확정', PENDING: '확인 중', REVIEW: '확인 필요' };
export function settlementNoteLabel(r: SettlementRow): string | null {
  switch (r.note) {
    case 'partial': return `일부 납부 · 잔액 ${(r.charged - r.paid).toLocaleString('ko-KR')}원`;
    case 'unregistered': return '재무 등록 전';
    case 'needs_link': case 'unidentified': return '대상 확인 중';
    case 'finance_unlinked': return '재무 연결 확인 중';
    case 'amount_mismatch': return '금액 확인 중';
    case 'duplicate': return '중복 기록 확인 중';
    case 'awaiting_review': return '입금 확인 전';
    case 'invalid_flag': case 'invalid_amount': case 'name_missing': return '기록 확인 필요';
    default: return null;
  }
}
