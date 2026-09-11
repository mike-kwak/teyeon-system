'use client';

export const dynamic = 'force-dynamic';

// Admin — 주최 대회 참가신청 목록 / 상태 관리.
//   · 목록은 연락처를 마스킹하고, 원문은 펼친 상세에서만 보여준다.
//   · 상태 변경은 전부 set_tournament_registration_status RPC 한 경로로만 나간다.
//     (RPC 가 CEO/ADMIN 재검증 + 정원/중복 재확인 + 이력 기록까지 한 트랜잭션으로 처리)
//   · 입금 상태는 운영 내부 정보다. 공개 화면에 절대 내보내지 않는다.
//   · 선수(파트너) 교체는 set_tournament_registration_players RPC 한 경로로만 나간다.
//     접수번호·순번·신청상태·입금상태는 서버가 유지하고, 이력의 연락처는 마스킹되어 저장된다.

import React from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ShieldAlert, Phone, Search, RefreshCw, Check, Clock,
  X as XIcon, Undo2, History, UserCog, AlertTriangle,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import {
  fetchAdminRegistrations, fetchRegistrationHistory, setRegistrationStatus,
  setRegistrationPlayers, canEditPlayers,
  adminActionMessage, maskPhone, formatPhone,
  REGISTRATION_STATUS_LABEL, PAYMENT_STATUS_LABEL, HISTORY_ACTION_LABEL,
  type AdminRegistrationRow, type RegistrationHistoryRow, type SetRegistrationPlayersInput,
} from '@/lib/tournaments/adminService';
import {
  formatPhoneInput, isValidPhone, normalizePhone,
  MAX_NAME_LENGTH, MAX_CLUB_LENGTH, MAX_PHONE_INPUT_LENGTH,
} from '@/lib/tournaments/validation';
import type { PaymentStatus, RegistrationStatus } from '@/lib/tournaments/types';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 15, marginBottom: 10 };

const REG_TONE: Record<RegistrationStatus, { c: string; bg: string }> = {
  applied: { c: '#1D4ED8', bg: '#EFF6FF' },
  waitlisted: { c: '#B45309', bg: '#FEF3C7' },
  confirmed: { c: '#047857', bg: '#DCFCE7' },
  cancelled: { c: '#B91C1C', bg: '#FEE2E2' },
  rejected: { c: '#B91C1C', bg: '#FEE2E2' },
};
const PAY_TONE: Record<PaymentStatus, { c: string; bg: string }> = {
  pending: { c: '#92400E', bg: '#FEF3C7' },
  paid: { c: '#047857', bg: '#DCFCE7' },
  refund_pending: { c: '#4338CA', bg: '#E0E7FF' },
  refunded: { c: '#475569', bg: '#F1F5F9' },
};
const PAYMENT_ACTIONS: Record<PaymentStatus, { label: string; icon: 'check' | 'clock' | 'undo'; next: PaymentStatus }[]> = {
  pending: [
    { label: '입금 완료', icon: 'check', next: 'paid' },
  ],
  paid: [
    { label: '미입금으로', icon: 'undo', next: 'pending' },
    { label: '환불 대기', icon: 'clock', next: 'refund_pending' },
  ],
  refund_pending: [
    { label: '입금완료로', icon: 'undo', next: 'paid' },
    { label: '환불 완료', icon: 'check', next: 'refunded' },
  ],
  refunded: [],
};

const Badge = ({ text, tone }: { text: string; tone: { c: string; bg: string } }) => (
  <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 999, color: tone.c, background: tone.bg, whiteSpace: 'nowrap' }}>
    {text}
  </span>
);

type FilterKey = 'all' | 'unpaid' | 'waitlisted' | 'confirmed' | 'closed';
const FILTERS: { k: FilterKey; t: string }[] = [
  { k: 'all', t: '전체' },
  { k: 'unpaid', t: '미입금' },
  { k: 'waitlisted', t: '대기' },
  { k: 'confirmed', t: '참가확정' },
  { k: 'closed', t: '취소·거절' },
];

