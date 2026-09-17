'use client';

// 예선 조편성 보드 (Batch 2B) — 경기이사 수동 배치 전용.
//
//   ⚠⚠ 이 컴포넌트에는 조를 자동으로 짜는 코드가 없다. 앞으로도 넣지 않는다.
//     조 개수는 경기이사가 입력하고, 팀은 경기이사가 하나씩 배치한다.
//     화면의 '참고' 계산값은 표시만 하며 어떤 동작도 유발하지 않는다.
//
//   ⚠ 개인정보: hosted_tournament_teams 스냅샷만 표시한다.
//     전화번호·입금자명·동의·관리자 메모는 서버 RPC 가 애초에 내려주지 않는다.
//
//   ⚠ Realtime 은 Batch 2 범위가 아니다. 모든 write 성공 후 full refetch 한다.
//
//   조작 모델(D&D 없이 버튼만으로 전부 가능)
//     팀을 하나 '선택' → 빈 자리를 누르면 배정/이동, 다른 팀을 누르면 교환.
//     선택 없이도 각 팀의 [빼기] 로 배정 취소가 가능하다.

import React from 'react';
import {
  RefreshCw, Search, Check, AlertTriangle, Lock, Unlock, Plus, X as XIcon,
  ShieldCheck, Info, Trash2,
} from 'lucide-react';
import {
  fetchPreliminaryDraw, createGroups, deleteGroup, assignTeam, unassignTeam,
  moveTeam, swapTeams, validateDraw, lockDraw, unlockDraw, drawActionMessage,
} from '@/lib/tournaments/drawAdminService';
import GroupPasteImport from './GroupPasteImport';
import type { MatchableTeam } from '@/lib/tournaments/groupPasteParser';
import {
  groupDisplayName, groupPlanHint, DRAW_ISSUE_LABEL,
  type DrawIssue, type DrawValidation, type GroupMember,
  type PreliminaryDraw, type TournamentGroup, type UnassignedTeam,
} from '@/lib/tournaments/drawTypes';

// ── 스타일 (기존 Admin 화면 톤 재사용. 새 디자인 시스템을 만들지 않는다) ──────
const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 15, marginBottom: 10,
};
const label: React.CSSProperties = {
  margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8',
};
const btn = (tone: 'primary' | 'plain' | 'danger' | 'ghost' = 'plain'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 32, padding: '6px 11px', borderRadius: 8,
  border: `1px solid ${tone === 'primary' ? '#0E8C80' : tone === 'danger' ? '#FCA5A5' : '#E2E8F0'}`,
  background: tone === 'primary' ? '#0E8C80' : tone === 'ghost' ? 'transparent' : '#fff',
  color: tone === 'primary' ? '#fff' : tone === 'danger' ? '#B91C1C' : '#475569',
  fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
});
const input: React.CSSProperties = {
  minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: 34, padding: '7px 10px',
  borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
  fontFamily: 'inherit', fontSize: 13, color: '#0F172A',
};

/** 선택된 팀. from 이 null 이면 미배정 팀이다. */
interface Selection {
  teamId: string;
  teamNo: number;
  name: string;
  from: { groupNo: number; slotNo: number } | null;
}

const memberName = (m: { player1Name: string; player2Name: string }) =>
  `${m.player1Name} · ${m.player2Name}`;

/** 검증 결과 한 줄을 운영자 문구로. 서버가 준 목록을 그대로 풀어 쓴다(자동 교정 없음). */
function issueLines(issue: DrawIssue): string[] {
  const head = DRAW_ISSUE_LABEL[issue.code] || issue.code;
  const out: string[] = [head];

  if (issue.code === 'unassigned_teams' && Array.isArray(issue.teams)) {
    (issue.teams as Record<string, unknown>[]).forEach((t) => {
      out.push(`· ${t.teamNo}번 팀`);
    });
  }
  if (issue.code === 'group_size_mismatch' && Array.isArray(issue.groups)) {
    (issue.groups as Record<string, unknown>[]).forEach((g) => {
      const kind = g.groupType === 'placement' ? '순위결정전' : `${g.groupNo}조`;
      out.push(`· ${kind} — 현재 ${g.actual} / ${g.expected}`);
    });
  }
  if (issue.code === 'withdrawn_assigned' && Array.isArray(issue.teams)) {
    (issue.teams as Record<string, unknown>[]).forEach((t) => {
      out.push(`· ${t.groupNo}조의 ${t.teamNo}번 팀이 기권 상태입니다`);
    });
  }
  if (issue.code === 'slot_out_of_range' && Array.isArray(issue.slots)) {
    (issue.slots as Record<string, unknown>[]).forEach((s) => {
      out.push(`· ${s.groupNo}조 자리 ${s.slotNo} (정원 ${s.max})`);
    });
  }
  return out;
}

