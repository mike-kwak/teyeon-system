'use client';

export const dynamic = 'force-dynamic';

// TEYEON Admin — PUBLIC_GUEST 신청 관리. CEO/ADMIN/OPERATOR 전용(middleware + adminAccess + 페이지 재검증).
//   · 목록(전화 마스킹) → 상세(원문) → 승인/보류/거절 + 운영진 메모(RPC, 감사필드 저장).
//   · 승인 정원 초과는 서버 RPC 가 최종 차단. 승인 게스트는 KDK 후보로 제공(자동 등록 없음).
//   · Guest Pass 는 정모 공통 링크 재사용 — 비활성이면 안내만(자동 활성화 금지).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, Copy, ExternalLink, Phone, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useGuestPending } from '@/context/GuestPendingContext';
import { canManageGuestApplications } from '@/lib/admin/adminAccess';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import {
  fetchGuestApplications, setGuestApplicationStatus, guestOperatorMessage, maskPhone,
  approvedKdkCandidates, fetchAdminRecruitmentSummaries,
  type GuestApplicationRow, type GuestApplicationStatus, type RecruitmentSummary,
} from '@/lib/guestApplicationService';
import { fetchScheduleGuestPass, type ScheduleGuestPass } from '@/lib/guestPassService';
import { buildKakaoMessage, buildGuestPassUrl, copyText } from '@/lib/guestPassMessage';

