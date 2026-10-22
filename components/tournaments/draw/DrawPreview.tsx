'use client';

// Admin — 예선 대진표 미리보기(공개 전 검수).
//
//   참가자 공개 화면과 같은 컴포넌트(PublicDrawBoard · PublicGroupDetail · PublicPlacementDetail · 출전 신고 안내)를
//   본부 조회 데이터(get_preliminary_standings · get_admin_match_board · get_admin_group_schedule)로 그린다.
//   ⚠ 읽기 전용. DRAW 공개 · 조편성 잠금 · 일정 어느 것도 바꾸지 않는다(쓰기 RPC 호출 없음).
//   ⚠ 데이터 모양 · 표시 규칙은 공개 RPC 와 같다(drawPreviewModel) — 코트는 진행 중일 때만, 점수는 완료일 때만.

import React from 'react';
import Link from 'next/link';
import { ChevronLeft, Eye, RefreshCw, ShieldAlert, CalendarClock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { fetchPreliminaryStandings } from '@/lib/tournaments/standingsAdminService';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import { fetchAdminGroupSchedule, type AdminGroupSchedule } from '@/lib/tournaments/groupScheduleService';
import { previewDraw, previewSchedule } from '@/lib/tournaments/drawPreviewModel';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import type { PublicGroupSchedule } from '@/lib/tournaments/groupScheduleModel';
import { TT } from '@/components/tournaments/tournamentTheme';
import { DrawHeading } from '@/components/tournaments/draw/PublicDrawShell';
import PublicDrawBoard from '@/components/tournaments/draw/PublicDrawBoard';
import PublicGroupDetail from '@/components/tournaments/draw/PublicGroupDetail';
import PublicPlacementDetail from '@/components/tournaments/draw/PublicPlacementDetail';
import { ScheduleNotice } from '@/components/tournaments/draw/PublicScheduleInfo';
import TestTournamentBanner from '@/components/tournaments/TestTournamentBanner';

const WIDTHS = [320, 360, 375, 390, 430] as const;
const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 34, padding: '6px 11px',
  borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', color: '#475569',
  fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
};

interface PreviewData {
  draw: PublicPreliminaryDraw;
  schedule: PublicGroupSchedule | null;
  drawStatus: string;
  published: boolean;
}

function useDrawPreview(slug: string) {
  const [data, setData] = React.useState<PreviewData | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const load = React.useCallback(async () => {
    try {
      const [st, board, sched] = await Promise.all([
        fetchPreliminaryStandings(slug),
        fetchMatchBoard(slug).then((r) => r.board).catch(() => null),
        fetchAdminGroupSchedule(slug).catch(() => ({ ready: false, data: null as AdminGroupSchedule | null })),
      ]);
      if (!st.ready || !st.standings) { setState('empty'); return; }
      setData({
        draw: previewDraw(st.standings, board),
        schedule: previewSchedule(sched.data),
        drawStatus: board?.drawStatus ?? sched.data?.drawStatus ?? 'draft',
        published: !!sched.data?.drawPublishedAt,
      });
      setState('ready');
    } catch { setState('error'); }
  }, [slug]);
  React.useEffect(() => { void load(); }, [load]);
  return { data, state, reload: load };
}

export default function DrawPreview({ slug, view, groupNo }: { slug: string; view: 'list' | 'group' | 'placement'; groupNo?: number }) {
  const { role } = useAuth();
  const event = getOfficialTournament(slug);
  const { data, state, reload } = useDrawPreview(slug);
  const [width, setWidth] = React.useState<number>(390);
  const base = `/admin/tournaments/${slug}/draw-preview`;

  if (!isFullAdminRole(role)) {
    return (
      <div style={{ display: 'flex', gap: 9, padding: 15, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
        <ShieldAlert size={17} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>이 화면은 CEO · ADMIN 만 사용할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Link href={event ? '/admin/teyeon-open' : `/admin/tournaments/${slug}/teams`} style={pill}>
          <ChevronLeft size={15} strokeWidth={2.4} />{event ? 'TEYEON OPEN' : '팀 관리'}
        </Link>
        <Link href={`/admin/tournaments/${slug}/schedule`} data-preview-nav="schedule" style={pill}><CalendarClock size={14} />조별 일정</Link>
        <button type="button" data-preview-action="reload" onClick={() => void reload()} style={pill}><RefreshCw size={14} />다시 불러오기</button>
      </div>
      <TestTournamentBanner slug={slug} style={{ marginBottom: 12 }} />

      <div data-preview-banner style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', marginBottom: 12, borderRadius: 12,
        background: '#EEF2FF', border: '1px solid #C7D2FE',
      }}>
        <Eye size={18} color="#3730A3" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#1E1B4B' }}>
            참가자 화면 미리보기 · 지금 참가자에게는 <span data-preview-published={data?.published ? '1' : '0'}>{data ? (data.published ? '공개 중' : '공개 전(안내 문구만 보임)') : '확인 중'}</span>
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 600, color: '#3730A3', lineHeight: 1.6, wordBreak: 'keep-all' }}>
            이 화면은 DRAW 공개 · 조편성 잠금 · 일정을 바꾸지 않습니다. {data && data.drawStatus !== 'locked' ? '조편성이 아직 잠기지 않았습니다 — 공개하려면 먼저 잠가야 합니다.' : ''}
          </p>
        </div>
      </div>

      <div role="group" aria-label="미리보기 폭" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {WIDTHS.map((w) => (
          <button key={w} type="button" data-preview-width={w} aria-pressed={width === w} onClick={() => setWidth(w)}
            style={{ ...pill, background: width === w ? '#0F172A' : '#fff', color: width === w ? '#fff' : '#475569' }}>{w}px</button>
        ))}
      </div>

      {/* 공개 화면은 '화면 폭' 기준 규칙(560px 미만 1열 · 좌우 18px)을 쓴다. 미리보기 폭은 모두 430px 이하이므로
          PC 에서 열어도 휴대폰과 같게 그 두 규칙을 프레임 안에 고정한다. */}
      <style>{`.tt-preview-frame .tt-container { max-width: 100% !important; padding-left: 18px !important; padding-right: 18px !important; }
        .tt-preview-frame .stg-grid { grid-template-columns: minmax(0, 1fr) !important; }`}</style>
      <div data-preview-frame className="tt-preview-frame" style={{
        width: '100%', maxWidth: width, margin: '0 auto', background: TT.bg, border: '1px solid #CBD5E1', borderRadius: 18,
        overflow: 'hidden', boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
      }}>
        <div className="tt-container" style={{ paddingTop: 18, paddingBottom: 28 }}>
          {state === 'loading' ? (
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: TT.muted }}>불러오는 중…</p>
          ) : state === 'empty' ? (
            <p data-preview-empty style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: TT.muted, lineHeight: 1.6 }}>조편성 정보가 없습니다. 예선 조 편성을 먼저 만들어 주세요.</p>
          ) : state === 'error' || !data ? (
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#B91C1C' }}>미리보기를 불러오지 못했습니다.</p>
          ) : view === 'group' ? (
            <PublicGroupDetail slug={slug} draw={data.draw} groupNo={groupNo ?? -1} schedule={data.schedule} basePath={base} />
          ) : view === 'placement' ? (
            <PublicPlacementDetail slug={slug} draw={data.draw} basePath={base} schedule={data.schedule} />
          ) : (
            <>
              <DrawHeading title="대진표" sub={event ? event.titleFull : slug} />
              <ScheduleNotice schedule={data.schedule} />
              <PublicDrawBoard slug={slug} draw={data.draw} schedule={data.schedule} basePath={base} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
