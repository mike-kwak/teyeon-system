'use client';

export const dynamic = 'force-dynamic';

// Admin — Tournament Team 관리 (Batch 1).
//
//   ⚠ 이 화면은 최종 Control Center 디자인이 아니다.
//     데이터 구조 확인 · RPC 검증 · Team 관리 동작 검증을 위한 최소 기능 UI다.
//     Group Assignment / Knockout / Control Center / Arena TV 디자인 확정 후 통합·고도화한다.
//     따라서 새 디자인 시스템을 만들지 않고 기존 Admin 화면(신청 목록) 스타일을 그대로 쓴다.
//
//   ⚠ 승격(promote)은 confirmed 접수만 대상이며 접수 데이터를 읽기만 한다(수정·삭제 없음).
//     실제 운영 대회 승격은 참가접수 마감 후에 하는 것이 기본 운영 방침이므로,
//     fixture 가 아닌 대회에서는 아래 체크박스를 켜야 버튼이 열린다(UI 1차 방어선).
//     최종 판정은 서버 RPC 가 한다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronLeft, ShieldAlert, RefreshCw, Users, AlertTriangle, Check, FlaskConical,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import {
  fetchAdminTeams, promoteConfirmedRegistrations, updateTeam,
  fetchFixtureTournaments, seedFixtureTournament, drawActionMessage,
} from '@/lib/tournaments/drawAdminService';
import {
  FIXTURE_SCENARIOS, teamDisplayName,
  type FixtureTournament, type TournamentTeam,
} from '@/lib/tournaments/drawTypes';

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
  minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: 34, padding: '7px 9px',
  borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
  fontFamily: 'inherit', fontSize: 13, color: '#0F172A',
};

const SOURCE_TONE: Record<string, { t: string; c: string; bg: string }> = {
  registration: { t: '접수', c: '#1D4ED8', bg: '#EFF6FF' },
  fixture: { t: 'FIXTURE', c: '#7C3AED', bg: '#F5F3FF' },
  manual: { t: '수동', c: '#475569', bg: '#F1F5F9' },
};