const STATUS: { v: GuestApplicationStatus; t: string; color: string; bg: string }[] = [
  { v: 'pending', t: '검토 대기', color: '#B45309', bg: '#FEF3C7' },
  { v: 'approved', t: '승인', color: '#047857', bg: '#DCFCE7' },
  { v: 'on_hold', t: '보류', color: '#4338CA', bg: '#E0E7FF' },
  { v: 'rejected', t: '거절', color: '#B91C1C', bg: '#FEE2E2' },
];
const statusMeta = (v: GuestApplicationStatus) => STATUS.find((s) => s.v === v) ?? STATUS[0];

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 14, marginBottom: 12 };
const btnGhost: React.CSSProperties = { padding: '8px 12px', borderRadius: 9, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' };
const chip = (on: boolean): React.CSSProperties => ({ padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer', border: '1px solid', borderColor: on ? '#2563EB' : '#CBD5E1', background: on ? '#EFF6FF' : '#fff', color: on ? '#1D4ED8' : '#475569' });

function StatusBadge({ v }: { v: GuestApplicationStatus }) {
  const m = statusMeta(v);
  return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: m.color, background: m.bg, whiteSpace: 'nowrap' }}>{m.t}</span>;
}

// ── 상세 + 액션 ────────────────────────────────────────────────────────────────
function Detail({ app, allRows, busy, onStatus, onToast }: {
  app: GuestApplicationRow; allRows: GuestApplicationRow[]; busy: boolean;
  onStatus: (id: string, s: GuestApplicationStatus, note: string) => void; onToast: (m: string) => void;
}) {
  const [note, setNote] = useState(app.operatorNote ?? '');
  const [pass, setPass] = useState<ScheduleGuestPass | null | 'loading'>('loading');
  useEffect(() => { setNote(app.operatorNote ?? ''); }, [app.id, app.operatorNote]);
  useEffect(() => {
    let c = false; setPass('loading');
    fetchScheduleGuestPass(app.scheduleId).then((p) => { if (!c) setPass(p); }).catch(() => { if (!c) setPass(null); });
    return () => { c = true; };
  }, [app.scheduleId]);

  const candidates = useMemo(() => approvedKdkCandidates(allRows, app.scheduleId), [allRows, app.scheduleId]);
  const row = (label: string, value?: string | null) => (value && value.trim() ? (
    <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.6 }}>
      <span style={{ flexShrink: 0, minWidth: 74, fontWeight: 800, color: '#94A3B8' }}>{label}</span>
      <span style={{ fontWeight: 700, color: '#0F172A', wordBreak: 'break-word' }}>{value}</span>
    </div>
  ) : null);

  const passActive = pass && pass !== 'loading' && pass.isActive && pass.publicToken;
  const passUrl = passActive ? buildGuestPassUrl({ token: (pass as ScheduleGuestPass).publicToken, origin: typeof window !== 'undefined' ? window.location.origin : '' }) : '';

  const copyLink = async () => { if (!passUrl) return; try { await copyText(passUrl); onToast('Guest Pass 링크를 복사했습니다.'); } catch { onToast('복사에 실패했습니다.'); } };
  const copyKakao = async () => {
    const token = passActive ? (pass as ScheduleGuestPass).publicToken : null;
    if (!token) return;
    try {
      const { data } = await supabase.rpc('get_public_guest_pass', { p_token: token });
      if (!data) { onToast('안내문 데이터를 불러오지 못했습니다.'); return; }
      const msg = buildKakaoMessage({ data: data as any, guestPassUrl: passUrl });
      await copyText(msg); onToast('카카오 안내문을 복사했습니다.');
    } catch { onToast('안내문 복사에 실패했습니다.'); }
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <Phone size={13} color="#94A3B8" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 800, color: '#0F172A' }}>{app.phone}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FEF3C7', padding: '1px 7px', borderRadius: 999 }}>개인정보 · 화면 캡처 주의</span>
        </div>
        {row('지역', app.region)}
        {row('소속', app.affiliationType === 'independent' ? '무소속' : app.clubName)}
        {row('구력', app.tennisExperience)}
        {row('대회 성적', app.bestResult)}
        {row('신청 메모', app.note)}
        {row('신청일', new Date(app.createdAt).toLocaleString('ko-KR'))}
        {app.reviewedAt && row('최종 처리', `${new Date(app.reviewedAt).toLocaleString('ko-KR')}`)}
      </div>

      {/* 운영진 메모 + 상태 변경 */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 4 }}>운영진 메모</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="내부 메모(공개되지 않음)"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: 9, fontSize: 13, fontWeight: 500, color: '#0F172A', resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => onStatus(app.id, 'approved', note)} style={{ ...btnGhost, color: '#047857', borderColor: '#A7F3D0', opacity: busy ? 0.5 : 1 }}>승인</button>
          <button type="button" disabled={busy} onClick={() => onStatus(app.id, 'on_hold', note)} style={{ ...btnGhost, color: '#4338CA', borderColor: '#C7D2FE', opacity: busy ? 0.5 : 1 }}>보류</button>
          <button type="button" disabled={busy} onClick={() => onStatus(app.id, 'rejected', note)} style={{ ...btnGhost, color: '#B91C1C', borderColor: '#FCA5A5', opacity: busy ? 0.5 : 1 }}>거절</button>
        </div>
      </div>

      {/* Guest Pass 연결 (정모 공통 링크 재사용) */}
      <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
        <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>Guest Pass (정모 공통)</div>
        {pass === 'loading' ? (
          <div style={{ fontSize: 11.5, color: '#94A3B8' }}>확인 중…</div>
        ) : passActive ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <a href={passUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ExternalLink size={13} /> Guest Pass 열기</a>
            <button type="button" onClick={copyLink} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Copy size={13} /> 링크 복사</button>
            <button type="button" onClick={copyKakao} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Copy size={13} /> 카카오 안내문 복사</button>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#B45309', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ShieldAlert size={13} /> Guest Pass 비활성 — 해당 정모 설정에서 활성화가 필요합니다(자동 활성화 안 함).
          </div>
        )}
      </div>

      {/* 승인 게스트 KDK 후보 */}
      {candidates.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#F0FDFA', border: '1px solid #99F6E4' }}>
          <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F766E', marginBottom: 4 }}>KDK 후보(승인 게스트 · 이 정모)</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{candidates.map((c) => `${c.displayName}(G)`).join(' · ')}</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: '#5EEAD4', marginTop: 3 }}>KDK 운영 화면에서 게스트로 직접 추가하세요(자동 등록되지 않습니다).</div>
        </div>
      )}
    </div>
  );
}

