'use client';

export const dynamic = 'force-dynamic';

// Admin — 본선 대진 만들기 (Batch 4B).
//
//   ★ 이 화면은 경기이사의 결정을 입력받는 도구다. 시스템이 정하는 것은 하나도 없다.
//     · 진출팀: 예선 결과는 '추천'일 뿐이다. 담기 버튼은 화면 초안만 채우고 저장하지 않는다.
//     · 구조: 라운드 이름 · 자리 수를 직접 적는다. 2:1 연결은 '초안'으로 만들어 보여줄 뿐이며
//       경기이사가 확인(필요하면 직접 수정)한 뒤 저장 버튼을 눌러야 반영된다.
//     · 1라운드 배치: 자리마다 '예선 순위 자리(N조 M위)' · 부전승 · 실제 팀 중 하나를 고른다.
//       TEYEON OPEN 기본 운영은 **예선 조 편성 전에 본선 경로를 먼저 정하는 것**이라
//       기본값이 '예선 순위 자리'다. 빈 자리를 BYE 로 자동으로 채우지 않는다.
//     · 두 행위를 끝까지 구분한다:
//         본선 경로 확정(lock)   = 1조 1위 vs 16조 2위 같은 경로를 고정
//         예선 결과 반영(resolve) = 1조 1위 → 실제 팀
//     · 2라운드 이후: 승자 대기(TBD) 읽기 전용.
//   ⚠ STEP 5(본선 경기 운영, 4C): 확정된 대진을 경기로 옮기고 결과를 입력한다.
//     · 경기를 '만드는' 것뿐이며 대진을 새로 짜지 않는다. BYE 는 경기가 아니라 카드도 없다.
//     · 완료는 한 번의 호출로 끝난다(완료 + 승자 전달). 화면이 두 단계로 나눠 부르지 않는다.
//     · 호명 · 호명취소 · 코트 배정은 예선과 같은 RPC 를 그대로 쓴다(본선 전용 복제 금지).
//   ⚠ 새 디자인 시스템을 만들지 않는다 — 기존 Admin 화면(신청/팀/조편성) 스타일을 그대로 쓴다.
//   ⚠ 저장 뒤에는 로컬 상태를 믿지 않고 항상 서버에서 다시 읽는다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronLeft, ShieldAlert, RefreshCw, AlertTriangle, Check, Lock, Unlock,
  ClipboardPaste, Trash2, Plus, Info, Undo2, Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import {
  fetchAdminBracket, createBracket, setBracketEntrants, setBracketStructure,
  assignBracketSlot, replaceBracketSlots, lockBracket, unlockBracket,
  materializeBracketMatches, completeKnockoutMatch, amendKnockoutMatchScore,
  resolveBracketQualifiers, unresolveBracketQualifier,
  bracketActionMessage,
} from '@/lib/tournaments/bracketAdminService';
import {
  BRACKET_DRIFT_TEXT, BRACKET_ISSUE_TEXT, KNOCKOUT_STATUS_TEXT,
  bracketTeamLabel, knockoutTeamLabel, qualifierSkipText,
  type AdminBracket, type BracketEntrant, type BracketEntrantSource, type EntrantInput,
  type RoundInput, type ConnectionInput, type KnockoutMatch, type BracketSlot,
  type ResolveQualifiersResult,
} from '@/lib/tournaments/bracketTypes';
import {
  parseBracketPaste, BRACKET_PASTE_BLOCKER_TEXT,
  type BracketMatchableTeam, type BracketPastePreview,
} from '@/lib/tournaments/bracketPasteParser';
import { callMatch, uncallMatch, startMatch } from '@/lib/tournaments/matchAdminService';
import { fetchAdminCourts } from '@/lib/tournaments/drawAdminService';
import type { TournamentCourt } from '@/lib/tournaments/drawTypes';
import { fetchPreliminaryStandings } from '@/lib/tournaments/standingsAdminService';
import type { PreliminaryStandings } from '@/lib/tournaments/standingsTypes';

// ── 기존 Admin 스타일 ───────────────────────────────────────────────────────
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
  width: '100%', boxSizing: 'border-box', minHeight: 36, padding: '8px 10px',
  borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff',
  fontFamily: 'inherit', fontSize: 13, color: '#0F172A', outline: 'none',
};
const note: React.CSSProperties = {
  margin: '4px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7, wordBreak: 'keep-all',
};
const StepHead = ({ no, title, desc }: { no: number; title: string; desc: string }) => (
  <>
    <p style={label}>STEP {no}</p>
    <p style={{ margin: '7px 0 0', fontSize: 14.5, fontWeight: 900, color: '#0F172A' }}>{title}</p>
    <p style={note}>{desc}</p>
  </>
);

type DraftEntrant = EntrantInput & {
  teamNo: number; player1Name: string; player2Name: string; teamStatus: 'active' | 'withdrawn';
  pending?: boolean;
};

