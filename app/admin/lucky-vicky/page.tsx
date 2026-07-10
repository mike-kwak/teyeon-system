'use client';

export const dynamic = 'force-dynamic';

// TEYEON Admin — 러키비키(LUCKY VICKY) 관리. CEO/ADMIN 전용(middleware + admin layout 가드 + 페이지 재검증).
//   · 회차(round) CRUD → 팀(team, 회원 2명) CRUD. 저장은 직접 테이블 CRUD + RLS.
//   · 단일 active·spotlight-active·중복참여·2명검증은 DB(부분 unique/CHECK/trigger)가 최종 보장, UI 는 사전 검증.
//   · 실제 저장 발생 — 촬영 보호(guardWriteAction)는 이 화면 범위 밖(관리자 실데이터 입력용).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Plus, Pencil, Trash2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { loadRankingInputs } from '@/lib/ranking/clubRankingService';
import {
  fetchAllRoundsAdmin, createRound, updateRound, deleteRound,
  createTeam, updateTeam, deleteTeam, luckyVickyErrorMessage,
  type RoundInput, type TeamInput,
} from '@/lib/luckyVickyService';
import type {
  LuckyVickyRound, LuckyVickyTeam, LuckyVickyRoundStatus,
  LuckyVickyTeamStatus, LuckyVickySupportStatus,
} from '@/lib/luckyVickyData';

type Member = { id: string; name: string };