export default function AdminGuestApplicationsPage() {
  const { role, isLoading } = useAuth();
  const [rows, setRows] = useState<GuestApplicationRow[]>([]);
  const [summaries, setSummaries] = useState<RecruitmentSummary[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | GuestApplicationStatus>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const allowed = canManageGuestApplications(role);
  const { refresh: refreshPending } = useGuestPending();

  const reload = useCallback(async () => {
    setLoading(true);
    const [apps, recs] = await Promise.all([fetchGuestApplications(), fetchAdminRecruitmentSummaries()]);
    setReady(apps.ready); setRows(apps.rows); setSummaries(recs.rows); setLoading(false);
  }, []);
  useEffect(() => { if (allowed) void reload(); }, [allowed, reload]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const onStatus = async (id: string, s: GuestApplicationStatus, note: string) => {
    if (busy) return; setBusy(true);
    try {
      await setGuestApplicationStatus(id, s, note);
      setToast(`상태를 '${statusMeta(s).t}'(으)로 변경했습니다.`);
      // 목록 재조회 + 상단/사이드바 배지 갱신을 한 번에.
      await reload();
      await refreshPending();
    }
    catch (e: any) { setToast(guestOperatorMessage(e)); }
    finally { setBusy(false); }
  };

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  if (!isLoading && !allowed) {
    return <div style={{ padding: 24, fontSize: 13, fontWeight: 700, color: '#0F172A' }}>이 화면은 CEO / ADMIN / OPERATOR(게스트 담당)만 이용할 수 있습니다.</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
        <UserPlus size={18} style={{ color: '#0D9488' }} /> 게스트 신청
      </h1>
      <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: '#64748B' }}>
        공개 게스트 신청을 검토하고 승인·보류·거절합니다. 전화번호는 목록에서 마스킹, 상세에서만 표시됩니다.
      </p>
      {toast && <div style={{ marginBottom: 10, fontSize: 12.5, fontWeight: 700, color: '#0F766E' }}>{toast}</div>}

      {/* 검토 대기 요약 배너 — pending>0 일 때만(과한 빈 배지 금지) */}
      {ready && pendingCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: '#FEF3C7', border: '1px solid #FDE68A' }}>
          <span style={{ minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#92400E' }}>검토가 필요한 게스트 신청이 {pendingCount}건 있습니다.</span>
        </div>
      )}

      {/* 모집 현황 요약 (정모별 상태·정원·신청/승인 + Club Schedule 링크) */}
      {summaries.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A', marginBottom: 8 }}>모집 현황</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summaries.map((r) => {
              const remaining = r.maxGuests != null ? Math.max(0, r.maxGuests - r.approved) : null;
              const st = ({ draft: '초안', open: '모집 중', closed: '마감', completed: '완료', cancelled: '취소' } as Record<string, string>)[r.status] || r.status;
              return (
                <div key={r.scheduleId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, background: '#F8FAFC', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: r.status === 'open' ? '#047857' : '#64748B', background: r.status === 'open' ? '#DCFCE7' : '#E2E8F0' }}>{st}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                    신청 {r.total} · 대기 {r.pending} · 승인 {r.approved}{r.maxGuests != null ? ` / ${r.maxGuests} · 잔여 ${remaining}` : ' · 정원 무제한'}
                  </span>
                  <Link href={`/club-schedule/${r.scheduleId}`} style={{ fontSize: 11, fontWeight: 800, color: '#2563EB', textDecoration: 'none' }}>모집 설정 →</Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 필터 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setFilter('all')} style={chip(filter === 'all')}>전체 {rows.length}</button>
        {STATUS.map((s) => <button key={s.v} type="button" onClick={() => setFilter(s.v)} style={chip(filter === s.v)}>{s.t}{s.v === 'pending' && pendingCount > 0 ? ` ${pendingCount}` : ''}</button>)}
      </div>

      {loading ? (
        <div style={{ ...card, textAlign: 'center', color: '#94A3B8', fontSize: 12.5, fontWeight: 700 }}>불러오는 중…</div>
      ) : !ready ? (
        <div style={{ ...card, textAlign: 'center', color: '#B45309', fontSize: 12.5, fontWeight: 700 }}>게스트 신청 저장소가 아직 준비되지 않았습니다(운영 SQL 적용 대기).</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: '#94A3B8', fontSize: 12.5, fontWeight: 700 }}>신청이 없습니다.</div>
      ) : (
        filtered.map((r) => {
          const open = openId === r.id;
          return (
            <div key={r.id} style={card}>
              <button type="button" onClick={() => setOpenId(open ? null : r.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: '#0F172A' }}>{r.name}</span>
                <StatusBadge v={r.status} />
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>{maskPhone(r.phone)}</span>
              </button>
              <div style={{ marginTop: 3, fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                {r.tennisExperience} · {r.affiliationType === 'independent' ? '무소속' : r.clubName} · {r.region}
              </div>
              {open && <Detail app={r} allRows={rows} busy={busy} onStatus={onStatus} onToast={setToast} />}
            </div>
          );
        })
      )}
      <div style={{ height: 40 }} aria-hidden />
    </div>
  );
}