export default function AdminTournamentBracketPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug
    : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const { role } = useAuth();
  const allowed = isFullAdminRole(role);

  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(true);
  const [data, setData] = React.useState<AdminBracket | null>(null);
  const [standings, setStandings] = React.useState<PreliminaryStandings | null>(null);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');

  // STEP 1 초안(저장 전까지 DB 와 무관)
  const [draft, setDraft] = React.useState<DraftEntrant[] | null>(null);
  // STEP 2 초안
  const [roundDraft, setRoundDraft] = React.useState<{ name: string; slots: string }[] | null>(null);
  const [connText, setConnText] = React.useState('');
  const [showConn, setShowConn] = React.useState(false);
  // STEP 3
  const [paste, setPaste] = React.useState('');
  const [preview, setPreview] = React.useState<BracketPastePreview | null>(null);
  /** 자리별 '예선 순위 자리' 입력 초안(저장 전). key = slotId */
  const [qDraft, setQDraft] = React.useState<Record<string, { g: string; r: string }>>({});
  /** 예선 결과 반영 결과 요약(반영/보류). */
  const [resolveResult, setResolveResult] = React.useState<ResolveQualifiersResult | null>(null);
  /** 되돌리기 입력 중인 자리 position. */
  const [undoPos, setUndoPos] = React.useState<number | null>(null);
  const [undoReason, setUndoReason] = React.useState('');
  /** STEP 1(보조 기능) 펼침 여부. 기본은 접어 둔다. */
  const [showStep1, setShowStep1] = React.useState(false);
  // STEP 4
  const [unlockReason, setUnlockReason] = React.useState('');
  // STEP 5 본선 경기 운영
  const [courts, setCourts] = React.useState<TournamentCourt[]>([]);
  const [courtPick, setCourtPick] = React.useState<Record<string, string>>({});
  const [scoreDraft, setScoreDraft] = React.useState<Record<string, { s1: string; s2: string }>>({});
  const [amendOpen, setAmendOpen] = React.useState('');
  const [amendReason, setAmendReason] = React.useState('');
  // 생성
  const [newTitle, setNewTitle] = React.useState('본선 토너먼트');
  const [newCount, setNewCount] = React.useState('');

  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 4200);
  }, []);

  const load = React.useCallback(async () => {
    if (!allowed || !slug) return;
    setLoading(true);
    try {
      const [b, s, c] = await Promise.all([
        fetchAdminBracket(slug),
        fetchPreliminaryStandings(slug).catch(() => ({ ready: false, standings: null })),
        fetchAdminCourts(slug).catch(() => ({ ready: false, rows: [] as TournamentCourt[] })),
      ]);
      setReady(b.ready);
      setData(b.data);
      setStandings(s.standings);
      setCourts(c.rows);
    } catch (err) {
      setReady(false);
      say(bracketActionMessage(err));
    } finally {
      setLoading(false);
    }
  }, [allowed, slug, say]);

  React.useEffect(() => { void load(); }, [load]);

  /** 저장 → 토스트 → 서버 재조회(authoritative refetch). 진행 중 중복 클릭 차단. */
  const run = async (key: string, fn: () => Promise<string>, after?: () => void) => {
    if (busy) return;
    setBusy(key);
    try {
      const msg = await fn();
      await load();
      after?.();
      say(msg);
    } catch (err) {
      say(bracketActionMessage(err));
      // 버전 충돌·검증 실패도 최신 상태를 다시 읽어 화면을 맞춘다.
      await load();
    } finally {
      setBusy('');
    }
  };

  const bracket = data?.bracket ?? null;
  const locked = bracket?.status !== 'draft' && !!bracket;
  const entrants = data?.entrants ?? [];
  const rounds = data?.rounds ?? [];
  const slots = data?.slots ?? [];
  const validation = data?.validation ?? null;
  const errors = (validation?.issues ?? []).filter((i) => i.severity === 'error');
  const warnings = (validation?.issues ?? []).filter((i) => i.severity === 'warning');

  const matches = data?.matches ?? [];
  const activeCourts = courts.filter((c) => c.status === 'active');
  /** 라운드별로 묶어 보여 준다. 순서는 서버가 보낸 대진 순서 그대로. */
  const matchesByRound = React.useMemo(() => {
    const out: { key: string; title: string; rows: KnockoutMatch[] }[] = [];
    for (const m of matches) {
      const title = m.roundName ?? `${m.roundNo}라운드`;
      const hit = out.find((g) => g.key === String(m.roundNo));
      if (hit) hit.rows.push(m);
      else out.push({ key: String(m.roundNo), title, rows: [m] });
    }
    return out;
  }, [matches]);

  /** 자리 하나를 화면 문구로. ⚠ 서버가 준 sourceLabel 을 그대로 쓴다. */
  const slotText = React.useCallback((s: BracketSlot | undefined): string => {
    if (!s) return '자리 없음';
    if (s.slotType === 'bye') return '부전승 (BYE)';
    if (s.slotType === 'qualifier') return s.sourceLabel ?? '예선 순위 자리';
    if (s.slotType === 'team') return `${s.teamNo}. ${s.player1Name} · ${s.player2Name}`;
    return '비어 있음';
  }, []);

  /**
   * 1라운드 대진 조합 미리보기.
   *   ⚠ 조합을 만들지 않는다 — 이미 저장된 feedsSlotId 를 읽어 같은 곳으로 가는 두 자리를 묶을 뿐이다.
   */
  const firstRoundPairs = React.useMemo(() => {
    const r1 = slots.filter((s) => s.roundNo === 1).sort((a, b) => a.position - b.position);
    const byTarget = new Map<string, BracketSlot[]>();
    for (const s of r1) {
      if (!s.feedsSlotId) continue;
      const list = byTarget.get(s.feedsSlotId) ?? [];
      list.push(s);
      byTarget.set(s.feedsSlotId, list);
    }
    const targets = slots.filter((t) => byTarget.has(t.id))
      .sort((a, b) => (a.roundNo - b.roundNo) || (a.position - b.position));
    return targets.map((t, i) => {
      const pair = (byTarget.get(t.id) ?? []).sort((a, b) => a.position - b.position);
      return { no: i + 1, target: t, a: pair[0], b: pair[1] };
    });
  }, [slots]);

  const firstRoundSlots = React.useMemo(
    () => slots.filter((s) => s.roundNo === 1).sort((a, b) => a.position - b.position),
    [slots],
  );

  // 예선 추천 목록 — ⚠ 추천일 뿐이며 자동 확정하지 않는다.
  const suggestions = React.useMemo((): DraftEntrant[] => {
    if (!standings) return [];
    const out: DraftEntrant[] = [];
    for (const g of standings.groups) {
      for (const r of g.standings) {
        if (r.qualificationStatus === 'QUALIFIED' || r.qualificationStatus === 'PENDING') {
          out.push({
            teamId: r.teamId, source: 'group_rank', sourceGroupNo: g.groupNo,
            sourceRank: r.rank ?? r.autoRank, seedNo: null,
            note: r.qualificationStatus === 'PENDING' ? '동률 미해결 상태에서 확정' : null,
            teamNo: r.teamNo, player1Name: r.player1Name, player2Name: r.player2Name,
            teamStatus: r.teamStatus, pending: r.qualificationStatus === 'PENDING',
          });
        }
      }
    }
    for (const p of standings.placement) {
      for (const t of p.teams) {
        out.push({
          teamId: t.teamId, source: 'placement', sourceGroupNo: p.groupNo, sourceRank: null,
          seedNo: null, note: null, teamNo: t.teamNo,
          player1Name: t.player1Name, player2Name: t.player2Name, teamStatus: 'active',
        });
      }
    }
    return out.sort((a, b) => a.teamNo - b.teamNo);
  }, [standings]);

  const draftList = draft ?? entrants.map((e): DraftEntrant => ({
    teamId: e.teamId, source: e.source, sourceGroupNo: e.sourceGroupNo, sourceRank: e.sourceRank,
    seedNo: e.seedNo, note: e.note, teamNo: e.teamNo, player1Name: e.player1Name,
    player2Name: e.player2Name, teamStatus: e.teamStatus,
  }));
  const draftIds = new Set(draftList.map((d) => d.teamId));
  const draftDirty = draft !== null;
  const pendingInDraft = draftList.filter((d) => d.pending).length;

  // 구조 초안
  const roundList = roundDraft ?? rounds.map((r) => ({ name: r.name, slots: String(r.slotCount) }));
  const structureDirty = roundDraft !== null;

  /** 2:1 연결 초안. ⚠ '추천'이며 저장 전에 경기이사가 확인·수정한다. */
  const buildConnDraft = React.useCallback((list: { name: string; slots: string }[]): string => {
    const counts = list.map((r) => Number(r.slots) || 0);
    const lines: string[] = [];
    for (let i = 0; i < counts.length - 1; i += 1) {
      for (let p = 1; p <= counts[i]; p += 1) lines.push(`${i + 1},${p},${Math.ceil(p / 2)}`);
    }
    return lines.join('\n');
  }, []);

  const parseConn = (text: string): ConnectionInput[] | null => {
    const out: ConnectionInput[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === '') continue;
      const m = line.split(/[,\t|]/).map((c) => c.trim());
      if (m.length < 3 || m.some((c) => !/^\d+$/.test(c))) return null;
      out.push({ roundNo: Number(m[0]), position: Number(m[1]), feedsPosition: Number(m[2]) });
    }
    return out;
  };

  // 붙여넣기 대상 팀(진출팀만 배치 가능)
  const matchable = React.useMemo((): BracketMatchableTeam[] => entrants.map((e) => ({
    teamId: e.teamId, teamNo: e.teamNo, player1Name: e.player1Name, player2Name: e.player2Name,
    isEntrant: true, teamStatus: e.teamStatus,
  })), [entrants]);

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

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link href={`/admin/tournaments/${slug}/registrations`} aria-label="신청 목록"
          style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#475569',
            textDecoration: 'none', flexShrink: 0 }}>
          <ChevronLeft size={16} />
        </Link>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0F172A' }}>본선 대진 만들기</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', wordBreak: 'break-all' }}>
            {slug}{bracket ? ` · ${bracket.status === 'completed' ? '본선 완료'
              : locked ? '경로 확정' : '작성 중'} · v${bracket.version}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => void load()} style={btn()} disabled={!!busy}>
          <RefreshCw size={13} strokeWidth={2.4} />
          {loading ? '조회 중' : '새로고침'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Link href={`/admin/tournaments/${slug}/teams`} style={{ ...btn(), textDecoration: 'none' }}>참가팀</Link>
        <Link href={`/admin/tournaments/${slug}/standings`} style={{ ...btn(), textDecoration: 'none' }}>예선 순위</Link>
        <Link href={`/admin/tournaments/${slug}/matches`} style={{ ...btn(), textDecoration: 'none' }}>경기 운영</Link>
      </div>

      {!ready && (
        <div style={{ ...card, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: 9 }}>
          <AlertTriangle size={17} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
            본선 테이블이 아직 적용되지 않았습니다.{' '}
            <code style={{ fontSize: 11.5 }}>supabase/add_hosted_tournament_bracket.sql</code> 적용 후 다시 조회해 주세요.
          </p>
        </div>
      )}

      {/* 대진표 생성 */}
      {ready && !bracket && (
        <div style={card}>
          <StepHead no={0} title="본선 대진표 만들기"
            desc="먼저 빈 대진표를 만듭니다. 진출팀 수는 참고용 숫자이며 구조를 자동으로 만들지 않습니다." />
          <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input style={{ ...input, flex: '2 1 200px' }} value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)} placeholder="표시 이름 (예: 본선 토너먼트)" />
            <input style={{ ...input, flex: '1 1 140px' }} value={newCount} inputMode="numeric"
              onChange={(e) => setNewCount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="진출팀 수(참고)" />
          </div>
          <button type="button" style={{ ...btn('primary'), marginTop: 10 }} disabled={!!busy}
            onClick={() => void run('create', () =>
              createBracket(slug, newTitle.trim() || null, newCount ? Number(newCount) : null))}>
            <Plus size={13} />{busy === 'create' ? '만드는 중…' : '대진표 만들기'}
          </button>
        </div>
      )}

      {ready && bracket && (
        <>
          {locked && (
            <div style={{ ...card, background: '#ECFDF5', border: '1px solid #A7F3D0', display: 'flex', gap: 9 }}>
              <Lock size={17} color="#047857" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7, wordBreak: 'keep-all' }}>
                본선 경로가 확정되었습니다. 진출팀 · 구조 · 자리 배치는 수정할 수 없습니다.
                수정하려면 아래에서 사유를 적고 확정을 해제하세요.
                <br />본선 경기 생성과 결과 입력은 아래 STEP 5에서 합니다.
              </p>
            </div>
          )}

          {/* ── 예선 순위 변경 경고 (4D-0 drift) ──────────────────────── */}
          {(data?.qualifierDrift?.length ?? 0) > 0 && (
            <div style={{ ...card, background: '#FFFBEB', borderColor: '#FDE68A' }}>
              <p style={{ margin: 0, display: 'flex', gap: 7, fontSize: 13, fontWeight: 900, color: '#92400E' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                예선 순위가 변경되었습니다. 본선 반영 상태를 확인하세요.
              </p>
              {data?.qualifierDrift.slice(0, 8).map((d, i) => (
                <p key={i} style={{ margin: '5px 0 0', fontSize: 12, fontWeight: 700, color: '#92400E',
                  lineHeight: 1.6, wordBreak: 'keep-all' }}>
                  · {d.label ?? `자리 ${d.position ?? '?'}`} — 반영된 팀 {d.resolvedTeamNo ?? '?'}번,
                  현재 순위 기준 {d.currentTeamNo ?? '?'}번
                </p>
              ))}
              <p style={{ ...note, color: '#92400E' }}>
                시스템이 자동으로 바꾸지 않습니다. STEP 3에서 해당 자리를 되돌린 뒤 다시 반영해 주세요.
              </p>
            </div>
          )}

          {/* ── STEP 1 진출팀(보조) ───────────────────────────────────── */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ ...label, color: '#CBD5E1' }}>STEP 1 · 보조</p>
                <p style={{ margin: '7px 0 0', fontSize: 13.5, fontWeight: 800, color: '#64748B', wordBreak: 'keep-all' }}>
                  진출팀을 직접 확정하기
                </p>
                <p style={note}>
                  TEYEON OPEN 기본 운영은 STEP 3의 <strong>예선 순위 자리(N조 M위)</strong>입니다.
                  예선 결과를 반영하면 진출팀 목록은 자동으로 채워집니다. 이 단계는 팀을 직접 배치해야 하는 대회에서만 씁니다.
                </p>
              </div>
              <button type="button" style={{ ...btn(), flexShrink: 0 }}
                onClick={() => setShowStep1((v) => !v)}>
                {showStep1 ? '접기' : '열기'}
              </button>
            </div>
            {showStep1 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
            <StepHead no={1} title="본선 진출팀 확정"
              desc="예선 결과는 추천입니다. 담기 버튼은 아래 목록만 채우며 저장하지 않습니다. 최종 확정은 경기이사가 합니다." />

            {(data?.entrantDrift?.length ?? 0) > 0 && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#92400E' }}>
                  확정 이후 예선 결과가 달라졌습니다 ({data?.entrantDrift.length}건)
                </p>
                {data?.entrantDrift.slice(0, 8).map((d, i) => (
                  <p key={i} style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 600, color: '#92400E', lineHeight: 1.6 }}>
                    {d.teamNo !== null ? `${d.teamNo}번 팀 · ` : ''}{BRACKET_DRIFT_TEXT[d.code] ?? d.code}
                  </p>
                ))}
                <p style={{ ...note, color: '#92400E' }}>자동으로 반영하지 않습니다. 필요하면 아래에서 직접 고쳐 저장하세요.</p>
              </div>
            )}

            {!locked && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
                <button type="button" style={btn()} disabled={!!busy || suggestions.length === 0}
                  onClick={() => setDraft(suggestions)}>
                  예선 결과 담기 ({suggestions.length})
                </button>
                <button type="button" style={btn()} disabled={!!busy || !draftDirty}
                  onClick={() => setDraft(null)}>
                  되돌리기
                </button>
                <button type="button" style={btn('primary')} disabled={!!busy || !draftDirty || draftList.length === 0}
                  onClick={() => void run('entrants', () => setBracketEntrants(slug,
                    draftList.map((d): EntrantInput => ({
                      teamId: d.teamId, source: d.source, sourceGroupNo: d.sourceGroupNo,
                      sourceRank: d.sourceRank, seedNo: d.seedNo, note: d.note,
                    })), bracket.version), () => setDraft(null))}>
                  <Check size={13} />{busy === 'entrants' ? '저장 중…' : `진출팀 ${draftList.length}팀 확정 저장`}
                </button>
              </div>
            )}

            {pendingInDraft > 0 && !locked && (
              <p style={{ ...note, color: '#B45309', fontWeight: 800 }}>
                ⚠ 동률이 확정되지 않은 팀 {pendingInDraft}팀이 포함돼 있습니다. 저장은 가능하지만 예선 순위를 먼저 확인하세요.
              </p>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {/* 추천 */}
              {!locked && (
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <p style={{ ...label, color: '#64748B' }}>예선 결과 추천 ({suggestions.length})</p>
                  <div style={{ marginTop: 6, maxHeight: 280, overflowY: 'auto', border: '1px solid #F1F5F9', borderRadius: 10 }}>
                    {suggestions.length === 0 && (
                      <p style={{ margin: 0, padding: 12, fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                        예선 결과가 없습니다.
                      </p>
                    )}
                    {suggestions.map((s) => (
                      <div key={s.teamId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: '1px solid #F8FAFC' }}>
                        <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 700, color: '#0F172A', wordBreak: 'keep-all' }}>
                          {bracketTeamLabel(s)}
                          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: s.pending ? '#B45309' : '#94A3B8' }}>
                            {s.source === 'placement' ? '순위결정전' : `${s.sourceGroupNo}조 ${s.sourceRank ?? '-'}위`}
                            {s.pending ? ' · 동률 미확정' : ''}
                          </span>
                        </span>
                        <button type="button" style={btn()} disabled={draftIds.has(s.teamId)}
                          onClick={() => setDraft([...draftList, s])}>
                          {draftIds.has(s.teamId) ? '담김' : '담기'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 확정 목록 */}
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <p style={{ ...label, color: '#64748B' }}>
                  확정 진출팀 ({draftList.length}){draftDirty ? ' · 저장 전' : ''}
                </p>
                <div style={{ marginTop: 6, maxHeight: 280, overflowY: 'auto', border: '1px solid #F1F5F9', borderRadius: 10 }}>
                  {draftList.length === 0 && (
                    <p style={{ margin: 0, padding: 12, fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                      아직 확정된 팀이 없습니다.
                    </p>
                  )}
                  {draftList.map((d) => (
                    <div key={d.teamId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: '1px solid #F8FAFC' }}>
                      <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 700, color: '#0F172A', wordBreak: 'keep-all' }}>
                        {bracketTeamLabel(d)}
                        <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>
                          {d.source === 'placement' ? '순위결정전'
                            : d.source === 'group_rank' ? `${d.sourceGroupNo ?? '-'}조 ${d.sourceRank ?? '-'}위`
                            : '직접 추가'}
                          {d.teamStatus === 'withdrawn' ? ' · 기권' : ''}
                        </span>
                      </span>
                      {!locked && (
                        <button type="button" style={btn('danger')} disabled={!!busy}
                          onClick={() => setDraft(draftList.filter((x) => x.teamId !== d.teamId))}>
                          <Trash2 size={12} />빼기
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            </div>
            )}
          </div>

          {/* ── STEP 2 구조 ───────────────────────────────────────────── */}
          <div style={card}>
            <StepHead no={2} title="본선 구조 만들기"
              desc="라운드 이름과 자리 수를 직접 정합니다. 마지막 라운드는 우승 자리 1개입니다(경기 라운드가 아닙니다)." />
            <p style={{ ...note, color: '#B45309' }}>
              아래 연결은 위에서 아래로 2:1로 이어 붙인 <strong>초안</strong>입니다. 확인하고 필요하면 직접 고친 뒤 저장하세요.
            </p>

            {!locked && (
              <>
                <div style={{ marginTop: 11 }}>
                  {roundList.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ flexShrink: 0, minWidth: 26, fontSize: 12, fontWeight: 800, color: '#94A3B8' }}>R{i + 1}</span>
                      <input style={{ ...input, flex: '2 1 120px' }} value={r.name} placeholder="라운드 이름"
                        onChange={(e) => {
                          const next = [...roundList];
                          next[i] = { ...next[i], name: e.target.value };
                          setRoundDraft(next);
                        }} />
                      <input style={{ ...input, flex: '1 1 80px' }} value={r.slots} inputMode="numeric" placeholder="자리 수"
                        onChange={(e) => {
                          const next = [...roundList];
                          next[i] = { ...next[i], slots: e.target.value.replace(/[^0-9]/g, '') };
                          setRoundDraft(next);
                        }} />
                      <button type="button" style={btn('danger')} aria-label={`R${i + 1} 삭제`}
                        onClick={() => setRoundDraft(roundList.filter((_, j) => j !== i))}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button type="button" style={btn()} onClick={() => setRoundDraft([...roundList, { name: '', slots: '' }])}>
                    <Plus size={12} />라운드 추가
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
                  <button type="button" style={btn()} disabled={roundList.length < 2}
                    onClick={() => { setConnText(buildConnDraft(roundList)); setShowConn(true); }}>
                    연결 초안 만들기
                  </button>
                  <button type="button" style={btn()} onClick={() => setShowConn((v) => !v)}>
                    {showConn ? '연결 숨기기' : '연결 확인/수정'}
                  </button>
                  <button type="button" style={btn()} disabled={!structureDirty}
                    onClick={() => { setRoundDraft(null); setConnText(''); }}>
                    되돌리기
                  </button>
                  <button type="button" style={btn('primary')}
                    disabled={!!busy || roundList.length < 2 || connText.trim() === ''}
                    onClick={() => {
                      const conns = parseConn(connText);
                      if (!conns) { say('연결 형식을 확인해 주세요. 한 줄에 "라운드,자리,다음자리" 형식입니다.'); return; }
                      const rs: RoundInput[] = roundList.map((r, i) => ({
                        roundNo: i + 1, name: r.name.trim(), slots: Number(r.slots) || 0,
                        isFinalSlot: i === roundList.length - 1,
                      }));
                      void run('structure', () => setBracketStructure(slug, { rounds: rs, connections: conns }, bracket.version),
                        () => { setRoundDraft(null); setConnText(''); setShowConn(false); });
                    }}>
                    <Check size={13} />{busy === 'structure' ? '저장 중…' : '구조 저장'}
                  </button>
                </div>

                {showConn && (
                  <>
                    <p style={{ ...note, marginTop: 10 }}>
                      한 줄에 <code>라운드,자리,다음자리</code>. 마지막(우승) 라운드는 적지 않습니다.
                    </p>
                    <textarea value={connText} onChange={(e) => setConnText(e.target.value)} rows={6}
                      placeholder={'1,1,1\n1,2,1\n1,3,2'}
                      style={{ ...input, marginTop: 6, minHeight: 120, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
                  </>
                )}
              </>
            )}

            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {rounds.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>저장된 구조가 없습니다.</p>
              ) : rounds.map((r) => (
                <span key={r.id} style={{ fontSize: 11.5, fontWeight: 800, padding: '5px 9px', borderRadius: 999,
                  background: r.isFinalSlot ? '#ECFDF5' : '#F1F5F9', color: r.isFinalSlot ? '#047857' : '#475569',
                  whiteSpace: 'nowrap' }}>
                  {r.name} · {r.slotCount}자리{r.isFinalSlot ? ' (우승)' : ''}
                </span>
              ))}
            </div>
          </div>

          {/* ── STEP 3 1라운드 배치 ───────────────────────────────────── */}
          <div style={card}>
            <StepHead no={3} title="1라운드 자리 배치 — 본선 진출 경로"
              desc="본선 진출 경로를 먼저 정합니다. 예선 조 편성 전에 각 자리에 ‘N조 M위’를 배치하세요. 이 경로를 기준으로 경기이사가 예선 조를 편성합니다." />

            {firstRoundSlots.length === 0 ? (
              <p style={{ ...note }}>먼저 구조를 저장해 주세요.</p>
            ) : (
              <>
                {!locked && (
                  <>
                    <p style={{ ...note, marginTop: 10 }}>
                      붙여넣기 형식: <code>자리번호 | 1조 1위</code> · <code>자리번호 | BYE</code> ·
                      <code>자리번호 | 팀번호</code> · <code>자리번호 | 선수이름</code>. 빈 자리는 번호만 적습니다.
                      1라운드 {firstRoundSlots.length}자리를 모두 포함해야 합니다.
                    </p>
                    <textarea value={paste} onChange={(e) => { setPaste(e.target.value); setPreview(null); }} rows={5}
                      placeholder={'1 | 1조 1위\n2 | 16조 2위\n3 | BYE\n4 |'}
                      style={{ ...input, marginTop: 6, minHeight: 110, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      <button type="button" style={btn()} disabled={paste.trim() === ''}
                        onClick={() => setPreview(parseBracketPaste(paste, matchable, firstRoundSlots.map((s) => s.position)))}>
                        <ClipboardPaste size={13} />미리보기
                      </button>
                      <button type="button" style={btn('primary')}
                        disabled={!!busy || !preview?.canApply || !preview?.payload}
                        onClick={() => void run('paste', () =>
                          replaceBracketSlots(slug, preview!.payload!, bracket.version),
                          () => { setPaste(''); setPreview(null); })}>
                        <Check size={13} />{busy === 'paste' ? '저장 중…' : '전체 저장'}
                      </button>
                    </div>

                    {preview && (
                      <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10,
                        background: preview.canApply ? '#ECFDF5' : '#FEF2F2',
                        border: `1px solid ${preview.canApply ? '#A7F3D0' : '#FECACA'}` }}>
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A' }}>
                          예선 순위 자리 {preview.counts.qualifier} · 팀 {preview.counts.team}
                          · 부전승 {preview.counts.bye} · 빈자리 {preview.counts.tbd}
                          {preview.canApply ? ' — 저장할 수 있습니다.' : ' — 아래 문제를 먼저 해결해 주세요.'}
                        </p>
                        {preview.blockers.map((b, i) => (
                          <p key={i} style={{ margin: '5px 0 0', fontSize: 12, fontWeight: 700, color: '#B91C1C', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                            {BRACKET_PASTE_BLOCKER_TEXT[b.code]} — {b.detail.slice(0, 6).join(', ')}
                            {b.detail.length > 6 ? ` 외 ${b.detail.length - 6}건` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* 자리별 목록 — 예선 순위 자리 / 부전승 / 실제 팀 */}
                <div style={{ marginTop: 12, border: '1px solid #F1F5F9', borderRadius: 10 }}>
                  {firstRoundSlots.map((s) => {
                    const d = qDraft[s.id] ?? {
                      g: s.sourceGroupNo != null ? String(s.sourceGroupNo) : '',
                      r: s.sourceRank != null ? String(s.sourceRank) : '',
                    };
                    const setD = (v: { g: string; r: string }) =>
                      setQDraft((prev) => ({ ...prev, [s.id]: v }));
                    const resolved = s.resolvedAt != null;
                    const tone = s.slotType === 'team' ? '#0F172A'
                      : s.slotType === 'qualifier' ? '#1D4ED8'
                      : s.slotType === 'bye' ? '#B45309' : '#94A3B8';
                    return (
                      <div key={s.id} style={{ padding: '9px 10px', borderTop: '1px solid #F8FAFC' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                          <span style={{ flexShrink: 0, minWidth: 34, fontSize: 12, fontWeight: 900, color: '#94A3B8' }}>
                            #{s.position}
                          </span>
                          <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 800, lineHeight: 1.5,
                            color: tone, wordBreak: 'keep-all' }}>
                            {s.sourceKind === 'group_rank' && s.sourceLabel ? s.sourceLabel : slotText(s)}
                          </span>
                          {resolved && (
                            <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, padding: '3px 7px',
                              borderRadius: 999, background: '#ECFDF5', color: '#047857' }}>반영 완료</span>
                          )}
                        </div>

                        {/* 반영된 자리는 출처를 지우지 않고 팀을 덧붙여 보여 준다 */}
                        {resolved && s.slotType === 'team' && (
                          <p style={{ margin: '3px 0 0 42px', fontSize: 12.5, fontWeight: 700,
                            color: '#0F172A', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                            {s.teamNo}. {s.player1Name} · {s.player2Name}
                          </p>
                        )}

                        {!locked && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7, marginLeft: 42 }}>
                            <input style={{ ...input, width: 58 }} inputMode="numeric" maxLength={2}
                              placeholder="조" value={d.g} disabled={!!busy}
                              onChange={(e) => setD({ ...d, g: e.target.value.replace(/[^0-9]/g, '') })} />
                            <input style={{ ...input, width: 58 }} inputMode="numeric" maxLength={2}
                              placeholder="순위" value={d.r} disabled={!!busy}
                              onChange={(e) => setD({ ...d, r: e.target.value.replace(/[^0-9]/g, '') })} />
                            <button type="button" style={btn('primary')}
                              disabled={!!busy || d.g === '' || d.r === ''}
                              onClick={() => void run(`slot-${s.id}`, () =>
                                assignBracketSlot(slug, s.id, 'qualifier', null, bracket.version,
                                  { groupNo: Number(d.g), rank: Number(d.r) }))}>
                              예선 순위 자리
                            </button>
                            <button type="button" style={btn()} disabled={!!busy}
                              onClick={() => void run(`slot-${s.id}`, () =>
                                assignBracketSlot(slug, s.id, 'bye', null, bracket.version))}>
                              부전승
                            </button>
                            <select style={{ ...input, width: 'auto', minWidth: 116, maxWidth: 190 }}
                              value="" disabled={!!busy || entrants.length === 0}
                              onChange={(e) => {
                                const teamId = e.target.value;
                                if (!teamId) return;
                                void run(`slot-${s.id}`, () =>
                                  assignBracketSlot(slug, s.id, 'team', teamId, bracket.version));
                              }}>
                              <option value="">팀 직접 배치…</option>
                              {entrants.map((e) => (
                                <option key={e.teamId} value={e.teamId}>{bracketTeamLabel(e)}</option>
                              ))}
                            </select>
                            <button type="button" style={btn()} disabled={!!busy}
                              onClick={() => void run(`slot-${s.id}`, () =>
                                assignBracketSlot(slug, s.id, 'tbd', null, bracket.version))}>
                              비우기
                            </button>
                          </div>
                        )}

                        {/* 확정 뒤: 반영된 자리만 되돌릴 수 있다(사유 필수) */}
                        {locked && resolved && (
                          undoPos === s.position ? (
                            <div style={{ marginTop: 7, marginLeft: 42 }}>
                              <input style={input} value={undoReason} maxLength={200}
                                onChange={(e) => setUndoReason(e.target.value)}
                                placeholder="되돌리는 사유 (필수 · 이력에 남습니다)" />
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                <button type="button" style={btn('danger')}
                                  disabled={!!busy || undoReason.trim().length < 2}
                                  onClick={() => void run(`undo-${s.position}`, () =>
                                    unresolveBracketQualifier(slug, s.position, undoReason.trim(), bracket.version),
                                    () => { setUndoPos(null); setUndoReason(''); })}>
                                  {busy === `undo-${s.position}` ? '처리 중…' : '반영 되돌리기'}
                                </button>
                                <button type="button" style={btn()} disabled={!!busy}
                                  onClick={() => { setUndoPos(null); setUndoReason(''); }}>취소</button>
                              </div>
                              <p style={note}>아직 시작하지 않은 다음 경기가 있으면 함께 정리됩니다.</p>
                            </div>
                          ) : (
                            <button type="button" style={{ ...btn(), marginTop: 7, marginLeft: 42 }} disabled={!!busy}
                              onClick={() => { setUndoPos(s.position); setUndoReason(''); }}>
                              <Undo2 size={13} />반영 되돌리기
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── 대진 조합 미리보기 ─────────────────────────────────── */}
                {firstRoundPairs.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>
                      1라운드 대진 조합
                    </p>
                    <p style={note}>
                      지금 저장된 자리로 누가 누구와 만나는지 확인하세요. 시스템이 조합을 만들지 않습니다 — 위 배치를 그대로 읽어 보여 줍니다.
                    </p>
                    <div style={{ marginTop: 8, display: 'grid', gap: 8,
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 232px), 1fr))' }}>
                      {firstRoundPairs.map((m) => {
                        const bye = m.a?.slotType === 'bye' || m.b?.slotType === 'bye';
                        return (
                          <div key={m.target.id} style={{ padding: '9px 11px', borderRadius: 10,
                            border: `1px solid ${bye ? '#FDE68A' : '#E2E8F0'}`,
                            background: bye ? '#FFFBEB' : '#F8FAFC' }}>
                            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em',
                              color: '#94A3B8' }}>
                              MATCH {String(m.no).padStart(2, '0')}{bye ? ' · 부전승' : ''}
                            </p>
                            <p style={{ margin: '5px 0 0', fontSize: 13, fontWeight: 800, color: '#0F172A',
                              lineHeight: 1.45, wordBreak: 'keep-all' }}>
                              {slotText(m.a)}
                            </p>
                            <p style={{ margin: '2px 0', fontSize: 10.5, fontWeight: 800, color: '#94A3B8' }}>VS</p>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A',
                              lineHeight: 1.45, wordBreak: 'keep-all' }}>
                              {slotText(m.b)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── 예선 결과 반영 (확정 이후) ─────────────────────────── */}
                {locked && (validation?.summary.qualifiers ?? 0) + (validation?.summary.resolved ?? 0) > 0 && (
                  <div style={{ marginTop: 12, padding: '11px 12px', borderRadius: 11,
                    background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A' }}>예선 결과 반영</p>
                    <p style={note}>
                      공식 확정된 조별 순위를 본선 진출 자리에 반영합니다. 아직 확정되지 않은 조는 그대로 두고 나중에 다시 실행하면 됩니다.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 9, alignItems: 'center' }}>
                      <button type="button" style={btn('primary')}
                        disabled={!!busy || bracket.status === 'completed'}
                        onClick={() => void run('resolve', async () => {
                          const r = await resolveBracketQualifiers(slug, bracket.version);
                          setResolveResult(r);
                          if (r.resolved.length === 0) return '반영할 수 있는 자리가 아직 없습니다.';
                          return `${r.resolved.length}자리를 반영했습니다.`
                            + (r.skipped.length > 0 ? ` ${r.skipped.length}자리는 보류했습니다.` : '');
                        })}>
                        <Users size={13} />{busy === 'resolve' ? '반영 중…' : '예선 결과 반영'}
                      </button>
                      <span style={{ fontSize: 11.5, fontWeight: 800, padding: '6px 10px', borderRadius: 999,
                        background: '#F1F5F9', color: '#475569', whiteSpace: 'nowrap' }}>
                        대기 {validation?.summary.qualifiers ?? 0} · 반영 {validation?.summary.resolved ?? 0}
                      </span>
                    </div>

                    {resolveResult && (
                      <div style={{ marginTop: 10 }}>
                        {resolveResult.resolved.length > 0 && (
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#047857', lineHeight: 1.6 }}>
                            반영 {resolveResult.resolved.length}자리 —{' '}
                            {resolveResult.resolved.map((r) => `${r.label} → ${r.teamNo}번`).join(', ')}
                          </p>
                        )}
                        {resolveResult.skipped.map((k) => (
                          <p key={k.position} style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700,
                            color: '#92400E', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                            · 자리 {k.position} {k.label} — {qualifierSkipText(k.reason)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {rounds.length > 1 && (
                  <p style={{ ...note, marginTop: 10, display: 'flex', gap: 6 }}>
                    <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    2라운드 이후 자리는 승자가 올라오는 자리라 여기서 편집하지 않습니다.
                  </p>
                )}
              </>
            )}
          </div>

          {/* ── STEP 4 검증 / 확정 ────────────────────────────────────── */}
          <div style={card}>
            <StepHead no={4} title="검증하고 본선 경로 확정하기"
              desc="오류가 0건일 때만 확정할 수 있습니다. 확정하면 자리 배치가 잠기고, 이 경로를 기준으로 예선 조를 편성합니다." />

            {validation && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
                {[
                  ['진출팀', validation.summary.entrants],
                  ['1라운드 자리', validation.summary.firstRoundSlots],
                  ['부전승', validation.summary.byes],
                  ['빈자리', validation.summary.unassigned],
                  ['예선 순위 자리', validation.summary.qualifiers],
                  ['반영 완료', validation.summary.resolved],
                  ['만들 경기', validation.summary.matchesToCreate],
                  ['부전승 진출', validation.summary.byeAdvances],
                ].map(([k, v]) => (
                  <span key={k as string} style={{ fontSize: 11.5, fontWeight: 800, padding: '6px 10px',
                    borderRadius: 999, background: '#F1F5F9', color: '#475569', whiteSpace: 'nowrap' }}>
                    {k as string} {v as number}
                  </span>
                ))}
              </div>
            )}
            <p style={{ ...note }}>
              ‘만들 경기’는 양쪽 자리에 실제 팀이 정해진 대진만 셉니다. 예선 순위 자리는 예선 결과를 반영한 뒤 경기로 만들어집니다.
            </p>

            {errors.length > 0 && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#B91C1C' }}>오류 {errors.length}건 — 확정할 수 없습니다</p>
                {errors.slice(0, 10).map((e, i) => (
                  <p key={i} style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700, color: '#B91C1C', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                    · {BRACKET_ISSUE_TEXT[e.code] ?? e.code}
                    {typeof e.detail.position === 'number' ? ` (자리 ${e.detail.position})` : ''}
                    {typeof e.detail.teamNo === 'number' ? ` (${e.detail.teamNo}번 팀)` : ''}
                  </p>
                ))}
                {errors.length > 10 && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700, color: '#B91C1C' }}>외 {errors.length - 10}건</p>
                )}
              </div>
            )}

            {warnings.length > 0 && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#92400E' }}>경고 {warnings.length}건 — 확정은 가능합니다</p>
                {warnings.slice(0, 8).map((w, i) => (
                  <p key={i} style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700, color: '#92400E', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                    · {BRACKET_ISSUE_TEXT[w.code] ?? w.code}
                    {typeof w.detail.teamNo === 'number' ? ` (${w.detail.teamNo}번 팀)` : ''}
                  </p>
                ))}
              </div>
            )}

            {!locked ? (
              <button type="button" style={{ ...btn('primary'), marginTop: 11 }}
                disabled={!!busy || !validation || errors.length > 0}
                onClick={() => void run('lock', () => lockBracket(slug, bracket.version))}>
                <Lock size={13} />{busy === 'lock' ? '확정 중…' : '본선 경로 확정'}
              </button>
            ) : bracket.status === 'completed' ? (
              <p style={{ ...note, marginTop: 11 }}>
                본선이 완료됐습니다. 대진 구조는 더 이상 바꿀 수 없습니다.
              </p>
            ) : (
              <div style={{ marginTop: 11 }}>
                <input style={input} value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder="확정 해제 사유 (필수 · 이력에 남습니다)" maxLength={200} />
                <button type="button" style={{ ...btn('danger'), marginTop: 8 }}
                  disabled={!!busy || unlockReason.trim() === ''}
                  onClick={() => void run('unlock', () => unlockBracket(slug, unlockReason.trim(), bracket.version),
                    () => setUnlockReason(''))}>
                  <Unlock size={13} />{busy === 'unlock' ? '해제 중…' : '확정 해제'}
                </button>
                <p style={{ ...note }}>본선 경기가 이미 있으면 서버가 해제를 거부합니다.</p>
              </div>
            )}
          </div>

          {/* ── STEP 5 본선 경기 운영 (4C) ─────────────────────────────── */}
          {locked && (
            <div style={card}>
              <StepHead no={5} title="본선 경기 운영"
                desc="확정된 대진을 경기로 만들고 결과를 입력합니다. 부전승은 경기가 아니라 카드가 없습니다." />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 11, alignItems: 'center' }}>
                <button type="button" style={btn('primary')}
                  disabled={!!busy || bracket.status === 'completed'}
                  onClick={() => void run('materialize', () => materializeBracketMatches(slug, bracket.version))}>
                  <Plus size={13} />{busy === 'materialize' ? '만드는 중…' : '경기 만들기'}
                </button>
                <span style={{ fontSize: 11.5, fontWeight: 800, padding: '6px 10px', borderRadius: 999,
                  background: '#F1F5F9', color: '#475569', whiteSpace: 'nowrap' }}>
                  현재 경기 {matches.length}
                </span>
                {bracket.status === 'completed' && (
                  <span style={{ fontSize: 11.5, fontWeight: 800, padding: '6px 10px', borderRadius: 999,
                    background: '#ECFDF5', color: '#047857', whiteSpace: 'nowrap' }}>
                    본선 완료
                  </span>
                )}
              </div>
              <p style={note}>
                여러 번 눌러도 같은 경기가 두 번 만들어지지 않습니다. 앞 라운드가 끝나면 다음 경기는 자동으로 생깁니다.
              </p>

              {matches.length === 0 ? (
                <p style={{ ...note, marginTop: 10 }}>아직 만들어진 경기가 없습니다.</p>
              ) : matchesByRound.map((g) => (
                <div key={g.key} style={{ marginTop: 13 }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>{g.title}</p>
                  {g.rows.map((m) => {
                    const sd = scoreDraft[m.id] ?? { s1: '', s2: '' };
                    const setSd = (v: { s1: string; s2: string }) =>
                      setScoreDraft((prev) => ({ ...prev, [m.id]: v }));
                    const pick = courtPick[m.id] ?? '';
                    const tone = m.status === 'completed' ? '#047857'
                      : m.status === 'playing' ? '#B45309'
                      : m.status === 'calling' ? '#1D4ED8' : '#64748B';
                    const winner1 = m.winnerTeamNo != null && m.winnerTeamNo === m.team1.teamNo;
                    const winner2 = m.winnerTeamNo != null && m.winnerTeamNo === m.team2.teamNo;
                    return (
                      <div key={m.id} style={{ marginTop: 8, padding: '10px 12px', borderRadius: 11,
                        border: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 900, color: '#0F172A' }}>{m.matchNo}번 경기</span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: tone }}>
                            {KNOCKOUT_STATUS_TEXT[m.status]}
                          </span>
                          {m.courtNo != null && (
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>
                              {m.courtName ?? `${m.courtNo}번 코트`}
                            </span>
                          )}
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>
                            승자 → {m.targetRoundNo}라운드 {m.targetPosition}번 자리
                          </span>
                        </div>

                        {([[m.team1, m.score1, winner1] as const, [m.team2, m.score2, winner2] as const])
                          .map(([tm, sc, win], i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline',
                              margin: i === 0 ? '7px 0 0' : '2px 0 0' }}>
                              <span style={{ flex: 1, fontSize: 13, fontWeight: win ? 900 : 700,
                                color: win ? '#047857' : '#0F172A', wordBreak: 'keep-all' }}>
                                {knockoutTeamLabel(tm)}
                              </span>
                              {sc != null && (
                                <span style={{ fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                                  color: win ? '#047857' : '#64748B' }}>{sc}</span>
                              )}
                            </div>
                          ))}

                        {(m.status === 'waiting' || m.status === 'calling') && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 9 }}>
                            {m.status === 'waiting' ? (
                              <button type="button" style={btn()} disabled={!!busy}
                                onClick={() => void run(`call-${m.id}`, async () => {
                                  await callMatch(m.id, m.version); return '호명했습니다.';
                                })}>
                                {busy === `call-${m.id}` ? '처리 중…' : '호명'}
                              </button>
                            ) : (
                              <button type="button" style={btn()} disabled={!!busy}
                                onClick={() => void run(`uncall-${m.id}`, async () => {
                                  await uncallMatch(m.id, m.version); return '호명을 취소했습니다.';
                                })}>
                                {busy === `uncall-${m.id}` ? '처리 중…' : '호명 취소'}
                              </button>
                            )}
                            <select style={{ ...input, width: 'auto', minWidth: 116 }} value={pick}
                              onChange={(e) => setCourtPick((prev) => ({ ...prev, [m.id]: e.target.value }))}>
                              <option value="">코트 선택</option>
                              {activeCourts.map((c) => (
                                <option key={c.id} value={String(c.courtNo)}>
                                  {c.displayName ?? `${c.courtNo}번 코트`}
                                </option>
                              ))}
                            </select>
                            <button type="button" style={btn('primary')} disabled={!!busy || pick === ''}
                              onClick={() => void run(`start-${m.id}`, async () => {
                                await startMatch(m.id, Number(pick), m.version); return '경기를 시작했습니다.';
                              })}>
                              {busy === `start-${m.id}` ? '시작 중…' : '시작'}
                            </button>
                          </div>
                        )}

                        {m.status === 'playing' && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 9, alignItems: 'center' }}>
                            <input style={{ ...input, width: 62 }} inputMode="numeric" maxLength={1}
                              placeholder="6" value={sd.s1}
                              onChange={(e) => setSd({ ...sd, s1: e.target.value.replace(/[^0-9]/g, '') })} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: '#94A3B8' }}>:</span>
                            <input style={{ ...input, width: 62 }} inputMode="numeric" maxLength={1}
                              placeholder="0" value={sd.s2}
                              onChange={(e) => setSd({ ...sd, s2: e.target.value.replace(/[^0-9]/g, '') })} />
                            <button type="button" style={btn('primary')}
                              disabled={!!busy || sd.s1 === '' || sd.s2 === ''}
                              onClick={() => void run(`done-${m.id}`,
                                () => completeKnockoutMatch(m.id, Number(sd.s1), Number(sd.s2), m.version),
                                () => setScoreDraft((prev) => ({ ...prev, [m.id]: { s1: '', s2: '' } })))}>
                              <Check size={13} />{busy === `done-${m.id}` ? '저장 중…' : '완료'}
                            </button>
                          </div>
                        )}

                        {m.status === 'completed' && (
                          amendOpen === m.id ? (
                            <div style={{ marginTop: 9 }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                                <input style={{ ...input, width: 62 }} inputMode="numeric" maxLength={1}
                                  value={sd.s1}
                                  onChange={(e) => setSd({ ...sd, s1: e.target.value.replace(/[^0-9]/g, '') })} />
                                <span style={{ fontSize: 12, fontWeight: 800, color: '#94A3B8' }}>:</span>
                                <input style={{ ...input, width: 62 }} inputMode="numeric" maxLength={1}
                                  value={sd.s2}
                                  onChange={(e) => setSd({ ...sd, s2: e.target.value.replace(/[^0-9]/g, '') })} />
                              </div>
                              <input style={{ ...input, marginTop: 7 }} value={amendReason} maxLength={200}
                                onChange={(e) => setAmendReason(e.target.value)}
                                placeholder="수정 사유 (필수 · 이력에 남습니다)" />
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 7 }}>
                                <button type="button" style={btn('primary')}
                                  disabled={!!busy || sd.s1 === '' || sd.s2 === '' || amendReason.trim().length < 2}
                                  onClick={() => void run(`amend-${m.id}`,
                                    () => amendKnockoutMatchScore(m.id, Number(sd.s1), Number(sd.s2),
                                      amendReason.trim(), m.version),
                                    () => { setAmendOpen(''); setAmendReason(''); })}>
                                  {busy === `amend-${m.id}` ? '저장 중…' : '수정 저장'}
                                </button>
                                <button type="button" style={btn()} disabled={!!busy}
                                  onClick={() => { setAmendOpen(''); setAmendReason(''); }}>취소</button>
                              </div>
                              <p style={note}>
                                승자가 바뀌는 수정은 다음 경기가 아직 시작되지 않았을 때만 됩니다.
                              </p>
                            </div>
                          ) : (
                            <button type="button" style={{ ...btn(), marginTop: 9 }} disabled={!!busy}
                              onClick={() => {
                                setAmendOpen(m.id); setAmendReason('');
                                setScoreDraft((prev) => ({ ...prev,
                                  [m.id]: { s1: String(m.score1 ?? ''), s2: String(m.score2 ?? '') } }));
                              }}>
                              결과 수정
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
          maxWidth: 'calc(100vw - 32px)', padding: '11px 16px', borderRadius: 10, background: '#0F172A',
          color: '#fff', fontSize: 12.5, fontWeight: 700, lineHeight: 1.6, zIndex: 60,
          wordBreak: 'keep-all', textAlign: 'center' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
