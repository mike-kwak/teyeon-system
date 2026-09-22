'use client';

export const dynamic = 'force-dynamic';

// Admin — TEYEON 주최 대회 목록.
//   접근: CEO/ADMIN. 서버(middleware) 1차 + admin layout 2차 + 이 페이지 3차 + RPC 내부 재검증.
//   ⚠ 복수형 /admin/tournaments 는 "주최 대회 접수 운영" 이다.
//      /tournament-calendar(회원 출전 대회 캘린더)와 무관하며 테이블도 분리되어 있다.

import React from 'react';
import Link from 'next/link';
import { Trophy, ShieldAlert, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { fetchAdminTournaments, type AdminHostedTournament } from '@/lib/tournaments/adminService';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E2E8F0',
  borderRadius: 14,
  padding: 16,
  marginBottom: 12,
};

const STATUS_LABEL: Record<string, { t: string; c: string; bg: string }> = {
  draft: { t: '비공개(준비)', c: '#475569', bg: '#F1F5F9' },
  published: { t: '공개', c: '#1D4ED8', bg: '#EFF6FF' },
  registration_open: { t: '접수중', c: '#047857', bg: '#DCFCE7' },
  registration_closed: { t: '접수마감', c: '#B45309', bg: '#FEF3C7' },
  in_progress: { t: '대회진행', c: '#7C3AED', bg: '#F3E8FF' },
  completed: { t: '종료', c: '#475569', bg: '#F1F5F9' },
  cancelled: { t: '취소', c: '#B91C1C', bg: '#FEE2E2' },
};

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: '#94A3B8' }}>
        {label}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 900, color: tone || '#0F172A', lineHeight: 1.2 }}>
        {value}
      </p>
    </div>
  );
}

export default function AdminTournamentsPage() {
  const { role } = useAuth();
  const allowed = isFullAdminRole(role);

  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(true);
  const [rows, setRows] = React.useState<AdminHostedTournament[]>([]);

  React.useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    fetchAdminTournaments()
      .then(({ ready, rows }) => {
        if (cancelled) return;
        setReady(ready);
        setRows(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
        <Trophy size={19} color="#2563EB" />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F172A' }}>대회 접수 운영</h1>
      </div>

      {loading && (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#94A3B8' }}>불러오는 중…</p>
        </div>
      )}

      {!loading && !ready && (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A' }}>준비 중입니다</p>
          <p style={{ margin: '7px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7 }}>
            주최 대회 접수 저장소가 아직 적용되지 않았습니다. 마이그레이션 적용 후 다시 확인해 주세요.
          </p>
        </div>
      )}

      {!loading && ready && rows.length === 0 && (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#64748B' }}>등록된 주최 대회가 없습니다.</p>
        </div>
      )}

      {rows.map((t) => {
        const s = STATUS_LABEL[t.status] ?? { t: t.status, c: '#475569', bg: '#F1F5F9' };
        return (
          <Link key={t.id} href={`/admin/tournaments/${t.slug}/registrations`} style={{ textDecoration: 'none' }}>
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0F172A', lineHeight: 1.4, wordBreak: 'keep-all' }}>
                    {t.title}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>
                    {t.eventDate} · 참가비 {t.entryFee.toLocaleString()}원
                  </p>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: 999,
                    color: s.c,
                    background: s.bg,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.t}
                </span>
                <ChevronRight size={16} color="#CBD5E1" style={{ flexShrink: 0 }} />
              </div>

              <div style={{ display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
                <Stat label="정상 참가" value={`${t.normalCount} / ${t.maxCapacity}`} />
                <Stat label="대기" value={t.waitlistedCount} tone={t.waitlistedCount > 0 ? '#B45309' : undefined} />
                <Stat label="입금완료" value={t.paidCount} tone="#047857" />
                <Stat label="참가확정" value={t.confirmedCount} tone="#1D4ED8" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