const fmtTime = (iso: string | null): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ── 선수(파트너) 교체 ────────────────────────────────────────────────────────
//   부상·개인사정 교체를 '취소 후 재신청' 없이 처리한다.
//   접수번호·순번·신청상태·입금상태는 서버가 유지하며, 여기서는 신원만 바꾼다.
//   허용 여부·중복·형식은 전부 서버 RPC 가 최종 판정한다(아래는 UI 1차 방어선).
function PlayerEdit({ row, busy, onSubmit }: {
  row: AdminRegistrationRow;
  busy: boolean;
  onSubmit: (input: Omit<SetRegistrationPlayersInput, 'registrationId'>) => void;
}) {
  const gate = canEditPlayers(row);
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState<'p1' | 'p2' | 'both'>('p1');
  const [p1Name, setP1Name] = React.useState(row.player1Name);
  const [p1Phone, setP1Phone] = React.useState(formatPhone(row.player1Phone));
  const [p2Name, setP2Name] = React.useState(row.player2Name);
  const [p2Phone, setP2Phone] = React.useState(formatPhone(row.player2Phone));
  const [editClub, setEditClub] = React.useState(false);
  const [clubName, setClubName] = React.useState(row.clubName ?? '');
  const [editDepositor, setEditDepositor] = React.useState(false);
  const [depositorName, setDepositorName] = React.useState(row.depositorName);
  const [reason, setReason] = React.useState('');
  const [rechecked, setRechecked] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // 다른 신청을 펼치면 폼을 초기 상태로 되돌린다(이전 입력이 남아 다른 팀에 적용되는 사고 방지).
  const reset = React.useCallback(() => {
    setTarget('p1');
    setP1Name(row.player1Name);
    setP1Phone(formatPhone(row.player1Phone));
    setP2Name(row.player2Name);
    setP2Phone(formatPhone(row.player2Phone));
    setEditClub(false);
    setClubName(row.clubName ?? '');
    setEditDepositor(false);
    setDepositorName(row.depositorName);
    setReason('');
    setRechecked(false);
    setConfirming(false);
  }, [row.player1Name, row.player1Phone, row.player2Name, row.player2Phone, row.clubName, row.depositorName]);

  React.useEffect(() => { setOpen(false); reset(); }, [row.id, reset]);

  const touchP1 = target === 'p1' || target === 'both';
  const touchP2 = target === 'p2' || target === 'both';

  // 실제로 바뀐 항목만 모은다. 선택하지 않은 선수는 아예 보내지 않는다(null = 변경 없음).
  const diffs: { label: string; from: string; to: string }[] = [];
  if (touchP1 && p1Name.trim() !== row.player1Name) diffs.push({ label: '선수1 이름', from: row.player1Name, to: p1Name.trim() });
  if (touchP1 && normalizePhone(p1Phone) !== normalizePhone(row.player1Phone)) {
    diffs.push({ label: '선수1 연락처', from: maskPhone(row.player1Phone), to: maskPhone(normalizePhone(p1Phone)) });
  }
  if (touchP2 && p2Name.trim() !== row.player2Name) diffs.push({ label: '선수2 이름', from: row.player2Name, to: p2Name.trim() });
  if (touchP2 && normalizePhone(p2Phone) !== normalizePhone(row.player2Phone)) {
    diffs.push({ label: '선수2 연락처', from: maskPhone(row.player2Phone), to: maskPhone(normalizePhone(p2Phone)) });
  }
  if (editClub && clubName.trim() !== (row.clubName ?? '')) {
    diffs.push({ label: '클럽명', from: row.clubName || '(없음)', to: clubName.trim() || '(없음)' });
  }
  if (editDepositor && depositorName.trim() !== row.depositorName) {
    diffs.push({ label: '입금자명', from: row.depositorName, to: depositorName.trim() });
  }

  const invalid: string | null = (() => {
    if (touchP1 && !p1Name.trim()) return '선수1 이름을 입력해 주세요.';
    if (touchP2 && !p2Name.trim()) return '선수2 이름을 입력해 주세요.';
    if (touchP1 && !isValidPhone(p1Phone)) return '선수1 연락처 형식이 올바르지 않습니다.';
    if (touchP2 && !isValidPhone(p2Phone)) return '선수2 연락처 형식이 올바르지 않습니다.';
    if (normalizePhone(p1Phone) === normalizePhone(p2Phone)) return '선수 2명의 연락처가 같습니다.';
    if (editDepositor && !depositorName.trim()) return '입금자명은 비울 수 없습니다.';
    if (diffs.length === 0) return '변경된 내용이 없습니다.';
    if (!reason.trim()) return '변경 사유를 입력해 주세요.';
    if (!rechecked) return '참가자격 재확인에 체크해 주세요.';
    return null;
  })();

  const build = (): Omit<SetRegistrationPlayersInput, 'registrationId'> => ({
    player1Name: touchP1 ? p1Name.trim() : null,
    player1Phone: touchP1 ? normalizePhone(p1Phone) : null,
    player2Name: touchP2 ? p2Name.trim() : null,
    player2Phone: touchP2 ? normalizePhone(p2Phone) : null,
    clubName: editClub ? clubName.trim() : null,
    depositorName: editDepositor ? depositorName.trim() : null,
    reason: reason.trim(),
    eligibilityRechecked: rechecked,
  });

  const label: React.CSSProperties = { display: 'block', margin: '0 0 4px', fontSize: 11, fontWeight: 800, color: '#64748B' };
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', borderRadius: 9, border: '1.5px solid #E2E8F0',
    padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', color: '#0F172A', outline: 'none',
  };
  const cur = (t: string) => <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>{t}</span>;

  if (!gate.ok) {
    return (
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: '#94A3B8' }}>
          <UserCog size={13} /> 선수 정보 변경 불가
        </p>
        <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 700, color: '#94A3B8', lineHeight: 1.6 }}>{gate.reason}</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
      <button
        type="button"
        onClick={() => { if (open) reset(); setOpen((v) => !v); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '8px 12px',
          borderRadius: 9, border: '1px solid #CBD5E1', background: '#fff', color: '#334155',
          fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
        }}
      >
        <UserCog size={13} />선수 정보 변경
      </button>

      {open && (
        <div style={{ marginTop: 10, padding: '12px 12px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
          {/* 현재 값 */}
          <div style={{ marginBottom: 10 }}>
            <p style={{ margin: '0 0 5px', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: '#94A3B8' }}>현재</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {cur(`선수1  ${row.player1Name} · ${formatPhone(row.player1Phone)}`)}
              {cur(`선수2  ${row.player2Name} · ${formatPhone(row.player2Phone)}`)}
              {cur(`클럽    ${row.clubName || '-'}`)}
              {cur(`입금자  ${row.depositorName}`)}
            </div>
          </div>

          {/* 변경 대상 */}
          <p style={label}>변경 대상</p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {([['p1', '선수1'], ['p2', '선수2'], ['both', '둘 다']] as const).map(([k, t]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTarget(k)}
                style={{
                  flex: 1, minHeight: 34, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  border: `1px solid ${target === k ? '#0F172A' : '#CBD5E1'}`,
                  background: target === k ? '#0F172A' : '#fff',
                  color: target === k ? '#fff' : '#475569',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {touchP1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>선수1 이름</label>
                <input value={p1Name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setP1Name(e.target.value)} style={input} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>선수1 연락처</label>
                <input value={p1Phone} inputMode="numeric" maxLength={MAX_PHONE_INPUT_LENGTH}
                  onChange={(e) => setP1Phone(formatPhoneInput(e.target.value))} style={input} />
              </div>
            </div>
          )}

          {touchP2 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>선수2 이름</label>
                <input value={p2Name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setP2Name(e.target.value)} style={input} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>선수2 연락처</label>
                <input value={p2Phone} inputMode="numeric" maxLength={MAX_PHONE_INPUT_LENGTH}
                  onChange={(e) => setP2Phone(formatPhoneInput(e.target.value))} style={input} />
              </div>
            </div>
          )}

          {/* 선택 변경 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '10px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={editClub} onChange={(e) => setEditClub(e.target.checked)} />
              클럽명도 변경
            </label>
            {editClub && (
              <input value={clubName} maxLength={MAX_CLUB_LENGTH} placeholder="비우면 클럽 없음으로 저장됩니다"
                onChange={(e) => setClubName(e.target.value)} style={input} />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={editDepositor} onChange={(e) => setEditDepositor(e.target.checked)} />
              입금자명도 변경
            </label>
            {editDepositor && (
              <input value={depositorName} maxLength={MAX_NAME_LENGTH}
                onChange={(e) => setDepositorName(e.target.value)} style={input} />
            )}
          </div>

          {/* 필수 */}
          <label style={label}>변경 사유 (필수)</label>
          <textarea value={reason} rows={2} maxLength={300} onChange={(e) => setReason(e.target.value)}
            placeholder="예: 선수1 부상으로 파트너 교체 (본인 확인 완료)"
            style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} />

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, margin: '9px 0 0', fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer', lineHeight: 1.6 }}>
            <input type="checkbox" checked={rechecked} onChange={(e) => setRechecked(e.target.checked)} style={{ marginTop: 3 }} />
            변경된 선수의 참가자격을 다시 확인했습니다.
          </label>

          {invalid && (
            <p style={{ margin: '9px 0 0', fontSize: 11.5, fontWeight: 700, color: '#B45309' }}>{invalid}</p>
          )}

          <button
            type="button"
            disabled={busy || !!invalid}
            onClick={() => setConfirming(true)}
            style={{
              marginTop: 11, minHeight: 38, padding: '9px 16px', borderRadius: 9,
              border: '1px solid #0F172A', background: '#0F172A', color: '#fff',
              fontSize: 12.5, fontWeight: 800,
              cursor: busy || invalid ? 'default' : 'pointer', opacity: busy || invalid ? 0.45 : 1,
            }}
          >
            변경 내용 확인
          </button>
        </div>
      )}

      {/* 확인 모달 */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}
          onClick={() => setConfirming(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 380, maxHeight: '80vh', overflowY: 'auto',
              background: '#fff', borderRadius: 14, padding: 18, boxSizing: 'border-box',
            }}
          >
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: '#0F172A' }}>선수 정보를 변경할까요?</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 800, color: '#64748B' }}>{row.registrationNo}</p>

            {row.registrationStatus === 'confirmed' && (
              <div style={{ display: 'flex', gap: 7, marginTop: 11, padding: '10px 11px', borderRadius: 9, background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
                <AlertTriangle size={14} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#B91C1C', lineHeight: 1.6 }}>
                  이미 <strong>참가확정</strong>된 팀입니다. 대진·명단이 배포된 뒤라면 운영본부 공지도 함께 처리하세요.
                </span>
              </div>
            )}

            <div style={{ marginTop: 12, padding: '10px 11px', background: '#F8FAFC', borderRadius: 9 }}>
              {diffs.map((d) => (
                <div key={d.label} style={{ fontSize: 12, fontWeight: 700, color: '#334155', lineHeight: 1.85, wordBreak: 'break-word' }}>
                  <span style={{ color: '#94A3B8' }}>{d.label}</span>{' '}
                  {d.from} <span style={{ color: '#94A3B8' }}>→</span> <strong>{d.to}</strong>
                </div>
              ))}
            </div>

            <p style={{ margin: '11px 0 0', fontSize: 11.5, fontWeight: 800, color: '#047857', lineHeight: 1.7 }}>
              접수순번 · 접수번호 · 신청상태 · 입금상태는 그대로 유지됩니다.
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: '#94A3B8', lineHeight: 1.7 }}>
              변경 이력에 사유와 참가자격 재확인 사실이 기록됩니다. 연락처는 마스킹되어 저장됩니다.
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                style={{ flex: 1, minHeight: 40, borderRadius: 9, border: '1px solid #CBD5E1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setConfirming(false); onSubmit(build()); }}
                style={{ flex: 1, minHeight: 40, borderRadius: 9, border: '1px solid #0F172A', background: '#0F172A', color: '#fff', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}
              >
                변경 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────────
function Detail({ row, busy, onAction, onPlayers }: {
  row: AdminRegistrationRow;
  busy: boolean;
  onAction: (patch: { registrationStatus?: RegistrationStatus; paymentStatus?: PaymentStatus; adminNote?: string }) => void;
  onPlayers: (input: Omit<SetRegistrationPlayersInput, 'registrationId'>) => void;
}) {
  const [note, setNote] = React.useState(row.adminNote ?? '');
  const [history, setHistory] = React.useState<RegistrationHistoryRow[] | 'loading'>('loading');

  React.useEffect(() => { setNote(row.adminNote ?? ''); }, [row.id, row.adminNote]);
  React.useEffect(() => {
    let c = false;
    setHistory('loading');
    fetchRegistrationHistory(row.id).then((h) => { if (!c) setHistory(h); });
    return () => { c = true; };
    // 선수 교체 후에도 이력이 즉시 갱신되도록 신원 필드를 의존성에 포함한다.
  }, [row.id, row.registrationStatus, row.paymentStatus, row.adminNote,
      row.player1Name, row.player1Phone, row.player2Name, row.player2Phone,
      row.clubName, row.depositorName]);

  const line = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 10, fontSize: 12.5, lineHeight: 1.7, padding: '3px 0' }}>
      <span style={{ flexShrink: 0, minWidth: 78, fontWeight: 800, color: '#94A3B8' }}>{label}</span>
      <span style={{ minWidth: 0, fontWeight: 700, color: '#0F172A', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
  const paymentActions = PAYMENT_ACTIONS[row.paymentStatus];
  const paymentIcon = (icon: 'check' | 'clock' | 'undo') => {
    if (icon === 'clock') return <Clock size={13} />;
    if (icon === 'undo') return <Undo2 size={13} />;
    return <Check size={13} />;
  };

  const act = (label: string, icon: React.ReactNode, patch: Parameters<typeof onAction>[0], danger?: boolean) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (danger && !window.confirm(`'${row.registrationNo}' 신청을 ${label} 처리할까요?`)) return;
        onAction(patch);
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        minHeight: 38, padding: '9px 12px', borderRadius: 9,
        border: `1px solid ${danger ? '#FCA5A5' : '#CBD5E1'}`,
        background: danger ? '#FEF2F2' : '#fff',
        color: danger ? '#B91C1C' : '#334155',
        fontSize: 12.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1,
      }}
    >
      {icon}{label}
    </button>
  );

  const phoneLink = (name: string, phone: string) => (
    <a href={`tel:${phone.replace(/[^0-9]/g, '')}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#1D4ED8', textDecoration: 'none', fontWeight: 800 }}>
      <Phone size={12} />{formatPhone(phone)}
      <span style={{ color: '#94A3B8', fontWeight: 700 }}>({name})</span>
    </a>
  );

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
      {line('연락처', <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {phoneLink(row.player1Name, row.player1Phone)}
        {phoneLink(row.player2Name, row.player2Phone)}
      </span>)}
      {line('클럽', row.clubName || <span style={{ color: '#94A3B8' }}>-</span>)}
      {line('입금자명', row.depositorName)}
      {line('신청시각', fmtTime(row.submittedAt))}
      {row.confirmedAt && line('확정시각', fmtTime(row.confirmedAt))}
      {row.cancelledAt && line('취소시각', fmtTime(row.cancelledAt))}
      {row.note && line('참가자 메모', row.note)}

      <div style={{ marginTop: 10, padding: '10px 12px', background: '#F8FAFC', borderRadius: 10 }}>
        <p style={{ margin: '0 0 6px', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: '#94A3B8' }}>확인 · 동의</p>
        {[
          ['참가자격', row.eligibilityConfirmedAt],
          ['대회요강', row.regulationsConfirmedAt],
          ['개인정보', row.privacyAgreedAt],
          ['촬영·중계', row.mediaNoticeConfirmedAt],
        ].map(([k, v]) => (
          <div key={k as string} style={{ display: 'flex', gap: 8, fontSize: 11.5, lineHeight: 1.8 }}>
            <Check size={12} color={v ? '#047857' : '#CBD5E1'} style={{ flexShrink: 0, marginTop: 3 }} />
            <span style={{ minWidth: 62, fontWeight: 800, color: '#64748B' }}>{k as string}</span>
            <span style={{ fontWeight: 700, color: v ? '#0F172A' : '#B91C1C' }}>{v ? fmtTime(v as string) : '미확인'}</span>
          </div>
        ))}
      </div>

      {/* 운영 메모 */}
      <div style={{ marginTop: 12 }}>
        <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 800, color: '#475569' }}>운영진 메모</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="운영 참고사항 (참가자에게 보이지 않습니다)"
          style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1.5px solid #E2E8F0', padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', color: '#0F172A', outline: 'none', resize: 'vertical', lineHeight: 1.6 }}
        />
        <button
          type="button"
          disabled={busy || note === (row.adminNote ?? '')}
          onClick={() => onAction({ adminNote: note })}
          style={{
            marginTop: 7, minHeight: 36, padding: '8px 14px', borderRadius: 9, border: '1px solid #CBD5E1',
            background: '#fff', color: '#334155', fontSize: 12.5, fontWeight: 800,
            cursor: busy || note === (row.adminNote ?? '') ? 'default' : 'pointer',
            opacity: busy || note === (row.adminNote ?? '') ? 0.5 : 1,
          }}
        >
          메모 저장
        </button>
      </div>

      {/* 액션 */}
      <div style={{ marginTop: 14 }}>
        <p style={{ margin: '0 0 7px', fontSize: 11.5, fontWeight: 800, color: '#475569' }}>입금</p>
        <div style={{ marginBottom: 8 }}>
          <Badge text={PAYMENT_STATUS_LABEL[row.paymentStatus]} tone={PAY_TONE[row.paymentStatus]} />
          {row.paymentStatus === 'refunded' && (
            <span style={{ marginLeft: 7, fontSize: 11.5, fontWeight: 800, color: '#94A3B8' }}>종료 상태</span>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {paymentActions.map((a) => (
            <React.Fragment key={a.next}>
              {act(a.label, paymentIcon(a.icon), { paymentStatus: a.next })}
            </React.Fragment>
          ))}
        </div>
        <p style={{ margin: '12px 0 7px', fontSize: 11.5, fontWeight: 800, color: '#475569' }}>신청 상태</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {act('참가 확정', <Check size={13} />, { registrationStatus: 'confirmed' })}
          {act('접수로', <Undo2 size={13} />, { registrationStatus: 'applied' })}
          {act('대기 전환', <Clock size={13} />, { registrationStatus: 'waitlisted' })}
          {act('취소', <XIcon size={13} />, { registrationStatus: 'cancelled' }, true)}
          {act('거절', <XIcon size={13} />, { registrationStatus: 'rejected' }, true)}
        </div>
      </div>

      <PlayerEdit row={row} busy={busy} onSubmit={onPlayers} />

      {/* 이력 */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
        <p style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: '#475569' }}>
          <History size={13} /> 변경 이력
        </p>
        {history === 'loading' ? (
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>불러오는 중…</p>
        ) : history.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>이력이 없습니다.</p>
        ) : (
          history.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, padding: '6px 0', borderTop: i === 0 ? 'none' : '1px solid #F8FAFC' }}>
              <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: '#94A3B8', minWidth: 96 }}>{fmtTime(h.createdAt)}</span>
              <span style={{ minWidth: 0, fontSize: 11.5, fontWeight: 700, color: '#334155', lineHeight: 1.6 }}>
                {HISTORY_ACTION_LABEL[h.action] ?? h.action}
                {h.fromValue || h.toValue ? (
                  <span style={{ color: '#64748B' }}> · {h.fromValue ?? '-'} → {h.toValue ?? '-'}</span>
                ) : null}
                <span style={{ color: '#CBD5E1' }}> ({h.actorType})</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── 페이지 ───────────────────────────────────────────────────────────────────
export default function AdminTournamentRegistrationsPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const { role } = useAuth();
  const allowed = isFullAdminRole(role);

  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(true);
  const [rows, setRows] = React.useState<AdminRegistrationRow[]>([]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [q, setQ] = React.useState('');
  const [toast, setToast] = React.useState('');

  const load = React.useCallback(async () => {
    if (!allowed || !slug) return;
    const { ready, rows } = await fetchAdminRegistrations(slug);
    setReady(ready);
    setRows(rows);
    setLoading(false);
  }, [allowed, slug]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleAction = async (
    row: AdminRegistrationRow,
    patch: { registrationStatus?: RegistrationStatus; paymentStatus?: PaymentStatus; adminNote?: string },
  ) => {
    setBusyId(row.id);
    try {
      await setRegistrationStatus({ registrationId: row.id, ...patch });
      await load();
      setToast('처리했습니다.');
    } catch (err) {
      setToast(adminActionMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handlePlayers = async (
    row: AdminRegistrationRow,
    input: Omit<SetRegistrationPlayersInput, 'registrationId'>,
  ) => {
    setBusyId(row.id);
    try {
      await setRegistrationPlayers({ registrationId: row.id, ...input });
      await load();
      setToast('선수 정보를 변경했습니다.');
    } catch (err) {
      setToast(adminActionMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = React.useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'unpaid' && !(r.paymentStatus === 'pending' && r.registrationStatus !== 'cancelled' && r.registrationStatus !== 'rejected')) return false;
      if (filter === 'waitlisted' && r.registrationStatus !== 'waitlisted') return false;
      if (filter === 'confirmed' && r.registrationStatus !== 'confirmed') return false;
      if (filter === 'closed' && r.registrationStatus !== 'cancelled' && r.registrationStatus !== 'rejected') return false;
      if (!kw) return true;
      return [r.registrationNo, r.player1Name, r.player2Name, r.clubName ?? '', r.depositorName]
        .join(' ').toLowerCase().includes(kw);
    });
  }, [rows, filter, q]);

  const summary = React.useMemo(() => {
    const active = rows.filter((r) => ['applied', 'waitlisted', 'confirmed'].includes(r.registrationStatus));
    return {
      active: active.length,
      waitlisted: rows.filter((r) => r.registrationStatus === 'waitlisted').length,
      paid: rows.filter((r) => r.paymentStatus === 'paid').length,
      unpaid: active.filter((r) => r.paymentStatus === 'pending').length,
      confirmed: rows.filter((r) => r.registrationStatus === 'confirmed').length,
    };
  }, [rows]);

  if (!allowed) {
    return (
      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <ShieldAlert size={18} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0F172A', lineHeight: 1.6 }}>
          이 메뉴는 CEO·ADMIN 전용입니다.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link href="/admin/tournaments" aria-label="대회 목록" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#475569', textDecoration: 'none', flexShrink: 0 }}>
          <ChevronLeft size={16} />
        </Link>
        <h1 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 17, fontWeight: 900, color: '#0F172A' }}>참가신청 관리</h1>
        <button type="button" onClick={() => void load()} aria-label="새로고침"
          style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {loading && <div style={card}><p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#94A3B8' }}>불러오는 중…</p></div>}

      {!loading && !ready && (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A' }}>준비 중입니다</p>
          <p style={{ margin: '7px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7 }}>
            접수 저장소가 아직 적용되지 않았습니다.
          </p>
        </div>
      )}

      {!loading && ready && (
        <>
          {/* 요약 */}
          <div style={{ ...card, display: 'flex', gap: 10 }}>
            {[
              ['접수', summary.active, '#0F172A'],
              ['대기', summary.waitlisted, summary.waitlisted ? '#B45309' : '#0F172A'],
              ['미입금', summary.unpaid, summary.unpaid ? '#B91C1C' : '#0F172A'],
              ['입금완료', summary.paid, '#047857'],
              ['확정', summary.confirmed, '#1D4ED8'],
            ].map(([label, value, tone]) => (
              <div key={label as string} style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: '#94A3B8' }}>{label as string}</p>
                <p style={{ margin: '3px 0 0', fontSize: 17, fontWeight: 900, color: tone as string, lineHeight: 1.2 }}>{value as number}</p>
              </div>
            ))}
          </div>

          {/* 필터 · 검색 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {FILTERS.map((f) => (
              <button key={f.k} type="button" onClick={() => setFilter(f.k)}
                style={{ padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer', border: '1px solid', borderColor: filter === f.k ? '#2563EB' : '#CBD5E1', background: filter === f.k ? '#EFF6FF' : '#fff', color: filter === f.k ? '#1D4ED8' : '#475569' }}>
                {f.t}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} color="#94A3B8" style={{ position: 'absolute', left: 12, top: 13 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="접수번호 · 이름 · 클럽 · 입금자명"
              style={{ width: '100%', boxSizing: 'border-box', height: 40, paddingLeft: 33, paddingRight: 12, borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', fontSize: 13, fontFamily: 'inherit', color: '#0F172A', outline: 'none' }} />
          </div>

          {filtered.length === 0 && (
            <div style={card}><p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#94A3B8' }}>해당하는 신청이 없습니다.</p></div>
          )}

          {filtered.map((r) => {
            const open = openId === r.id;
            return (
              <div key={r.id} style={card}>
                <div onClick={() => setOpenId(open ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 900, color: '#94A3B8', minWidth: 22 }}>#{r.sequenceNo}</span>
                    <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: '#475569' }}>{r.registrationNo}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                      <Badge text={REGISTRATION_STATUS_LABEL[r.registrationStatus]} tone={REG_TONE[r.registrationStatus]} />
                      <Badge text={PAYMENT_STATUS_LABEL[r.paymentStatus]} tone={PAY_TONE[r.paymentStatus]} />
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: '#0F172A', lineHeight: 1.45, wordBreak: 'keep-all' }}>
                    {r.player1Name} · {r.player2Name}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                    {r.clubName ? `${r.clubName} · ` : ''}{maskPhone(r.player1Phone)} · 입금자 {r.depositorName}
                  </p>
                </div>
                {open && (
                  <Detail
                    row={r}
                    busy={busyId === r.id}
                    onAction={(p) => void handleAction(r, p)}
                    onPlayers={(i) => void handlePlayers(r, i)}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 96, transform: 'translateX(-50%)', zIndex: 80, padding: '11px 18px', borderRadius: 999, background: 'rgba(15,27,51,0.94)', color: '#fff', fontSize: 12.5, fontWeight: 800, maxWidth: '86vw', textAlign: 'center' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