const ROUND_STATUS: { v: LuckyVickyRoundStatus; t: string }[] = [
  { v: 'waiting', t: '대기' }, { v: 'active', t: '진행 중' }, { v: 'completed', t: '종료' },
];
const TEAM_STATUS: { v: LuckyVickyTeamStatus; t: string }[] = [
  { v: 'selecting_tournament', t: '대회 선택 중' }, { v: 'preparing', t: '출전 준비' },
  { v: 'registered', t: '참가 신청 완료' }, { v: 'completed', t: '출전 완료' },
];
const SUPPORT_STATUS: { v: LuckyVickySupportStatus; t: string }[] = [
  { v: 'pending_result', t: '결과 대기' }, { v: 'eligible', t: '지원 대상' },
  { v: 'supported', t: '지원 완료' }, { v: 'not_eligible', t: '미지원' },
];
const teamStatusLabel = (v: LuckyVickyTeamStatus) => TEAM_STATUS.find((x) => x.v === v)?.t || v;
const supportLabel = (v: LuckyVickySupportStatus) => SUPPORT_STATUS.find((x) => x.v === v)?.t || v;

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 14, marginBottom: 12 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: '#475569' };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 10px', border: '1px solid #CBD5E1', borderRadius: 9, fontSize: 14, fontWeight: 600, color: '#0F172A' };
const btnPrimary: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, border: 'none', background: '#2563EB', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '8px 12px', borderRadius: 9, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' };
const chip = (on: boolean): React.CSSProperties => ({ padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer', border: '1px solid', borderColor: on ? '#2563EB' : '#CBD5E1', background: on ? '#EFF6FF' : '#fff', color: on ? '#1D4ED8' : '#475569' });

// ── 회원 선택 모달 (검색 + 목록, 이미 선택된 파트너 제외) ─────────────────────────
function MemberPickerModal({ members, excludeId, onPick, onClose }: {
  members: Member[]; excludeId: string | null; onPick: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  useEffect(() => { const p = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = p; }; }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const filtered = members.filter((m) => m.id !== excludeId && (q.trim() === '' || m.name.includes(q.trim())));
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="회원 선택"
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '82dvh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <p style={{ flex: 1, margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A' }}>회원 선택</p>
            <button type="button" onClick={onClose} aria-label="닫기" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #E2E8F0', background: 'transparent', color: '#64748B', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={16} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: '#F1F5F9' }}>
            <Search size={15} color="#94A3B8" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색" aria-label="회원 이름 검색"
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, fontWeight: 600, color: '#0F172A' }} />
          </div>
        </div>
        <div role="listbox" style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 10px', paddingBottom: 'calc(var(--bottom-nav-area, 88px) + 16px)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#94A3B8' }}>검색 결과가 없습니다.</div>
          ) : filtered.map((m) => (
            <button key={m.id} type="button" onClick={() => onPick(m.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 12px', borderRadius: 12, background: '#fff', border: '1px solid #E2E8F0', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 회차 폼 ─────────────────────────────────────────────────────────────────────
function RoundForm({ initial, busy, onSave, onCancel }: {
  initial?: LuckyVickyRound; busy: boolean; onSave: (v: RoundInput) => void; onCancel: () => void;
}) {
  const [roundNumber, setRoundNumber] = useState(String(initial?.round ?? ''));
  const [title, setTitle] = useState(initial?.title ?? '');
  const [status, setStatus] = useState<LuckyVickyRoundStatus>(initial?.status ?? 'waiting');
  const [selectionMethod, setSelectionMethod] = useState(initial?.selectionMethod ?? '');
  const [expected, setExpected] = useState(initial?.expectedTeamCount != null ? String(initial.expectedTeamCount) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [spotlight, setSpotlight] = useState(initial?.spotlightEnabled ?? false);

  const rn = parseInt(roundNumber, 10);
  const spotlightBlocked = spotlight && status !== 'active';
  const valid = Number.isFinite(rn) && rn >= 1 && title.trim().length > 0 && !spotlightBlocked;

  return (
    <div style={{ ...card, borderColor: '#BFDBFE', background: '#F8FAFF' }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginBottom: 10 }}>{initial ? '회차 수정' : '회차 추가'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><div style={label}>회차 번호</div><input value={roundNumber} onChange={(e) => setRoundNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" style={input} /></div>
        <div><div style={label}>예상 팀 수(선택)</div><input value={expected} onChange={(e) => setExpected(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} inputMode="numeric" style={input} /></div>
      </div>
      <div style={{ marginTop: 10 }}><div style={label}>제목</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 3회차" style={input} /></div>
      <div style={{ marginTop: 10 }}>
        <div style={label}>상태</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          {ROUND_STATUS.map((s) => <button key={s.v} type="button" onClick={() => setStatus(s.v)} style={chip(status === s.v)}>{s.t}</button>)}
        </div>
      </div>
      <div style={{ marginTop: 10 }}><div style={label}>선정 방식(선택)</div><input value={selectionMethod} onChange={(e) => setSelectionMethod(e.target.value)} placeholder="예: 제비뽑기" style={input} /></div>
      <div style={{ marginTop: 10 }}><div style={label}>회차 메모(선택)</div><input value={note} onChange={(e) => setNote(e.target.value)} style={input} /></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12.5, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
        <input type="checkbox" checked={spotlight} onChange={(e) => setSpotlight(e.target.checked)} />
        메인 Spotlight 노출(진행 중 회차만 가능)
      </label>
      {spotlightBlocked && <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: '#DC2626' }}>Spotlight는 상태가 &lsquo;진행 중&rsquo;일 때만 켤 수 있습니다.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={onCancel} style={{ ...btnGhost, flex: 1 }}>취소</button>
        <button type="button" disabled={!valid || busy}
          onClick={() => onSave({ roundNumber: rn, title, status, selectionMethod, expectedTeamCount: expected === '' ? null : parseInt(expected, 10), note, spotlightEnabled: spotlight })}
          style={{ ...btnPrimary, flex: 1, opacity: (!valid || busy) ? 0.5 : 1 }}>{busy ? '저장 중…' : '저장'}</button>
      </div>
    </div>
  );
}

// ── 팀 폼 ───────────────────────────────────────────────────────────────────────
function TeamForm({ roundId, existingMemberIds, initial, members, busy, onSave, onCancel }: {
  roundId: string; existingMemberIds: Set<string>; initial?: LuckyVickyTeam; members: Member[]; busy: boolean;
  onSave: (v: TeamInput) => void; onCancel: () => void;
}) {
  const [m1, setM1] = useState<string | null>(initial?.memberIds[0] ?? null);
  const [m2, setM2] = useState<string | null>(initial?.memberIds[1] ?? null);
  const [picker, setPicker] = useState<null | 1 | 2>(null);
  const [tournamentName, setTournamentName] = useState(initial?.tournamentName ?? '');
  const [tournamentDate, setTournamentDate] = useState(initial?.tournamentDate ?? '');
  const [targetResult, setTargetResult] = useState(initial?.targetResult ?? '');
  const [actualResult, setActualResult] = useState(initial?.actualResult ?? '');
  const [teamStatus, setTeamStatus] = useState<LuckyVickyTeamStatus>(initial?.status ?? 'selecting_tournament');
  const [supportStatus, setSupportStatus] = useState<LuckyVickySupportStatus>(initial?.supportStatus ?? 'pending_result');
  const [note, setNote] = useState(initial?.note ?? '');

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? '';
  // 같은 회차 다른 팀에 이미 포함된 회원(자기 팀 제외) — 사전 차단.
  const ownIds = new Set([initial?.memberIds[0], initial?.memberIds[1]].filter(Boolean) as string[]);
  const inOtherTeam = (id: string) => existingMemberIds.has(id) && !ownIds.has(id);
  const dupWarn = (m1 && inOtherTeam(m1)) || (m2 && inOtherTeam(m2));
  const valid = !!m1 && !!m2 && m1 !== m2 && !dupWarn && !busy;

  return (
    <div style={{ ...card, borderColor: '#C7D2FE', background: '#FAFAFF' }}>
      <div style={{ fontSize: 12.5, fontWeight: 900, color: '#0F172A', marginBottom: 10 }}>{initial ? '팀 수정' : '팀 추가'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[{ n: 1 as const, id: m1 }, { n: 2 as const, id: m2 }].map(({ n, id }) => (
          <div key={n}>
            <div style={label}>회원 {n}</div>
            <button type="button" onClick={() => setPicker(n)} style={{ ...input, textAlign: 'left', cursor: 'pointer', color: id ? '#0F172A' : '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id ? nameOf(id) : '회원 선택'}</span>
              <Search size={14} color="#94A3B8" />
            </button>
          </div>
        ))}
      </div>
      {m1 && m2 && m1 === m2 && <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: '#DC2626' }}>서로 다른 두 회원을 선택하세요.</div>}
      {dupWarn && <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: '#DC2626' }}>이미 이 회차의 다른 팀에 포함된 회원입니다.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <div><div style={label}>출전 대회(선택)</div><input value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} style={input} /></div>
        <div><div style={label}>출전 날짜(선택)</div><input type="date" value={tournamentDate} onChange={(e) => setTournamentDate(e.target.value)} style={input} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <div><div style={label}>목표 성적(선택)</div><input value={targetResult} onChange={(e) => setTargetResult(e.target.value)} placeholder="예: 본선 진출" style={input} /></div>
        <div><div style={label}>실제 결과(선택)</div><input value={actualResult} onChange={(e) => setActualResult(e.target.value)} style={input} /></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={label}>팀 상태</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          {TEAM_STATUS.map((s) => <button key={s.v} type="button" onClick={() => setTeamStatus(s.v)} style={chip(teamStatus === s.v)}>{s.t}</button>)}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={label}>지원 상태</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          {SUPPORT_STATUS.map((s) => <button key={s.v} type="button" onClick={() => setSupportStatus(s.v)} style={chip(supportStatus === s.v)}>{s.t}</button>)}
        </div>
      </div>
      <div style={{ marginTop: 10 }}><div style={label}>팀 메모(선택)</div><input value={note} onChange={(e) => setNote(e.target.value)} style={input} /></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={onCancel} style={{ ...btnGhost, flex: 1 }}>취소</button>
        <button type="button" disabled={!valid}
          onClick={() => onSave({ roundId, member1Id: m1!, member2Id: m2!, tournamentName, tournamentDate, targetResult, actualResult, teamStatus, supportStatus, note })}
          style={{ ...btnPrimary, flex: 1, opacity: !valid ? 0.5 : 1 }}>{busy ? '저장 중…' : '저장'}</button>
      </div>
      {picker && (
        <MemberPickerModal members={members} excludeId={picker === 1 ? m2 : m1}
          onPick={(id) => { if (picker === 1) setM1(id); else setM2(id); setPicker(null); }}
          onClose={() => setPicker(null)} />
      )}
    </div>
  );
}

export default function AdminLuckyVickyPage() {
  const router = useRouter();
  const { role, isLoading } = useAuth();
  const [rounds, setRounds] = useState<LuckyVickyRound[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [creatingRound, setCreatingRound] = useState(false);
  const [editRoundId, setEditRoundId] = useState<string | null>(null);
  const [expandedRoundId, setExpandedRoundId] = useState<string | null>(null);
  const [teamForm, setTeamForm] = useState<{ roundId: string; team?: LuckyVickyTeam } | null>(null);

  const isAdmin = isFullAdminRole(role);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [rs, inp] = await Promise.all([fetchAllRoundsAdmin(), loadRankingInputs()]);
      setRounds(rs);
      setMembers(inp.members.map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')));
    } catch (e: any) {
      setMsg({ kind: 'err', text: luckyVickyErrorMessage(e) });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (isAdmin) void reload(); }, [isAdmin, reload]);

  const run = async (label: string, fn: () => Promise<void>, after?: () => void) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ kind: 'ok', text: `${label} 완료.` }); after?.(); await reload(); }
    catch (e: any) { setMsg({ kind: 'err', text: luckyVickyErrorMessage(e) }); }
    finally { setBusy(false); }
  };

  if (!isLoading && !isAdmin) {
    return <div style={{ padding: 24, fontSize: 13, fontWeight: 700, color: '#0F172A' }}>이 화면은 CEO 또는 ADMIN만 이용할 수 있습니다.</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 900, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={18} style={{ color: '#C79A32' }} /> LUCKY VICKY 관리
      </h1>
      <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 600, color: '#64748B' }}>
        러키비키 회차와 팀(회원 2명)을 입력·수정합니다. 진행 중 회차는 클럽당 1개, 메인 Spotlight는 진행 중 회차에서만 켤 수 있습니다.
      </p>

      {msg && <div style={{ marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: msg.kind === 'ok' ? '#047857' : '#DC2626' }}>{msg.text}</div>}

      {!creatingRound && !editRoundId && (
        <button type="button" onClick={() => setCreatingRound(true)} style={{ ...btnPrimary, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={15} /> 회차 추가
        </button>
      )}
      {creatingRound && (
        <RoundForm busy={busy} onCancel={() => setCreatingRound(false)}
          onSave={(v) => run('회차 저장', () => createRound(v), () => setCreatingRound(false))} />
      )}

      {loading ? (
        <div style={{ ...card, textAlign: 'center', color: '#94A3B8', fontSize: 12.5, fontWeight: 700 }}>불러오는 중…</div>
      ) : rounds.length === 0 && !creatingRound ? (
        <div style={{ ...card, textAlign: 'center', color: '#94A3B8', fontSize: 12.5, fontWeight: 700 }}>등록된 회차가 없습니다. &lsquo;회차 추가&rsquo;로 시작하세요.</div>
      ) : (
        rounds.map((r) => {
          const memberIdsInRound = new Set(r.teams.flatMap((t) => t.memberIds));
          const open = expandedRoundId === r.id;
          return (
            <div key={r.id} style={card}>
              {editRoundId === r.id ? (
                <RoundForm initial={r} busy={busy} onCancel={() => setEditRoundId(null)}
                  onSave={(v) => run('회차 저장', () => updateRound(r.id, v), () => setEditRoundId(null))} />
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: '#0F172A' }}>{r.title || `${r.round}회차`}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: r.status === 'active' ? '#047857' : r.status === 'completed' ? '#475569' : '#B45309', background: r.status === 'active' ? '#DCFCE7' : r.status === 'completed' ? '#E2E8F0' : '#FEF3C7' }}>
                      {ROUND_STATUS.find((s) => s.v === r.status)?.t}
                    </span>
                    {r.spotlightEnabled && <span style={{ fontSize: 10, fontWeight: 800, color: '#8E6B17', background: 'rgba(199,154,50,0.12)', padding: '2px 7px', borderRadius: 999 }}>SPOTLIGHT</span>}
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={() => setExpandedRoundId(open ? null : r.id)} aria-label="팀 펼치기" style={{ ...btnGhost, padding: '6px 8px' }}>{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                    {r.round}회차{r.selectionMethod ? ` · ${r.selectionMethod}` : ''}{r.expectedTeamCount != null ? ` · 예상 ${r.expectedTeamCount}팀` : ''} · 팀 {r.teams.length}개
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button type="button" onClick={() => { setEditRoundId(r.id); setCreatingRound(false); }} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Pencil size={13} /> 회차 수정</button>
                    <button type="button" onClick={() => { if (window.confirm(`${r.title || r.round + '회차'} 및 소속 팀을 모두 삭제하시겠습니까?`)) void run('회차 삭제', () => deleteRound(r.id)); }} style={{ ...btnGhost, color: '#DC2626', borderColor: '#FCA5A5', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Trash2 size={13} /> 삭제</button>
                  </div>

                  {open && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
                      {r.teams.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600, marginBottom: 10 }}>등록된 팀이 없습니다.</div>
                      ) : r.teams.map((t) => (
                        teamForm?.team?.id === t.id ? (
                          <TeamForm key={t.id} roundId={r.id} existingMemberIds={memberIdsInRound} initial={t} members={members} busy={busy}
                            onCancel={() => setTeamForm(null)}
                            onSave={(v) => run('팀 저장', () => updateTeam(t.id, v), () => setTeamForm(null))} />
                        ) : (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 10, background: '#F8FAFC', marginBottom: 6 }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.memberNames.filter(Boolean).join(' · ') || '(회원 미확인)'}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B' }}>{teamStatusLabel(t.status)} · {supportLabel(t.supportStatus)}</span>
                            <button type="button" onClick={() => setTeamForm({ roundId: r.id, team: t })} aria-label="팀 수정" style={{ ...btnGhost, padding: '5px 7px' }}><Pencil size={12} /></button>
                            <button type="button" onClick={() => { if (window.confirm('이 팀을 삭제하시겠습니까?')) void run('팀 삭제', () => deleteTeam(t.id)); }} aria-label="팀 삭제" style={{ ...btnGhost, padding: '5px 7px', color: '#DC2626', borderColor: '#FCA5A5' }}><Trash2 size={12} /></button>
                          </div>
                        )
                      ))}
                      {teamForm?.roundId === r.id && !teamForm.team ? (
                        <TeamForm roundId={r.id} existingMemberIds={memberIdsInRound} members={members} busy={busy}
                          onCancel={() => setTeamForm(null)}
                          onSave={(v) => run('팀 저장', () => createTeam(v), () => setTeamForm(null))} />
                      ) : (
                        !teamForm && <button type="button" onClick={() => setTeamForm({ roundId: r.id })} style={{ ...btnGhost, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> 팀 추가</button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}

      <div style={{ height: 40 }} aria-hidden />
    </div>
  );
}
