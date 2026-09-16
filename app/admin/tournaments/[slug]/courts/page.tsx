'use client';

export const dynamic = 'force-dynamic';

// Admin — Tournament Court 관리 (Batch 1).
//
//   ⚠ 최종 Control Center 디자인이 아니다. 데이터 구조·RPC 검증용 최소 기능 UI다.
//     기존 Admin 화면 스타일만 재사용하고 새 디자인 시스템을 만들지 않는다.
//
//   ⚠ 코트 번호를 코드에 하드코딩하지 않는다. 몇 면을 쓰는지는 전적으로 이 화면에서 정한다.
//   ⚠ LIVE 중계 코트(feature court)는 대회당 1면이며 DB partial unique index 가 강제한다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronLeft, ShieldAlert, RefreshCw, LayoutGrid, AlertTriangle, Radio, Plus, Trash2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import {
  fetchAdminCourts, upsertCourt, setFeatureCourt, deleteCourt, drawActionMessage,
} from '@/lib/tournaments/drawAdminService';
import { courtDisplayName, type TournamentCourt } from '@/lib/tournaments/drawTypes';

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 15, marginBottom: 10,
};
const label: React.CSSProperties = {
  margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8',
};
const btn = (tone: 'primary' | 'plain' | 'danger' = 'plain'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 34, padding: '7px 12px', borderRadius: 8,
  border: `1px solid ${tone === 'primary' ? '#0E8C80' : tone === 'danger' ? '#FCA5A5' : '#E2E8F0'}`,
  background: tone === 'primary' ? '#0E8C80' : '#fff',
  color: tone === 'primary' ? '#fff' : tone === 'danger' ? '#B91C1C' : '#475569',
  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
});
const input: React.CSSProperties = {
  minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: 36, padding: '8px 10px',
  borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
  fontFamily: 'inherit', fontSize: 13, color: '#0F172A',
};