export default function AdminTournamentTeamsPage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string' ? params.slug
      : Array.isArray(params?.slug) ? params!.slug[0] : '';

  const { role } = useAuth();
  const allowed = isFullAdminRole(role);
  const isFixture = slug.startsWith('fixture-');

  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(true);
  const [rows, setRows] = React.useState<TournamentTeam[]>([]);
  const [fixtures, setFixtures] = React.useState<FixtureTournament[]>([]);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [promoteAck, setPromoteAck] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editNo, setEditNo] = React.useState('');
  const [editSeed, setEditSeed] = React.useState('');

  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const load = React.useCallback(async () => {
    if (!allowed || !slug) return;
    setLoading(true);
    try {
      const [t, f] = await Promise.all([fetchAdminTeams(slug), fetchFixtureTournaments()]);
      setReady(t.ready);
      setRows(t.rows);
      setFixtures(f.rows);
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

  const canPromote = isFixture || promoteAck;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link
          href={`/admin/tournaments/${slug}/registrations`}
          aria-label="신청 목록"
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
            <Users size={15} strokeWidth={2.4} color="#0E8C80" />
            Tournament Team
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', wordBreak: 'break-all' }}>
            {slug}{isFixture ? ' · FIXTURE' : ''}
          </p>
        </div>
        <button type="button" onClick={() => void load()} style={btn()}>
          <RefreshCw size={13} strokeWidth={2.4} />
          {loading ? '조회 중' : '새로고침'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Link href={`/admin/tournaments/${slug}/groups`} style={{ ...btn(), textDecoration: 'none' }}>
          예선 조편성
        </Link>
        <Link href={`/admin/tournaments/${slug}/matches`} style={{ ...btn(), textDecoration: 'none' }}>
          경기 운영
        </Link>
        <Link href={`/admin/tournaments/${slug}/standings`} style={{ ...btn(), textDecoration: 'none' }}>
          예선 순위
        </Link>
        <Link href={`/admin/tournaments/${slug}/courts`} style={{ ...btn(), textDecoration: 'none' }}>
          코트 관리
        </Link>
      </div>

      {!ready && (
        <div style={{ ...card, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: 9 }}>
          <AlertTriangle size={17} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
            Tournament 운영 테이블이 아직 적용되지 않았습니다. <br />
            <code style={{ fontSize: 11.5 }}>supabase/add_hosted_tournament_events → teams → courts → fixture</code> 순서로 적용한 뒤 다시 조회해 주세요.
          </p>
        </div>
      )}

      {/* 승격 */}
      <div style={card}>
        <p style={label}>PROMOTE</p>
        <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: '#0F172A', lineHeight: 1.7, wordBreak: 'keep-all' }}>
          참가확정(confirmed) 신청을 Tournament Team으로 승격합니다. 여러 번 실행해도 중복 생성되지 않습니다.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7, wordBreak: 'keep-all' }}>
          선수 이름은 승격 시점 값으로 고정됩니다. 접수 데이터는 읽기만 하며 수정·삭제하지 않습니다.
        </p>

        {!isFixture && (
          <label
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 11, padding: '11px 12px',
              borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={promoteAck}
              onChange={(e) => setPromoteAck(e.target.checked)}
              style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: '#B91C1C' }}
            />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.65, wordBreak: 'keep-all' }}>
              실제 운영 대회입니다. 참가접수 마감 후 승격하는 것이 기본 방침입니다. 지금 승격을 진행합니다.
            </span>
          </label>
        )}

        <button
          type="button"
          disabled={!canPromote || busy === 'promote'}
          onClick={() =>
            void run('promote', async () => {
              const r = await promoteConfirmedRegistrations(slug);
              return `승격 완료 — 신규 ${r.inserted}팀 / 기존 ${r.alreadyPromoted}팀 / 확정 접수 ${r.confirmedTotal}건`;
            })
          }
          style={{
            ...btn(canPromote ? 'primary' : 'plain'),
            marginTop: 11, width: '100%', minHeight: 44,
            opacity: 1,
            background: canPromote ? '#0E8C80' : '#E3E9ED',
            color: canPromote ? '#fff' : '#64748B',
            borderColor: canPromote ? '#0E8C80' : '#E3E9ED',
            cursor: canPromote ? 'pointer' : 'not-allowed',
          }}
        >
          {busy === 'promote' ? '승격 중…' : 'confirmed 접수 승격'}
        </button>
      </div>

      {/* 팀 목록 */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <p style={label}>TEAMS</p>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A' }}>{rows.length}팀</p>
        </div>

        {rows.length === 0 ? (
          <p style={{ margin: '12px 0 0', fontSize: 12.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7 }}>
            {loading ? '조회 중…' : ready ? '아직 팀이 없습니다.' : '조회할 수 없습니다.'}
          </p>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column' }}>
            {rows.map((t) => {
              const tone = SOURCE_TONE[t.source] || SOURCE_TONE.manual;
              const open = editId === t.id;
              const off = t.status === 'withdrawn';
              return (
                <div
                  key={t.id}
                  style={{
                    borderTop: '1px solid #F1F5F9', padding: '11px 0',
                    opacity: off ? 0.62 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ flexShrink: 0, minWidth: 30, fontSize: 12.5, fontWeight: 800, color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                      {t.teamNo}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{
                        margin: 0, fontSize: 13.5, fontWeight: 800, color: '#0F172A', lineHeight: 1.5,
                        wordBreak: 'keep-all', textDecoration: off ? 'line-through' : 'none',
                      }}>
                        {teamDisplayName(t)}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                        {t.player1ClubName || '클럽 미입력'} / {t.player2ClubName || '클럽 미입력'}
                        {t.seedNo !== null ? ` · 시드 ${t.seedNo}` : ''}
                      </p>
                    </div>
                    <span style={{
                      flexShrink: 0, fontSize: 10.5, fontWeight: 800, padding: '3px 7px', borderRadius: 999,
                      color: tone.c, background: tone.bg,
                    }}>
                      {tone.t}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(open ? null : t.id);
                        setEditNo(String(t.teamNo));
                        setEditSeed(t.seedNo === null ? '' : String(t.seedNo));
                      }}
                      style={{ ...btn(), minHeight: 28, padding: '4px 8px', fontSize: 11.5 }}
                    >
                      {open ? '닫기' : '수정'}
                    </button>
                  </div>

                  {open && (
                    <div style={{ marginTop: 10, padding: 11, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ ...label, fontSize: 10.5 }}>팀 번호</p>
                          <input
                            style={{ ...input, marginTop: 5 }} inputMode="numeric" value={editNo}
                            onChange={(e) => setEditNo(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ ...label, fontSize: 10.5 }}>시드(선택)</p>
                          <input
                            style={{ ...input, marginTop: 5 }} inputMode="numeric" value={editSeed}
                            onChange={(e) => setEditSeed(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={busy === t.id}
                          onClick={() =>
                            void run(t.id, async () => {
                              await updateTeam({
                                teamId: t.id,
                                teamNo: editNo ? Number(editNo) : null,
                                seedNo: editSeed ? Number(editSeed) : null,
                                clearSeed: editSeed === '',
                              });
                              setEditId(null);
                              return '저장했습니다.';
                            })
                          }
                          style={btn('primary')}
                        >
                          <Check size={13} strokeWidth={2.6} />
                          저장
                        </button>
                        <button
                          type="button"
                          disabled={busy === t.id}
                          onClick={() =>
                            void run(t.id, async () => {
                              await updateTeam({ teamId: t.id, status: off ? 'active' : 'withdrawn' });
                              setEditId(null);
                              return off ? '참가 상태로 되돌렸습니다.' : '기권 처리했습니다.';
                            })
                          }
                          style={btn(off ? 'plain' : 'danger')}
                        >
                          {off ? '참가로 되돌리기' : '기권 처리'}
                        </button>
                      </div>
                      <p style={{ margin: '9px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                        선수 이름은 여기서 바꾸지 않습니다. 접수 쪽 선수 교체는 신청 목록 화면에서 처리합니다.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FIXTURE */}
      <div style={card}>
        <p style={{ ...label, display: 'flex', alignItems: 'center', gap: 5 }}>
          <FlaskConical size={12} strokeWidth={2.6} color="#7C3AED" />
          FIXTURE (개발/QA 전용)
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7, wordBreak: 'keep-all' }}>
          draft 상태의 별도 대회로 생성됩니다. 실제 참가신청이 있는 대회에서는 서버가 거부합니다.
          조 수·진출 수는 참고 계산이며 시스템이 조편성이나 본선 구조를 자동으로 정하지 않습니다.
        </p>

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column' }}>
          {FIXTURE_SCENARIOS.map((s) => {
            const made = fixtures.find((f) => f.slug === s.slug);
            return (
              <div key={s.slug} style={{ borderTop: '1px solid #F1F5F9', padding: '10px 0', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                    {s.teamCount}팀
                    {made ? (
                      <Link href={`/admin/tournaments/${s.slug}/teams`} style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 800, color: '#0E8C80', textDecoration: 'none' }}>
                        {made.teamCount}팀 · {made.courtCount}코트 →
                      </Link>
                    ) : null}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                    {s.groups}조 · 나머지 {s.remainder} · 진출 {s.qualifiers} — {s.note}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === s.slug}
                  onClick={() =>
                    void run(s.slug, async () => {
                      const r = await seedFixtureTournament({
                        slug: s.slug, title: s.title, teamCount: s.teamCount,
                        reset: !!made, courtCount: 10,
                      });
                      return `${s.slug} — ${r.teamsCreated}팀 / ${r.courtsCreated}코트 생성`;
                    })
                  }
                  style={{ ...btn(made ? 'plain' : 'primary'), flexShrink: 0, minHeight: 30, fontSize: 11.5 }}
                >
                  {busy === s.slug ? '생성 중…' : made ? '다시 생성' : '생성'}
                </button>
              </div>
            );
          })}
        </div>
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
