'use client';

export const dynamic = 'force-dynamic';

// Admin — 주최 대회 참가신청 목록 / 상태 관리.
//   · 목록은 연락처를 마스킹하고, 원문은 펼친 상세에서만 보여준다.
//   · 상태 변경은 set_tournament_registration_status RPC 로 나간다.
//     (RPC 가 CEO/ADMIN 재검증 + 정상 슬롯/중복 재확인 + 이력 기록까지 한 트랜잭션으로 처리)
//   · 대기팀 승격(waitlisted → applied)은 promote_waitlisted_tournament_registration RPC 한 경로로만 나간다.
//     서버가 lock 안에서 정상 슬롯(< 최대)을 다시 확인하고, 대기 1번이 아니면 사유를 요구해 이력에 남긴다.
//     승격 = '입금 요청 대상이 됨'. 입금 상태는 미입금 그대로이며 운영진이 개별 연락한다.
//   · 대기 순번은 서버가 계산한 waitlistPosition 만 쓴다(대기열 진입 시각 기준 · 원본 접수번호 · 순번 불변).
//   · 접수를 취소·거절하면 서버가 연결된 운영팀을 자동 기권 처리한다. 조편성 · 경기에 이미 쓰인 팀은
//     자동으로 바꾸지 않으므로(blocked_in_use) 여기서 경고만 띄운다 — 조 재편성 · 경기 취소는 하지 않는다.
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
import { fetchAdminTeams } from '@/lib/tournaments/drawAdminService';
import type { TournamentTeam } from '@/lib/tournaments/drawTypes';
import {
  fetchAdminRegistrations, fetchAdminTournaments, fetchRegistrationHistory, setRegistrationStatus,
  setRegistrationPlayers, canEditPlayers, promoteWaitlistedRegistration, teamSyncMessage,
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

// 상태 배지 톤. ⚠ DB 값·의미는 바꾸지 않는다 — 표현만 구분한다.
//   확정(confirmed)은 유일하게 '채운' 배지로 두어 접수(applied)와 한눈에 갈린다.
//   취소/거절은 종료 상태라 서로도 구분되게 색을 달리한다.
const REG_TONE: Record<RegistrationStatus, { c: string; bg: string; b?: string }> = {
  applied:    { c: '#1D4ED8', bg: '#EFF6FF', b: '#BFDBFE' },  // blue  — 진행 중
  waitlisted: { c: '#B45309', bg: '#FEF3C7', b: '#FCD34D' },  // amber — 대기
  confirmed:  { c: '#FFFFFF', bg: '#047857', b: '#047857' },  // green solid — 확정(최강조)
  cancelled:  { c: '#B91C1C', bg: '#FEE2E2', b: '#FCA5A5' },  // red   — 취소
  rejected:   { c: '#F8FAFC', bg: '#7F1D1D', b: '#7F1D1D' },  // dark red — 거절
};

/** 종료된 신청(취소·거절) — 목록에서 한눈에 걸러지도록 보조 시각 처리를 붙인다. */
const isClosedStatus = (s: RegistrationStatus): boolean => s === 'cancelled' || s === 'rejected';
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

const Badge = ({ text, tone }: { text: string; tone: { c: string; bg: string; b?: string } }) => (
  <span style={{
    fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 999,
    color: tone.c, background: tone.bg,
    border: `1px solid ${tone.b ?? 'transparent'}`,
    whiteSpace: 'nowrap',
  }}>
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
  const [p1Club, setP1Club] = React.useState(row.player1ClubName ?? '');
  const [p2Name, setP2Name] = React.useState(row.player2Name);
  const [p2Phone, setP2Phone] = React.useState(formatPhone(row.player2Phone));
  const [p2Club, setP2Club] = React.useState(row.player2ClubName ?? '');
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
    setP1Club(row.player1ClubName ?? '');
    setP2Name(row.player2Name);
    setP2Phone(formatPhone(row.player2Phone));
    setP2Club(row.player2ClubName ?? '');
    setEditClub(false);
    setClubName(row.clubName ?? '');
    setEditDepositor(false);
    setDepositorName(row.depositorName);
    setReason('');
    setRechecked(false);
    setConfirming(false);
  }, [row.player1Name, row.player1Phone, row.player2Name, row.player2Phone,
      row.player1ClubName, row.player2ClubName, row.clubName, row.depositorName]);

  React.useEffect(() => { setOpen(false); reset(); }, [row.id, reset]);

  const touchP1 = target === 'p1' || target === 'both';
  const touchP2 = target === 'p2' || target === 'both';

  // 실제로 바뀐 항목만 모은다. 선택하지 않은 선수는 아예 보내지 않는다(null = 변경 없음).
  const diffs: { label: string; from: string; to: string }[] = [];
  if (touchP1 && p1Name.trim() !== row.player1Name) diffs.push({ label: '선수1 이름', from: row.player1Name, to: p1Name.trim() });
  if (touchP1 && normalizePhone(p1Phone) !== normalizePhone(row.player1Phone)) {
    diffs.push({ label: '선수1 연락처', from: maskPhone(row.player1Phone), to: maskPhone(normalizePhone(p1Phone)) });
  }
  if (touchP1 && p1Club.trim() !== (row.player1ClubName ?? '')) {
    diffs.push({ label: '선수1 클럽', from: row.player1ClubName || '(없음)', to: p1Club.trim() || '(없음)' });
  }
  if (touchP2 && p2Name.trim() !== row.player2Name) diffs.push({ label: '선수2 이름', from: row.player2Name, to: p2Name.trim() });
  if (touchP2 && normalizePhone(p2Phone) !== normalizePhone(row.player2Phone)) {
    diffs.push({ label: '선수2 연락처', from: maskPhone(row.player2Phone), to: maskPhone(normalizePhone(p2Phone)) });
  }
  if (touchP2 && p2Club.trim() !== (row.player2ClubName ?? '')) {
    diffs.push({ label: '선수2 클럽', from: row.player2ClubName || '(없음)', to: p2Club.trim() || '(없음)' });
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
    player1ClubName: touchP1 ? p1Club.trim() : null,
    player2Name: touchP2 ? p2Name.trim() : null,
    player2Phone: touchP2 ? normalizePhone(p2Phone) : null,
    player2ClubName: touchP2 ? p2Club.trim() : null,
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
              {cur(`선수1  ${row.player1Name} · ${formatPhone(row.player1Phone)} · ${row.player1ClubName || '클럽 미보정'}`)}
              {cur(`선수2  ${row.player2Name} · ${formatPhone(row.player2Phone)} · ${row.player2ClubName || '클럽 미보정'}`)}
              {cur(`클럽(legacy)  ${row.clubName || '-'}`)}
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>선수1 클럽</label>
                <input value={p1Club} maxLength={MAX_CLUB_LENGTH} placeholder="없으면 무소속"
                  onChange={(e) => setP1Club(e.target.value)} style={input} />
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>선수2 클럽</label>
                <input value={p2Club} maxLength={MAX_CLUB_LENGTH} placeholder="없으면 무소속"
                  onChange={(e) => setP2Club(e.target.value)} style={input} />
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

// ── 대기팀 승격 ──────────────────────────────────────────────────────────────
//   대기 1번 → 확인 한 번으로 승격.
//   대기 2번 이후 → 경고 → 사유 입력 → 승격 (사유가 비면 버튼이 잠긴다. 서버도 사유를 다시 요구한다).
//   정상 슬롯이 이미 가득이면 버튼을 잠근다(최종 차단은 서버 NORMAL_CAPACITY_FULL).
interface CapacityView { normal: number; max: number | null }

function PromoteControl({ row, first, capacity, busy, onPromote, compact }: {
  row: AdminRegistrationRow;
  /** 현재 대기 1번(예외 경고 문구용). */
  first: AdminRegistrationRow | null;
  capacity: CapacityView;
  busy: boolean;
  onPromote: (reason: string | null) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  React.useEffect(() => { setOpen(false); setReason(''); }, [row.id, row.waitlistPosition]);

  const pos = row.waitlistPosition;
  if (row.registrationStatus !== 'waitlisted' || pos === null) return null;
  const full = capacity.max !== null && capacity.normal >= capacity.max;
  const exceptional = pos > 1;
  const reasonOk = reason.trim().length > 0;

  const btn = (label: string, onClick: () => void, tone: 'primary' | 'warn', disabled: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        minHeight: compact ? 34 : 38, padding: compact ? '7px 11px' : '9px 12px', borderRadius: 9,
        border: `1px solid ${tone === 'primary' ? '#047857' : '#F59E0B'}`,
        background: tone === 'primary' ? '#047857' : '#FFFBEB',
        color: tone === 'primary' ? '#fff' : '#92400E',
        fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );

  if (full) {
    return (
      <span style={{ fontSize: 11.5, fontWeight: 800, color: '#94A3B8', whiteSpace: 'nowrap' }}>
        정상 슬롯 만석 · 승격 불가
      </span>
    );
  }

  if (!exceptional) {
    return btn('대기 1번 승격', () => {
      if (!window.confirm(`대기 1번 '${row.registrationNo}' 팀을 정상 참가로 승격할까요?\n승격 후 입금 요청 연락을 진행해 주세요. (입금 상태는 미입금 유지)`)) return;
      onPromote(null);
    }, 'primary', busy);
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: open ? '100%' : undefined }}>
      {!open ? btn(`대기 ${pos}번 예외 승격`, () => setOpen(true), 'warn', busy) : (
        <div style={{ padding: '11px 12px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FCD34D' }}>
          <p style={{ margin: 0, display: 'flex', gap: 6, fontSize: 12.5, fontWeight: 900, color: '#92400E', lineHeight: 1.55 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            대기 {pos}번은 대기 1번이 아닙니다.
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 12, fontWeight: 600, color: '#92400E', lineHeight: 1.65, wordBreak: 'keep-all' }}>
            {first ? `대기 1번(${first.registrationNo} · ${first.player1Name} · ${first.player2Name})보다 ` : ''}
            먼저 승격하는 예외 처리입니다. 사유는 변경 이력에 남습니다.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="예외 승격 사유 (필수)"
            aria-label="예외 승격 사유"
            style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', borderRadius: 9, border: `1.5px solid ${reasonOk ? '#FCD34D' : '#FCA5A5'}`, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', color: '#0F172A', outline: 'none', resize: 'vertical', lineHeight: 1.6, background: '#fff' }}
          />
          {!reasonOk && (
            <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 800, color: '#B91C1C' }}>사유를 입력해야 승격할 수 있습니다.</p>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 7 }}>
            <button type="button" onClick={() => { setOpen(false); setReason(''); }}
              style={{ flex: 1, minHeight: 38, borderRadius: 9, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
              취소
            </button>
            <button type="button" disabled={busy || !reasonOk}
              onClick={() => onPromote(reason.trim())}
              style={{ flex: 1, minHeight: 38, borderRadius: 9, border: '1px solid #B45309', background: '#B45309', color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: busy || !reasonOk ? 'default' : 'pointer', opacity: busy || !reasonOk ? 0.5 : 1 }}>
              사유 저장 후 승격
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────────
function Detail({ row, busy, onAction, onPlayers, promote }: {
  row: AdminRegistrationRow;
  busy: boolean;
  onAction: (patch: { registrationStatus?: RegistrationStatus; paymentStatus?: PaymentStatus; adminNote?: string }) => void;
  onPlayers: (input: Omit<SetRegistrationPlayersInput, 'registrationId'>) => void;
  /** 대기팀 승격 컨트롤(waitlisted 일 때만 렌더된다). */
  promote: React.ReactNode;
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
      {row.waitlistedAt && line('대기 진입', fmtTime(row.waitlistedAt))}
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
        <p style={{ margin: '12px 0 7px', fontSize: 11.5, fontWeight: 800, color: '#475569' }}>
          신청 상태{row.waitlistPosition !== null ? ` · 대기 ${row.waitlistPosition}번` : ''}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {/* 대기팀은 승격 경로(순번 경고 · 사유 · 이력)로만 정상 참가가 된다. */}
          {row.registrationStatus === 'waitlisted' ? promote : (
            <>
              {act('참가 확정', <Check size={13} />, { registrationStatus: 'confirmed' })}
              {act('접수로', <Undo2 size={13} />, { registrationStatus: 'applied' })}
              {act('대기 전환', <Clock size={13} />, { registrationStatus: 'waitlisted' })}
            </>
          )}
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
                {h.note && (
                  <span style={{ display: 'block', color: '#92400E', fontWeight: 700, wordBreak: 'break-word' }}>{h.note}</span>
                )}
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
  // 정상 참가 최대 · 모집 목표 — 서버(get_admin_hosted_tournaments) 값. 못 받으면 null(숫자를 지어내지 않는다).
  const [cap, setCap] = React.useState<{ max: number; target: number } | null>(null);
  // 운영팀 스냅샷 — 취소·거절된 접수인데 팀이 아직 참가 상태로 남은 경우를 찾기 위해서만 쓴다.
  const [teams, setTeams] = React.useState<TournamentTeam[]>([]);

  const load = React.useCallback(async () => {
    if (!allowed || !slug) return;
    const [{ ready, rows }, list, teamList] = await Promise.all([
      fetchAdminRegistrations(slug), fetchAdminTournaments(),
      fetchAdminTeams(slug).catch(() => ({ ready: false, rows: [] as TournamentTeam[] })),
    ]);
    setReady(ready);
    setRows(rows);
    setTeams(teamList.rows);
    const t = list.rows.find((x) => x.slug === slug);
    setCap(t && t.maxCapacity > 0 ? { max: t.maxCapacity, target: t.targetCapacity } : null);
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
      const sync = await setRegistrationStatus({ registrationId: row.id, ...patch });
      await load();
      const extra = teamSyncMessage(sync);
      setToast(extra ? `처리했습니다. ${extra}` : '처리했습니다.');
    } catch (err) {
      setToast(adminActionMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handlePromote = async (row: AdminRegistrationRow, reason: string | null) => {
    setBusyId(row.id);
    try {
      const r = await promoteWaitlistedRegistration(row.id, reason);
      await load();
      setToast(`대기 ${r.previousWaitlistPosition}번을 정상 참가로 승격했습니다. 입금 요청 연락을 진행해 주세요.`);
    } catch (err) {
      setToast(adminActionMessage(err));
      await load();
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

  // 최신 신청이 항상 맨 위. 필터·검색·상태 변경 후에도 같은 기준이 유지된다.
  //   ⚠ 공개 참가팀 목록(sequence_no 오름차순)은 건드리지 않는다 — Admin 목록만이다.
  //   제출시각이 같거나 비어 있으면 접수순번 내림차순으로 떨어뜨린다.
  const byNewest = (a: AdminRegistrationRow, b: AdminRegistrationRow): number => {
    const ta = Date.parse(a.submittedAt || '');
    const tb = Date.parse(b.submittedAt || '');
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return b.sequenceNo - a.sequenceNo;
  };

  const filtered = React.useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'unpaid' && !(r.paymentStatus === 'pending' && r.registrationStatus !== 'cancelled' && r.registrationStatus !== 'rejected')) return false;
      if (filter === 'waitlisted' && r.registrationStatus !== 'waitlisted') return false;
      if (filter === 'confirmed' && r.registrationStatus !== 'confirmed') return false;
      if (filter === 'closed' && r.registrationStatus !== 'cancelled' && r.registrationStatus !== 'rejected') return false;
      if (!kw) return true;
      return [r.registrationNo, r.player1Name, r.player2Name, r.clubName ?? '', r.player1ClubName ?? '', r.player2ClubName ?? '', r.depositorName]
        .join(' ').toLowerCase().includes(kw);
    // 대기 필터에서는 대기 순번 순서(1, 2, 3 …)로 보여 준다.
    }).sort(filter === 'waitlisted'
      ? (a, b) => (a.waitlistPosition ?? 1e9) - (b.waitlistPosition ?? 1e9)
      : byNewest);
  }, [rows, filter, q]);

  // 접수는 취소·거절인데 운영팀이 아직 참가 상태인 건(= 조편성 · 경기에 쓰여 자동 기권을 못 한 팀).
  //   ⚠ 여기서 팀을 고치지 않는다. 운영진이 참가팀 화면에서 판단한다.
  const teamWarnings = React.useMemo(() => {
    const closed = new Map(rows
      .filter((r) => r.registrationStatus === 'cancelled' || r.registrationStatus === 'rejected')
      .map((r) => [r.id, r]));
    return teams
      .filter((t) => t.status === 'active' && t.registrationId && closed.has(t.registrationId))
      .map((t) => ({ teamNo: t.teamNo, row: closed.get(t.registrationId as string)! }))
      .sort((a, b) => a.teamNo - b.teamNo);
  }, [rows, teams]);

  // 대기 순서 — 서버가 준 waitlistPosition 순.
  const waitlist = React.useMemo(
    () => rows.filter((r) => r.registrationStatus === 'waitlisted' && r.waitlistPosition !== null)
      .sort((a, b) => (a.waitlistPosition as number) - (b.waitlistPosition as number)),
    [rows],
  );

  const summary = React.useMemo(() => {
    const active = rows.filter((r) => ['applied', 'waitlisted', 'confirmed'].includes(r.registrationStatus));
    return {
      active: active.length,
      // 정상 참가 슬롯 = 접수 + 참가확정. 대기팀은 들어가지 않는다.
      normal: rows.filter((r) => r.registrationStatus === 'applied' || r.registrationStatus === 'confirmed').length,
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
          {/* 정원 — 정상 참가 N / 최대 · 대기 N팀 */}
          <div style={{ ...card, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px 16px' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#475569' }}>
              정상 참가{' '}
              <span style={{ fontSize: 20, fontWeight: 900, color: cap && summary.normal >= cap.max ? '#B91C1C' : '#0F172A' }}>
                {summary.normal}
              </span>
              <span style={{ fontSize: 15, fontWeight: 900, color: '#94A3B8' }}> / {cap ? cap.max : '-'}</span>
            </p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: summary.waitlisted ? '#B45309' : '#475569' }}>
              대기 <span style={{ fontSize: 20, fontWeight: 900 }}>{summary.waitlisted}</span>팀
            </p>
            {cap && (
              <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>
                모집 목표 {cap.target}팀 · {summary.normal >= cap.max
                  ? '정상 슬롯 만석 — 신규 신청은 대기 접수'
                  : summary.waitlisted > 0
                    ? `빈자리 ${cap.max - summary.normal} — 대기 1번 승격 대상`
                    : `빈자리 ${cap.max - summary.normal}`}
              </p>
            )}
          </div>

          {/* 접수는 취소·거절인데 팀이 아직 참가 상태 — 조편성 · 경기에 쓰여 자동 기권하지 못한 건 */}
          {teamWarnings.length > 0 && (
            <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2' }}>
              <p style={{ margin: '0 0 6px', display: 'flex', gap: 6, fontSize: 12.5, fontWeight: 900, color: '#B91C1C' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                취소·거절 접수인데 참가 상태로 남은 팀 {teamWarnings.length}건
              </p>
              <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 600, color: '#7F1D1D', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                조편성 · 경기에 이미 사용된 팀이라 자동으로 기권 처리하지 않았습니다.
                참가팀 화면에서 상황을 확인한 뒤 직접 처리해 주세요. (조 재편성 · 경기 취소는 자동으로 하지 않습니다)
              </p>
              {teamWarnings.map((w) => (
                <div key={w.teamNo} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '5px 0', fontSize: 12, fontWeight: 700, color: '#0F172A' }}>
                  <span style={{ minWidth: 52, color: '#B91C1C', fontWeight: 900 }}>{w.teamNo}번 팀</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    {w.row.player1Name} · {w.row.player2Name}
                    <span style={{ color: '#94A3B8', fontWeight: 600 }}> · {w.row.registrationNo} · {REGISTRATION_STATUS_LABEL[w.row.registrationStatus]}</span>
                  </span>
                </div>
              ))}
              <Link href={`/admin/tournaments/${slug}/teams`}
                style={{ display: 'inline-block', marginTop: 6, fontSize: 12, fontWeight: 800, color: '#B91C1C' }}>
                참가팀 화면으로 이동 →
              </Link>
            </div>
          )}

          {/* 대기 순서 — 대기 1번에 승격 액션. 그 외는 예외 승격(경고 → 사유 → 승격). */}
          {waitlist.length > 0 && (
            <div style={{ ...card, borderColor: '#FCD34D' }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 900, color: '#92400E' }}>
                대기 순서 · {waitlist.length}팀
              </p>
              {waitlist.map((w, i) => (
                <div key={w.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid #FEF3C7' }}>
                  <span style={{ flexShrink: 0, minWidth: 52, fontSize: 12.5, fontWeight: 900, color: '#B45309' }}>대기 {w.waitlistPosition}</span>
                  <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 800, color: '#0F172A', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                    {w.player1Name} · {w.player2Name}
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>{w.registrationNo}</span>
                  </span>
                  <PromoteControl
                    row={w}
                    first={waitlist[0] ?? null}
                    capacity={{ normal: summary.normal, max: cap ? cap.max : null }}
                    busy={busyId === w.id}
                    onPromote={(reason) => void handlePromote(w, reason)}
                    compact
                  />
                </div>
              ))}
            </div>
          )}

          {/* 요약 */}
          <div style={{ ...card, display: 'flex', gap: 10 }}>
            {[
              ['활성', summary.active, '#0F172A'],
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
            // 취소·거절은 종료된 신청 — 배지 색만으로 두지 않고 행 전체를 가라앉힌다.
            const closed = isClosedStatus(r.registrationStatus);
            return (
              <div
                key={r.id}
                style={closed
                  ? { ...card, opacity: 0.66, background: '#FAFBFC', borderColor: '#EDF0F3' }
                  : card}
              >
                <div onClick={() => setOpenId(open ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 900, color: '#94A3B8', minWidth: 22 }}>#{r.sequenceNo}</span>
                    <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: '#475569' }}>{r.registrationNo}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                      <Badge
                        text={r.registrationStatus === 'waitlisted' && r.waitlistPosition !== null
                          ? `대기 ${r.waitlistPosition}` : REGISTRATION_STATUS_LABEL[r.registrationStatus]}
                        tone={REG_TONE[r.registrationStatus]}
                      />
                      <Badge text={PAYMENT_STATUS_LABEL[r.paymentStatus]} tone={PAY_TONE[r.paymentStatus]} />
                    </span>
                  </div>
                  <p style={{
                    margin: 0, fontSize: 14.5, fontWeight: 900,
                    color: closed ? '#64748B' : '#0F172A',
                    textDecoration: closed ? 'line-through' : 'none',
                    textDecorationColor: closed ? '#CBD5E1' : undefined,
                    lineHeight: 1.45, wordBreak: 'keep-all',
                  }}>
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
                    promote={
                      <PromoteControl
                        row={r}
                        first={waitlist[0] ?? null}
                        capacity={{ normal: summary.normal, max: cap ? cap.max : null }}
                        busy={busyId === r.id}
                        onPromote={(reason) => void handlePromote(r, reason)}
                      />
                    }
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