export default function AdminTournamentCourtsPage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string' ? params.slug
      : Array.isArray(params?.slug) ? params!.slug[0] : '';

  const { role } = useAuth();
  const allowed = isFullAdminRole(role);

  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(true);
  const [rows, setRows] = React.useState<TournamentCourt[]>([]);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [newNo, setNewNo] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [bulkN, setBulkN] = React.useState('');

  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const load = React.useCallback(async () => {
    if (!allowed || !slug) return;
    setLoading(true);
    try {
      const r = await fetchAdminCourts(slug);
      setReady(r.ready);
      setRows(r.rows);
    } catch (err) {
      setReady(false);
      say(drawActionMessage(err));
    } finally {
      setLoading(false);
    }
  }, [allowed, slug, say]);

  React.useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      say(await fn());
      await load();
    } catch (err) {
      say(drawActionMessage(err));
    } finally {
      setBusy('');
    }
  };

  if (!allowed) {
    return (
      <div style={{ display: 'flex', gap: 9, padding: 15, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
        <ShieldAlert size={18} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0F172A', lineHeight: 1.6 }}>
          이 메뉴는 CEO·ADMIN 전용입니다.
        </p>
      </div>
    );
  }

  const activeCount = rows.filter((c) => c.status === 'active').length;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link
          href={`/admin/tournaments/${slug}/teams`}
          aria-label="팀 관리"
          style={{
            width: 30, height: 30, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#475569', textDecoration: 'none', flexShrink: 0,
          }}
        >
          <ChevronLeft size={16} />
        </Link>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 900, color: '#0F172A' }}>
            <LayoutGrid size={15} strokeWidth={2.4} color="#0E8C80" />
            코트 관리
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', wordBreak: 'break-all' }}>
            {slug} · 사용 가능 {activeCount}면 / 전체 {rows.length}면
          </p>
        </div>
        <button type="button" onClick={() => void load()} style={btn()}>
          <RefreshCw size={13} strokeWidth={2.4} />
          {loading ? '조회 중' : '새로고침'}
        </button>
      </div>

      {!ready && (
        <div style={{ ...card, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: 9 }}>
          <AlertTriangle size={17} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
            코트 테이블이 아직 적용되지 않았습니다. <br />
            <code style={{ fontSize: 11.5 }}>supabase/add_hosted_tournament_courts.sql</code> 적용 후 다시 조회해 주세요.
          </p>
        </div>
      )}

      {/* 추가 */}
      <div style={card}>
        <p style={label}>ADD COURT</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 92 }}>
            <p style={{ ...label, fontSize: 10.5 }}>번호</p>
            <input
              style={{ ...input, marginTop: 5 }} inputMode="numeric" placeholder="1~30" value={newNo}
              onChange={(e) => setNewNo(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <p style={{ ...label, fontSize: 10.5 }}>표시 이름(선택)</p>
            <input
              style={{ ...input, marginTop: 5 }} placeholder="비우면 'N번 코트'" value={newName}
              maxLength={30} onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={!newNo || busy === 'add'}
            onClick={() =>
              void run('add', async () => {
                await upsertCourt({ slug, courtNo: Number(newNo), displayName: newName || null });
                setNewNo(''); setNewName('');
                return '코트를 추가했습니다.';
              })
            }
            style={{ ...btn('primary'), minHeight: 36, opacity: newNo ? 1 : 0.5 }}
          >
            <Plus size={13} strokeWidth={2.6} />
            추가
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end', paddingTop: 12, borderTop: '1px solid #F1F5F9', flexWrap: 'wrap' }}>
          <div style={{ width: 92 }}>
            <p style={{ ...label, fontSize: 10.5 }}>일괄 생성</p>
            <input
              style={{ ...input, marginTop: 5 }} inputMode="numeric" placeholder="예: 10" value={bulkN}
              onChange={(e) => setBulkN(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
            />
          </div>
          <button
            type="button"
            disabled={!bulkN || busy === 'bulk'}
            onClick={() =>
              void run('bulk', async () => {
                const n = Math.min(Number(bulkN), 30);
                for (let i = 1; i <= n; i += 1) {
                  // 이미 있는 번호는 서버가 update 로 처리하므로 그대로 두어도 안전하다.
                  await upsertCourt({ slug, courtNo: i });
                }
                setBulkN('');
                return `1~${n}번 코트를 준비했습니다.`;
              })
            }
            style={{ ...btn(), minHeight: 36, opacity: bulkN ? 1 : 0.5 }}
          >
            1번부터 순서대로 생성
          </button>
        </div>
      </div>

      {/* 목록 */}
      <div style={card}>
        <p style={label}>COURTS</p>
        {rows.length === 0 ? (
          <p style={{ margin: '12px 0 0', fontSize: 12.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7 }}>
            {loading ? '조회 중…' : ready ? '등록된 코트가 없습니다.' : '조회할 수 없습니다.'}
          </p>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column' }}>
            {rows.map((c) => {
              const off = c.status === 'disabled';
              return (
                <div
                  key={c.id}
                  style={{
                    borderTop: '1px solid #F1F5F9', padding: '11px 0',
                    display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
                    opacity: off ? 0.6 : 1,
                  }}
                >
                  <span style={{ flexShrink: 0, minWidth: 30, fontSize: 12.5, fontWeight: 800, color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                    {c.courtNo}
                  </span>
                  <p style={{
                    margin: 0, flex: 1, minWidth: 100, fontSize: 13.5, fontWeight: 800, color: '#0F172A',
                    textDecoration: off ? 'line-through' : 'none', wordBreak: 'keep-all',
                  }}>
                    {courtDisplayName(c)}
                  </p>

                  {c.isFeatureCourt && (
                    <span style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 999,
                      color: '#fff', background: '#DC2626',
                    }}>
                      <Radio size={10} strokeWidth={3} />
                      LIVE
                    </span>
                  )}

                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() =>
                      void run(c.id, async () => {
                        await setFeatureCourt(slug, c.isFeatureCourt ? null : c.courtNo);
                        return c.isFeatureCourt ? 'LIVE 중계 코트 지정을 해제했습니다.' : `${c.courtNo}번을 LIVE 중계 코트로 지정했습니다.`;
                      })
                    }
                    style={{ ...btn(), minHeight: 28, padding: '4px 9px', fontSize: 11.5 }}
                  >
                    {c.isFeatureCourt ? 'LIVE 해제' : 'LIVE 지정'}
                  </button>

                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() =>
                      void run(c.id, async () => {
                        await upsertCourt({ slug, courtNo: c.courtNo, status: off ? 'active' : 'disabled' });
                        return off ? '사용 가능으로 변경했습니다.' : '사용 중지로 변경했습니다.';
                      })
                    }
                    style={{ ...btn(), minHeight: 28, padding: '4px 9px', fontSize: 11.5 }}
                  >
                    {off ? '사용' : '중지'}
                  </button>

                  <button
                    type="button"
                    disabled={busy === c.id}
                    aria-label={`${c.courtNo}번 코트 삭제`}
                    onClick={() =>
                      void run(c.id, async () => {
                        await deleteCourt(slug, c.courtNo);
                        return '코트를 삭제했습니다.';
                      })
                    }
                    style={{ ...btn('danger'), minHeight: 28, padding: '4px 9px', fontSize: 11.5 }}
                  >
                    <Trash2 size={12} strokeWidth={2.4} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ margin: '12px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7, wordBreak: 'keep-all' }}>
          LIVE 중계 코트는 대회당 1면입니다. 다른 코트를 지정하면 기존 지정은 자동으로 해제됩니다.
          경기 배정이 생기는 후속 단계에서는 사용 중인 코트의 삭제가 차단됩니다.
        </p>
      </div>

      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
            maxWidth: 'calc(100vw - 32px)', padding: '11px 16px', borderRadius: 10,
            background: '#0F172A', color: '#fff', fontSize: 12.5, fontWeight: 700,
            lineHeight: 1.6, zIndex: 60, wordBreak: 'keep-all', textAlign: 'center',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