export default function GroupAssignBoard({ slug }: { slug: string }) {
  const [draw, setDraw] = React.useState<PreliminaryDraw | null>(null);
  const [ready, setReady] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [toast, setToast] = React.useState('');
  const [sel, setSel] = React.useState<Selection | null>(null);
  const [q, setQ] = React.useState('');
  const [groupCountInput, setGroupCountInput] = React.useState('');
  const [validation, setValidation] = React.useState<DrawValidation | null>(null);
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [unlockReason, setUnlockReason] = React.useState('');
  // 입력 방식. 실제 운영 기본 흐름은 엑셀 붙여넣기다(직접 편성은 아래 보드에서 항상 가능).
  const [mode, setMode] = React.useState<'paste' | 'manual'>('paste');

  const say = React.useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 3600);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchPreliminaryDraw(slug);
      setReady(r.ready);
      setDraw(r.draw);
      // 서버가 조회에 항상 검증 결과를 함께 주므로 화면 요약은 그것을 쓴다.
      if (r.draw) setValidation(r.draw.validation);
    } catch (err) {
      setReady(false);
      say(drawActionMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug, say]);

  React.useEffect(() => { void load(); }, [load]);

  /** write 공통 — 중복 클릭 방지 + 성공 후 authoritative full refetch. */
  const run = async (key: string, fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(key);
    try {
      const msg = await fn();
      setSel(null);
      await load();
      say(msg);
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      if (reason === 'version_conflict') {
        say('다른 운영자가 조편성을 변경했습니다. 최신 상태를 다시 불러옵니다.');
        setSel(null);
        await load();
      } else {
        say(drawActionMessage(err));
      }
    } finally {
      setBusy('');
    }
  };

  const locked = draw?.drawStatus === 'locked';
  const ver = draw?.version ?? null;
  const hint = groupPlanHint(draw?.validation.summary.activeTeams ?? 0);
  const prelimGroups = draw?.groups.filter((g) => g.groupType === 'preliminary') ?? [];
  const hasPlacement = (draw?.groups ?? []).some((g) => g.groupType === 'placement');

  /** 붙여넣기 매칭 대상 — 배정/미배정 구분 없이 대회의 모든 팀. */
  const allTeams = React.useMemo<MatchableTeam[]>(() => {
    if (!draw) return [];
    const out: MatchableTeam[] = draw.unassigned.map((t) => ({
      teamId: t.teamId, teamNo: t.teamNo,
      player1Name: t.player1Name, player2Name: t.player2Name, teamStatus: t.teamStatus,
    }));
    draw.groups.forEach((g) => g.members.forEach((m) => out.push({
      teamId: m.teamId, teamNo: m.teamNo,
      player1Name: m.player1Name, player2Name: m.player2Name, teamStatus: m.teamStatus,
    })));
    return out;
  }, [draw]);

  const filtered = React.useMemo(() => {
    const list = draw?.unassigned ?? [];
    const k = q.trim().toLowerCase();
    if (!k) return list;
    return list.filter((t) =>
      String(t.teamNo).includes(k) ||
      t.player1Name.toLowerCase().includes(k) ||
      t.player2Name.toLowerCase().includes(k) ||
      (t.player1ClubName || '').toLowerCase().includes(k) ||
      (t.player2ClubName || '').toLowerCase().includes(k));
  }, [draw, q]);

  // ── 조작 ───────────────────────────────────────────────────────────────────
  const pickUnassigned = (t: UnassignedTeam) => {
    if (locked) return;
    setSel(sel?.teamId === t.teamId
      ? null
      : { teamId: t.teamId, teamNo: t.teamNo, name: memberName(t), from: null });
  };

  const pickMember = (g: TournamentGroup, m: GroupMember) => {
    if (locked) return;
    // 이미 다른 팀이 선택돼 있으면 → 교환
    if (sel && sel.teamId !== m.teamId) {
      if (sel.from === null) {
        // 미배정 팀은 교환 대상이 아니다. 자리를 비우고 넣도록 안내한다.
        say('미배정 팀은 빈 자리에만 넣을 수 있습니다. 교환하려면 배정된 팀끼리 선택하세요.');
        return;
      }
      const a = sel.teamId; const b = m.teamId;
      void run(`swap-${a}-${b}`, async () => {
        await swapTeams(slug, a, b);
        return '두 팀의 자리를 교환했습니다.';
      });
      return;
    }
    setSel(sel?.teamId === m.teamId
      ? null
      : { teamId: m.teamId, teamNo: m.teamNo, name: memberName(m), from: { groupNo: g.groupNo, slotNo: m.slotNo } });
  };

  const placeInto = (g: TournamentGroup, slotNo: number) => {
    if (locked || !sel) return;
    const s = sel;
    if (s.from === null) {
      void run(`assign-${s.teamId}`, async () => {
        await assignTeam({ slug, groupNo: g.groupNo, teamId: s.teamId, slotNo });
        return `${s.teamNo}번 팀을 ${groupDisplayName(g)} ${slotNo}번 자리에 배정했습니다.`;
      });
    } else {
      void run(`move-${s.teamId}`, async () => {
        await moveTeam({ slug, teamId: s.teamId, toGroupNo: g.groupNo, toSlotNo: slotNo });
        return `${s.teamNo}번 팀을 ${groupDisplayName(g)} ${slotNo}번 자리로 옮겼습니다.`;
      });
    }
  };

  if (!ready) {
    return (
      <div style={{ ...card, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', gap: 9 }}>
        <AlertTriangle size={17} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
          조편성 데이터를 불러올 수 없습니다.<br />
          <code style={{ fontSize: 11.5 }}>supabase/add_hosted_tournament_groups.sql</code> 적용 여부와 CEO·ADMIN 권한을 확인해 주세요.
        </p>
      </div>
    );
  }

  const sum = draw?.validation.summary;

  return (
    <div>
      {/* ── 상단 상태 ───────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 800,
              color: locked ? '#fff' : '#B45309',
              background: locked ? '#047857' : '#FEF3C7',
              border: `1px solid ${locked ? '#047857' : '#FCD34D'}`,
            }}
          >
            {locked ? <Lock size={11} strokeWidth={3} /> : <Unlock size={11} strokeWidth={3} />}
            {locked ? '조편성 확정 완료' : '작성 중 (DRAFT)'}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>
            v{ver ?? '-'}
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => void load()} style={btn()} disabled={!!busy}>
            <RefreshCw size={12} strokeWidth={2.4} />
            {loading ? '조회 중' : '새로고침'}
          </button>
        </div>

        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))',
            gap: 8, marginTop: 12,
          }}
        >
          {[
            ['참가팀', sum?.activeTeams ?? 0, '#0F172A'],
            ['배정', sum?.assignedTeams ?? 0, '#1D4ED8'],
            ['미배정', sum?.unassignedTeams ?? 0, (sum?.unassignedTeams ?? 0) > 0 ? '#B45309' : '#94A3B8'],
            ['예선 조', prelimGroups.length, '#0F172A'],
            ['순위결정전', hasPlacement ? '있음' : '없음', hasPlacement ? '#7C3AED' : '#94A3B8'],
          ].map(([k, v, c]) => (
            <div key={k as string} style={{ padding: '9px 10px', borderRadius: 10, background: '#F8FAFC' }}>
              <p style={{ ...label, fontSize: 10 }}>{k}</p>
              <p style={{ margin: '3px 0 0', fontSize: 17, fontWeight: 900, color: c as string, lineHeight: 1.2 }}>
                {v}
              </p>
            </div>
          ))}
        </div>

        {/* 참고 계산값 — 표시만 한다. 어떤 자동 동작도 하지 않는다. */}
        <div style={{ display: 'flex', gap: 7, marginTop: 11, padding: '10px 12px', borderRadius: 9, background: '#F1F5F9' }}>
          <Info size={14} strokeWidth={2.2} color="#64748B" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.7, wordBreak: 'keep-all' }}>
            참가 {hint.activeTeams}팀 · 3팀 기준 참고: <strong>{hint.preliminaryGroups}조</strong>
            {hint.remainder > 0 && <> · 남는 팀 {hint.remainder}팀</>}
            {hint.suggestsPlacement && <> → 순위결정전 대상</>}
            <br />
            <span style={{ color: '#94A3B8' }}>
              참고 값입니다. 조 개수와 팀 배치는 경기이사가 직접 정합니다.
            </span>
          </p>
        </div>

        {locked && (
          <p style={{ margin: '10px 0 0', fontSize: 12, fontWeight: 700, color: '#047857', lineHeight: 1.7 }}>
            확정된 조편성입니다. 수정하려면 아래 “조편성 수정하기”로 잠금을 해제하세요.
          </p>
        )}
      </div>

      {/* ── 조편성 입력 방식 ─────────────────────────────────────────────── */}
      {!locked && (
        <div style={card}>
          <p style={label}>조편성 입력</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setMode('paste')}
                    style={btn(mode === 'paste' ? 'primary' : 'plain')}>
              엑셀에서 붙여넣기
            </button>
            <button type="button" onClick={() => setMode('manual')}
                    style={btn(mode === 'manual' ? 'primary' : 'plain')}>
              직접 편성하기
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7, wordBreak: 'keep-all' }}>
            {mode === 'paste'
              ? '엑셀에서 완성한 조편성을 한 번에 옮겨 담습니다. 미리보기로 확인한 뒤 반영합니다.'
              : '아래 보드에서 팀을 하나씩 배정·이동·교환합니다. 붙여넣기 반영 후 세부 보정에도 씁니다.'}
          </p>
        </div>
      )}

      {!locked && mode === 'paste' && (
        <GroupPasteImport
          slug={slug}
          teams={allTeams}
          version={ver}
          locked={locked}
          assignedCount={sum?.assignedTeams ?? 0}
          onApplied={say}
          onError={say}
          reload={load}
        />
      )}

      {/* ── 조 생성 ─────────────────────────────────────────────────────── */}
      {!locked && (
        <div style={card}>
          <p style={label}>조 만들기</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ width: 110 }}>
              <p style={{ ...label, fontSize: 10 }}>예선 조 개수</p>
              <input
                style={{ ...input, marginTop: 5 }}
                inputMode="numeric"
                placeholder={`예: ${hint.preliminaryGroups}`}
                value={groupCountInput}
                onChange={(e) => setGroupCountInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              />
            </div>
            <button
              type="button"
              disabled={!groupCountInput || !!busy}
              onClick={() =>
                void run('create', async () => {
                  const n = Number(groupCountInput);
                  await createGroups({ slug, preliminaryCount: n, expectedVersion: ver });
                  setGroupCountInput('');
                  return `예선 ${n}조를 만들었습니다.`;
                })
              }
              style={{ ...btn('primary'), minHeight: 34, opacity: groupCountInput ? 1 : 0.5 }}
            >
              <Plus size={13} strokeWidth={2.6} />
              조 생성
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setGroupCountInput(String(hint.preliminaryGroups))}
              style={{ ...btn('ghost'), minHeight: 34 }}
            >
              참고값 {hint.preliminaryGroups} 입력
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void run('create1', async () => {
                  await createGroups({ slug, preliminaryCount: 1, expectedVersion: ver });
                  return '조 1개를 추가했습니다.';
                })
              }
              style={{ ...btn(), minHeight: 34 }}
            >
              + 1조 추가
            </button>
          </div>

          {/* placement */}
          <div style={{ marginTop: 13, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A' }}>순위결정전 조</p>
              <button
                type="button"
                disabled={hasPlacement || !!busy}
                onClick={() =>
                  void run('placement', async () => {
                    await createGroups({ slug, preliminaryCount: 0, withPlacement: true, expectedVersion: ver });
                    return '순위결정전 조를 만들었습니다.';
                  })
                }
                style={{ ...btn(hasPlacement ? 'plain' : 'primary'), opacity: hasPlacement ? 0.5 : 1 }}
              >
                {hasPlacement ? '이미 있음' : '순위결정전 조 추가'}
              </button>
            </div>
            <p style={{ margin: '7px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              3팀씩 나누고 <strong>2팀이 남을 때</strong> 사용합니다. 두 팀 모두 본선에 진출하며,
              이 경기는 탈락을 가리는 것이 아니라 <strong>본선 진출 순서·배치</strong>를 정하기 위한 순위결정전입니다.
              어느 두 팀을 넣을지는 경기이사가 직접 지정합니다.
            </p>
          </div>
        </div>
      )}

      {/* ── 선택 안내 ───────────────────────────────────────────────────── */}
      {sel && !locked && (
        <div
          style={{
            ...card, marginBottom: 10, background: '#EFF6FF', border: '1px solid #BFDBFE',
            display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
          }}
        >
          <ShieldCheck size={16} color="#1D4ED8" style={{ flexShrink: 0 }} />
          <p style={{ margin: 0, flex: 1, minWidth: 180, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.6 }}>
            선택됨 · <strong>{sel.teamNo}번</strong> {sel.name}
            <span style={{ color: '#475569', fontWeight: 600 }}>
              {' — '}
              {sel.from
                ? '옮길 빈 자리를 누르거나, 교환할 팀을 누르세요.'
                : '넣을 빈 자리를 누르세요.'}
            </span>
          </p>
          <button type="button" onClick={() => setSel(null)} style={btn()}>
            <XIcon size={12} strokeWidth={2.6} /> 선택 해제
          </button>
        </div>
      )}

      {/* ── 본문 2열 (PC) / 세로 (모바일) ───────────────────────────────── */}
      <div className="tg-board">
        {/* 미배정 팀 */}
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <p style={label}>미배정 팀</p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: (sum?.unassignedTeams ?? 0) > 0 ? '#B45309' : '#047857' }}>
              {draw?.unassigned.length ?? 0}팀
            </p>
          </div>

          <div style={{ position: 'relative', marginTop: 9 }}>
            <Search size={14} color="#94A3B8" style={{ position: 'absolute', left: 10, top: 10 }} />
            <input
              style={{ ...input, paddingLeft: 30 }}
              placeholder="팀 번호 · 선수 이름 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div style={{ marginTop: 8, maxHeight: 620, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <p style={{ margin: '14px 0', fontSize: 12.5, fontWeight: 600, color: '#94A3B8', textAlign: 'center' }}>
                {loading ? '조회 중…' : (draw?.unassigned.length ?? 0) === 0 ? '모든 팀이 배정되었습니다.' : '검색 결과가 없습니다.'}
              </p>
            ) : filtered.map((t) => {
              const on = sel?.teamId === t.teamId;
              const out = t.teamStatus === 'withdrawn';
              return (
                <button
                  key={t.teamId}
                  type="button"
                  disabled={locked || !!busy}
                  onClick={() => pickUnassigned(t)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%',
                    textAlign: 'left', padding: '9px 10px', marginBottom: 5, borderRadius: 9,
                    border: `1px solid ${on ? '#1D4ED8' : '#E2E8F0'}`,
                    background: on ? '#EFF6FF' : '#fff',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    opacity: out ? 0.6 : 1, fontFamily: 'inherit',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{ flexShrink: 0, minWidth: 26, fontSize: 12, fontWeight: 800, color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                    {t.teamNo}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#0F172A', lineHeight: 1.45, wordBreak: 'keep-all' }}>
                      {memberName(t)}
                      {out && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: '#B91C1C' }}>기권</span>}
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                      {t.player1ClubName || '클럽 미입력'} / {t.player2ClubName || '클럽 미입력'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 조 카드 */}
        <div>
          {(draw?.groups.length ?? 0) === 0 ? (
            <div style={{ ...card, marginBottom: 0, textAlign: 'center', padding: '30px 15px' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#64748B', lineHeight: 1.7 }}>
                아직 조가 없습니다.<br />위에서 조 개수를 입력해 만들어 주세요.
              </p>
            </div>
          ) : (
            <div className="tg-groups">
              {draw!.groups.map((g) => {
                const filled = g.members.length;
                const complete = filled === g.expectedSize;
                const hasWithdrawn = g.members.some((m) => m.teamStatus === 'withdrawn');
                const isPlace = g.groupType === 'placement';
                const slots = Array.from({ length: g.expectedSize }, (_, i) => i + 1);
                return (
                  <div
                    key={g.groupId}
                    style={{
                      background: '#fff', borderRadius: 12, padding: 12,
                      border: `1px solid ${isPlace ? '#DDD6FE' : '#E2E8F0'}`,
                      borderLeft: `3px solid ${isPlace ? '#7C3AED' : complete ? '#047857' : '#CBD5E1'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                        {groupDisplayName(g)}
                      </p>
                      <span style={{
                        fontSize: 11.5, fontWeight: 800,
                        color: complete ? '#047857' : '#B45309',
                      }}>
                        {filled} / {g.expectedSize}
                      </span>
                      <div style={{ flex: 1 }} />
                      {!locked && filled === 0 && (
                        <button
                          type="button"
                          disabled={!!busy}
                          aria-label={`${groupDisplayName(g)} 삭제`}
                          onClick={() =>
                            void run(`del-${g.groupNo}`, async () => {
                              await deleteGroup(slug, g.groupNo, ver);
                              return `${groupDisplayName(g)}를 삭제했습니다.`;
                            })
                          }
                          style={{ ...btn('danger'), minHeight: 26, padding: '3px 7px' }}
                        >
                          <Trash2 size={11} strokeWidth={2.4} />
                        </button>
                      )}
                    </div>

                    {hasWithdrawn && (
                      <p style={{ margin: '7px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 800, color: '#B91C1C' }}>
                        <AlertTriangle size={12} strokeWidth={2.6} />
                        기권 팀이 포함돼 있습니다
                      </p>
                    )}

                    <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {slots.map((slotNo) => {
                        const m = g.members.find((x) => x.slotNo === slotNo);
                        if (!m) {
                          const active = !!sel && !locked;
                          return (
                            <button
                              key={slotNo}
                              type="button"
                              disabled={!active || !!busy}
                              onClick={() => placeInto(g, slotNo)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                                textAlign: 'left', padding: '8px 9px', borderRadius: 8,
                                border: `1px dashed ${active ? '#0E8C80' : '#E2E8F0'}`,
                                background: active ? '#ECFDF5' : '#FAFBFC',
                                color: active ? '#0A6F65' : '#94A3B8',
                                fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                                cursor: active ? 'pointer' : 'default',
                              }}
                            >
                              <span style={{ minWidth: 16, fontWeight: 800 }}>{slotNo}</span>
                              {active ? '여기에 넣기' : '빈 자리'}
                            </button>
                          );
                        }
                        const on = sel?.teamId === m.teamId;
                        const swapTarget = !!sel && sel.teamId !== m.teamId && sel.from !== null;
                        const out = m.teamStatus === 'withdrawn';
                        return (
                          <div
                            key={slotNo}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 7,
                              padding: '7px 9px', borderRadius: 8,
                              border: `1px solid ${on ? '#1D4ED8' : '#EEF2F6'}`,
                              background: on ? '#EFF6FF' : '#F8FAFC',
                              opacity: out ? 0.62 : 1,
                            }}
                          >
                            <span style={{ flexShrink: 0, minWidth: 16, fontSize: 11.5, fontWeight: 800, color: '#94A3B8' }}>
                              {slotNo}
                            </span>
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: '#0F172A', lineHeight: 1.45, wordBreak: 'keep-all' }}>
                                {memberName(m)}
                              </span>
                              <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                                {m.teamNo}번{out ? ' · 기권' : ''}
                              </span>
                            </span>
                            {!locked && (
                              <>
                                <button
                                  type="button"
                                  disabled={!!busy}
                                  onClick={() => pickMember(g, m)}
                                  style={{ ...btn(on ? 'primary' : 'plain'), minHeight: 26, padding: '3px 8px', fontSize: 11 }}
                                >
                                  {on ? '선택됨' : swapTarget ? '교환' : '선택'}
                                </button>
                                <button
                                  type="button"
                                  disabled={!!busy}
                                  onClick={() =>
                                    void run(`un-${m.teamId}`, async () => {
                                      await unassignTeam(slug, m.teamId);
                                      return `${m.teamNo}번 팀 배정을 취소했습니다.`;
                                    })
                                  }
                                  style={{ ...btn(), minHeight: 26, padding: '3px 8px', fontSize: 11 }}
                                >
                                  빼기
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 검증 / 확정 ─────────────────────────────────────────────────── */}
      <div style={{ ...card, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <p style={label}>검증 및 확정</p>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              void (async () => {
                setBusy('validate');
                try {
                  setValidation(await validateDraw(slug));
                  say('검증을 실행했습니다.');
                } catch (err) {
                  say(drawActionMessage(err));
                } finally {
                  setBusy('');
                }
              })()
            }
            style={btn()}
          >
            <ShieldCheck size={13} strokeWidth={2.4} />
            조편성 검증
          </button>

          {!locked ? (
            <button
              type="button"
              disabled={!!busy || !validation?.ok || ver === null}
              onClick={() => {
                const openReg = draw?.tournamentStatus === 'registration_open';
                const msg = openReg
                  ? '현재 참가 접수가 진행 중입니다. 추가 참가팀이 생길 수 있습니다.\n\n조편성을 확정하면 수정이 잠깁니다. 확정하시겠습니까?'
                  : '조편성을 확정하면 수정이 잠깁니다. 확정하시겠습니까?';
                if (!window.confirm(msg)) return;
                void run('lock', async () => {
                  const r = await lockDraw(slug, ver as number);
                  return r.warnings.includes('registration_still_open')
                    ? '조편성을 확정했습니다. (접수 진행 중 — 추가 팀 발생 가능)'
                    : '조편성을 확정했습니다.';
                });
              }}
              style={{
                ...btn('primary'),
                opacity: validation?.ok ? 1 : 0.5,
                cursor: validation?.ok ? 'pointer' : 'not-allowed',
              }}
            >
              <Lock size={13} strokeWidth={2.6} />
              조편성 확정
            </button>
          ) : (
            <button type="button" disabled={!!busy} onClick={() => setUnlockOpen((v) => !v)} style={btn()}>
              <Unlock size={13} strokeWidth={2.4} />
              조편성 수정하기
            </button>
          )}
        </div>

        {/* registration_open 경고 */}
        {!locked && draw?.tournamentStatus === 'registration_open' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 11, padding: '10px 12px', borderRadius: 9, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <AlertTriangle size={14} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#0F172A', lineHeight: 1.7, wordBreak: 'keep-all' }}>
              현재 참가 접수가 진행 중입니다. 추가 참가팀이 생길 수 있습니다.
              확정은 접수 종료 후에 하는 것을 권장합니다.
            </p>
          </div>
        )}

        {/* unlock 사유 */}
        {locked && unlockOpen && (
          <div style={{ marginTop: 11, padding: 12, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <p style={{ ...label, fontSize: 10.5 }}>수정 사유 (필수)</p>
            <input
              style={{ ...input, marginTop: 6 }}
              placeholder="예: 5조 선수 배정 오류 수정"
              maxLength={120}
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
              <button
                type="button"
                disabled={unlockReason.trim().length < 2 || !!busy}
                onClick={() =>
                  void run('unlock', async () => {
                    await unlockDraw(slug, unlockReason.trim(), ver);
                    setUnlockOpen(false);
                    setUnlockReason('');
                    return '잠금을 해제했습니다. 수정 후 다시 확정해 주세요.';
                  })
                }
                style={{ ...btn('primary'), opacity: unlockReason.trim().length >= 2 ? 1 : 0.5 }}
              >
                잠금 해제
              </button>
              <button type="button" onClick={() => setUnlockOpen(false)} style={btn()}>취소</button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6 }}>
              사유는 운영 기록에 남습니다.
            </p>
          </div>
        )}

        {/* 검증 결과 */}
        {validation && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
            {validation.ok ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  '모든 참가팀 배정 완료',
                  '일반 조 인원 정상',
                  ...(hasPlacement ? ['순위결정전 인원 정상'] : []),
                ].map((t) => (
                  <p key={t} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#047857' }}>
                    <Check size={13} strokeWidth={3} /> {t}
                  </p>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {validation.issues.map((iss, i) => {
                  const lines = issueLines(iss);
                  return (
                    <div key={`${iss.code}-${i}`}>
                      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: '#B91C1C' }}>
                        <AlertTriangle size={13} strokeWidth={2.6} /> {lines[0]}
                      </p>
                      {lines.slice(1).map((l, j) => (
                        <p key={j} style={{ margin: '3px 0 0 19px', fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
                          {l}
                        </p>
                      ))}
                    </div>
                  );
                })}
                <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                  문제를 표시만 합니다. 시스템이 자동으로 고치거나 팀을 옮기지 않습니다.
                </p>
              </div>
            )}
          </div>
        )}
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

      {/* PC 2열 / 모바일 세로. styled-jsx 없이 전역 규칙 하나로 처리한다. */}
      <style>{`
        .tg-board { display: grid; grid-template-columns: 1fr; gap: 10px; align-items: start; }
        .tg-groups { display: grid; grid-template-columns: 1fr; gap: 10px; }
        @media (min-width: 760px) {
          .tg-board { grid-template-columns: 300px 1fr; }
          .tg-groups { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
        }
        @media (min-width: 1200px) {
          .tg-board { grid-template-columns: 330px 1fr; }
        }
      `}</style>
    </div>
  );
}
