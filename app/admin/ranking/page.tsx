'use client';

export const dynamic = 'force-dynamic';

// TEYEON Ranking Manager — 랭킹 산식(가중치/최소조건) 조회·수정·미리보기·Publish.
//   접근: CEO OR ranking_managers (middleware + admin layout 가드). 이 화면은 산식만 다룬다.
//   금지(설계): 회원별 수동 점수·Archive/KDK 원본 수정·회원 권한 변경·Finance 등 타 Admin 기능.
//   미리보기는 같은 입력(loadRankingInputs)을 현재 산식 vs 후보 산식으로 2회 계산해 diff 만 보여준다(DB 무변경).

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { canAccessRankingAdmin } from '@/lib/admin/adminAccess';
import { computeClubRanking, type ClubRankingSeason } from '@/lib/ranking/clubRankingCore';
import { loadRankingInputs, type RankingInputs } from '@/lib/ranking/clubRankingService';
import {
  getActiveRankingConfig,
  listRankingConfigHistory,
  saveRankingDraft,
  publishRankingConfig,
  validateRankingConfig,
  normalizeRankingConfig,
  seasonKeyOf,
  DEFAULT_RANKING_CONFIG,
  type RankingConfigValues,
  type RankingConfigRow,
} from '@/lib/ranking/rankingConfig';
import {
  buildSnapshotData,
  archiveFingerprint,
  getFinalizedSnapshot,
  listSnapshots,
  finalizeSeason,
  reopenSeason,
  type RankingSnapshotRow,
} from '@/lib/ranking/rankingSnapshot';
import { getArchiveDate } from '@/lib/kdkArchiveStats';

type FormState = Record<keyof RankingConfigValues, string>;

const FIELDS: { key: keyof RankingConfigValues; label: string; hint: string }[] = [
  { key: 'participation', label: '참가 점수', hint: '공식 KDK 참가 1회' },
  { key: 'win', label: '승리 점수', hint: '공식 경기 승리 1회' },
  { key: 'bonusFirst', label: '1위 점수', hint: '세션 전체 1위' },
  { key: 'bonusSecond', label: '2위 점수', hint: '세션 전체 2위' },
  { key: 'bonusThird', label: '3위 점수', hint: '세션 전체 3위' },
  { key: 'minSessions', label: '정식 자격 최소 참가', hint: '공식 KDK n회 이상' },
  { key: 'bestWinrateMinGames', label: '최고 승률상 최소 경기', hint: '공식 n경기 이상' },
];

const toForm = (v: RankingConfigValues): FormState => ({
  participation: String(v.participation), win: String(v.win),
  bonusFirst: String(v.bonusFirst), bonusSecond: String(v.bonusSecond), bonusThird: String(v.bonusThird),
  minSessions: String(v.minSessions), bestWinrateMinGames: String(v.bestWinrateMinGames),
});

const fromForm = (f: FormState): RankingConfigValues => normalizeRankingConfig({
  participation: parseInt(f.participation, 10),
  win: parseInt(f.win, 10),
  bonusFirst: parseInt(f.bonusFirst, 10),
  bonusSecond: parseInt(f.bonusSecond, 10),
  bonusThird: parseInt(f.bonusThird, 10),
  minSessions: parseInt(f.minSessions, 10),
  bestWinrateMinGames: parseInt(f.bestWinrateMinGames, 10),
});

const valuesEqual = (a: RankingConfigValues, b: RankingConfigValues): boolean =>
  FIELDS.every((f) => a[f.key] === b[f.key]);

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginBottom: 14 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: '#475569', letterSpacing: '0.02em' };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '9px 10px', border: '1px solid #CBD5E1', borderRadius: 9, fontSize: 14, fontWeight: 700, color: '#0F172A' };

export default function AdminRankingPage() {
  const { role, canManageRanking, canManageRankingResolved } = useAuth();

  const [season, setSeason] = useState<ClubRankingSeason>(new Date().getFullYear());
  const [inputs, setInputs] = useState<RankingInputs | null>(null);
  const [published, setPublished] = useState<RankingConfigValues>(DEFAULT_RANKING_CONFIG);
  const [publishedRow, setPublishedRow] = useState<RankingConfigRow | null>(null);
  const [usingDefault, setUsingDefault] = useState(true);
  const [history, setHistory] = useState<RankingConfigRow[]>([]);
  const [form, setForm] = useState<FormState>(toForm(DEFAULT_RANKING_CONFIG));
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'draft' | 'publish' | 'finalize' | 'reopen'>('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ── 시즌 종료(finalize) 상태 ──
  const [finalizedRow, setFinalizedRow] = useState<RankingSnapshotRow | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<RankingSnapshotRow[]>([]);
  const [seasonSectionOpen, setSeasonSectionOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState('');
  const [finalizeConfirm, setFinalizeConfirm] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const seasonKey = seasonKeyOf(season);
  const isYearSeason = typeof season === 'number'; // 연도 시즌만 finalize 가능(누적/월간 제외)
  const isCeo = String(role || '').trim().toUpperCase() === 'CEO';

  const reload = async (nextSeason: ClubRankingSeason) => {
    setLoading(true);
    setMsg(null);
    try {
      const nextKey = seasonKeyOf(nextSeason);
      const [inp, active, hist, snap, snapHist] = await Promise.all([
        loadRankingInputs(),
        getActiveRankingConfig(nextSeason),
        listRankingConfigHistory(nextKey),
        typeof nextSeason === 'number' ? getFinalizedSnapshot(nextKey) : Promise.resolve(null),
        typeof nextSeason === 'number' ? listSnapshots(nextKey) : Promise.resolve([] as RankingSnapshotRow[]),
      ]);
      setInputs(inp);
      setPublished(active.values);
      setPublishedRow(active.row);
      setUsingDefault(active.fromDefault);
      setForm(toForm(active.values));
      setHistory(hist);
      setFinalizedRow(snap?.row ?? null);
      setSnapshotHistory(snapHist);
      setFinalizeReason('');
      setFinalizeConfirm(false);
      setReopenReason('');
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || '불러오지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(season); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [season]);

  const candidate = useMemo(() => fromForm(form), [form]);
  const errors = useMemo(() => validateRankingConfig(candidate), [candidate]);
  const changed = useMemo(() => !valuesEqual(candidate, published), [candidate, published]);

  // 미리보기 — 같은 입력으로 현재(published) vs 후보(candidate) 계산.
  const preview = useMemo(() => {
    if (!inputs) return null;
    const cur = computeClubRanking(inputs.archiveRows, inputs.members, season, published);
    const cand = computeClubRanking(inputs.archiveRows, inputs.members, season, candidate);
    const curRankById = new Map(cur.entries.map((e) => [e.memberId, e.rank]));
    const curPointsById = new Map(cur.entries.map((e) => [e.memberId, e.points]));
    const top = cand.entries.slice(0, 10).map((e) => ({
      entry: e,
      prevRank: curRankById.get(e.memberId) ?? null,
      rankDelta: (curRankById.get(e.memberId) ?? e.rank) - e.rank, // +면 상승
      pointDelta: e.points - (curPointsById.get(e.memberId) ?? e.points),
    }));
    // 공동 수상 배열 → 수상자 memberId 집합을 정렬·결합해 비교(공동 수상자 변화까지 감지).
    const awardKey = (arr: { memberId: string }[] | undefined) => (arr || []).map((w) => w.memberId).sort().join(',');
    const awardsChanged = (['mostParticipation', 'bestWinRate', 'mostWins', 'mostChampionships', 'mostTop3'] as const)
      .filter((k) => awardKey(cur.awards[k]) !== awardKey(cand.awards[k]));
    return { top, awardsChanged, curTop: cur.entries.slice(0, 10) };
  }, [inputs, season, published, candidate]);

  const setField = (k: keyof RankingConfigValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    setForm((prev) => ({ ...prev, [k]: digits }));
  };

  // 현재 published 산식으로 계산한 최종 결과(finalize 대상 = 지금 화면과 동일 산식).
  const publishedResult = useMemo(
    () => (inputs ? computeClubRanking(inputs.archiveRows, inputs.members, season, published) : null),
    [inputs, season, published],
  );

  // 시즌 종료 버튼 활성 조건.
  const finalizeChecks = useMemo(() => {
    const officialCount = publishedResult?.totalOfficialSessions ?? 0;
    const entryCount = publishedResult?.entries.length ?? 0;
    return {
      isYearSeason,
      hasPublished: !usingDefault && !!publishedRow,
      hasSessions: officialCount >= 1,
      hasEntries: entryCount >= 1,
      notFinalized: !finalizedRow,
      reasonOk: finalizeReason.trim().length >= 4,
      confirmed: finalizeConfirm,
      officialCount, entryCount,
    };
  }, [publishedResult, usingDefault, publishedRow, finalizedRow, finalizeReason, finalizeConfirm, isYearSeason]);
  const canFinalize = finalizeChecks.isYearSeason && finalizeChecks.hasPublished && finalizeChecks.hasSessions
    && finalizeChecks.hasEntries && finalizeChecks.notFinalized && finalizeChecks.reasonOk && finalizeChecks.confirmed;

  const doFinalize = async () => {
    if (busy || !canFinalize || !inputs || !publishedResult || !publishedRow) return;
    if (!window.confirm(`${seasonKey} 시즌을 종료(동결)하시겠습니까? 종료 후에는 이 시즌 순위가 변경되지 않습니다.`)) return;
    setBusy('finalize'); setMsg(null);
    try {
      const seasonYearRows = inputs.archiveRows.filter(
        (r) => r?.archive_type === 'kdk' && r?.is_official === true && getArchiveDate(r).slice(0, 4) === seasonKey,
      );
      const snapshotData = buildSnapshotData(
        publishedResult,
        { id: publishedRow.id, version: publishedRow.version, values: published },
        new Date().toISOString(),
      );
      const row = await finalizeSeason({
        seasonKey,
        seasonName: `${seasonKey} 시즌`,
        configId: publishedRow.id,
        configVersion: publishedRow.version,
        snapshotData,
        memberCount: publishedResult.aggregatedMembers,
        officialSessionCount: publishedResult.totalOfficialSessions,
        latestArchiveDate: publishedResult.latestSessionDate,
        archiveFingerprint: archiveFingerprint(seasonYearRows.map((r) => ({ id: r.id, created_at: r.created_at }))),
        finalizeReason,
      });
      setMsg({ kind: 'ok', text: `${seasonKey} 시즌 종료 완료 — snapshot ${row.id.slice(0, 8)} 생성(${new Date(row.finalizedAt).toLocaleString('ko-KR')}).` });
      await reload(season);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || '시즌 종료 실패.' });
    } finally { setBusy(''); }
  };

  const doReopen = async () => {
    if (busy || !isCeo || !finalizedRow) return;
    if (reopenReason.trim().length < 4) { setMsg({ kind: 'err', text: '재오픈 사유를 4자 이상 입력해주세요.' }); return; }
    if (!window.confirm(`${seasonKey} 시즌을 재오픈하시겠습니까? 현재 동결(finalized) snapshot 이 superseded 로 바뀌고 다시 live 계산됩니다.`)) return;
    setBusy('reopen'); setMsg(null);
    try {
      await reopenSeason(seasonKey, reopenReason);
      setMsg({ kind: 'ok', text: `${seasonKey} 시즌 재오픈 완료 — live 계산으로 복귀. 재동결하려면 다시 시즌 종료하세요.` });
      await reload(season);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || '재오픈 실패.' });
    } finally { setBusy(''); }
  };

  const doSaveDraft = async () => {
    if (busy) return;
    if (errors.length) { setMsg({ kind: 'err', text: errors[0] }); return; }
    setBusy('draft'); setMsg(null);
    try {
      await saveRankingDraft(seasonKey, candidate, reason);
      setMsg({ kind: 'ok', text: 'Draft 저장 완료.' });
      setHistory(await listRankingConfigHistory(seasonKey));
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Draft 저장 실패.' });
    } finally { setBusy(''); }
  };

  const doPublish = async () => {
    if (busy) return;
    if (errors.length) { setMsg({ kind: 'err', text: errors[0] }); return; }
    if (reason.trim().length < 4) { setMsg({ kind: 'err', text: '변경 사유를 4자 이상 입력해주세요.' }); return; }
    if (!changed && !usingDefault) { setMsg({ kind: 'err', text: '현재 적용값과 동일합니다 — 변경 후 Publish 하세요.' }); return; }
    if (!window.confirm(`이 산식을 ${seasonKey} 시즌에 Publish 하시겠습니까? 현재 시즌 순위가 새 산식으로 재계산됩니다.`)) return;
    setBusy('publish'); setMsg(null);
    try {
      await publishRankingConfig(seasonKey, candidate, reason);
      setReason('');
      setMsg({ kind: 'ok', text: `Publish 완료 — ${seasonKey} 새 산식이 적용되었습니다.` });
      await reload(season);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Publish 실패.' });
    } finally { setBusy(''); }
  };

  // CEO 는 role 로, 매니저는 can_manage_ranking 으로 허용(RPC 미배포 시에도 CEO 는 통과).
  if (canManageRankingResolved && !canAccessRankingAdmin(role, canManageRanking)) {
    return <div style={{ padding: 24, fontSize: 13, fontWeight: 700, color: '#0F172A' }}>이 화면은 CEO 또는 랭킹 매니저만 이용할 수 있습니다.</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 900, color: '#0F172A' }}>랭킹 관리</h1>
      <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 600, color: '#64748B' }}>
        공식 KDK 종합 포인트 산식(가중치·최소 조건)을 버전으로 관리합니다. 변경은 미리보기 후 사유와 함께 Publish 됩니다.
      </p>

      {/* 시즌 + 현재 상태 */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[{ v: new Date().getFullYear() as ClubRankingSeason, t: `${new Date().getFullYear()} 시즌` }, { v: 'all' as ClubRankingSeason, t: '누적' }].map((o) => (
            <button key={String(o.v)} type="button" onClick={() => setSeason(o.v)}
              style={{ padding: '7px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px solid', borderColor: seasonKey === seasonKeyOf(o.v) ? '#2563EB' : '#CBD5E1', background: seasonKey === seasonKeyOf(o.v) ? '#EFF6FF' : '#fff', color: seasonKey === seasonKeyOf(o.v) ? '#1D4ED8' : '#475569' }}>
              {o.t}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', lineHeight: 1.7 }}>
          <div>적용 산식: {usingDefault ? <b style={{ color: '#B45309' }}>기본값(미Publish)</b> : <b style={{ color: '#047857' }}>v{publishedRow?.version} (published)</b>}</div>
          {publishedRow && <div style={{ color: '#64748B' }}>마지막 변경: {new Date(publishedRow.createdAt).toLocaleString('ko-KR')} · 사유: {publishedRow.reason || '—'}</div>}
        </div>
      </div>

      {/* 가중치 폼 */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginBottom: 10 }}>가중치 설정</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <div style={label}>{f.label}</div>
              <input value={form[f.key]} onChange={setField(f.key)} inputMode="numeric" style={input} />
              <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 3 }}>{f.hint}</div>
            </div>
          ))}
        </div>
        {errors.length > 0 && <div style={{ marginTop: 10, fontSize: 11.5, fontWeight: 700, color: '#DC2626' }}>{errors[0]}</div>}
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setForm(toForm(published))} style={{ fontSize: 11.5, fontWeight: 700, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            현재 적용값으로 되돌리기
          </button>
        </div>
      </div>

      {/* 변경 영향 미리보기 */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginBottom: 4 }}>변경 영향 미리보기 · TOP 10</div>
        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>
          {loading ? '계산 중…' : changed ? '현재 산식 대비 변경 후 순위·포인트 변화입니다(저장 전 미리보기).' : '변경값이 없어 현재 순위와 동일합니다.'}
        </div>
        {preview && (
          <>
            {preview.awardsChanged.length > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#B45309', marginBottom: 8 }}>⚠ 시상 변경: {preview.awardsChanged.join(', ')}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {preview.top.map((r) => (
                <div key={r.entry.memberId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: '#F8FAFC' }}>
                  <span style={{ width: 26, textAlign: 'center', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>{r.entry.rank}</span>
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.entry.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: r.rankDelta > 0 ? '#059669' : r.rankDelta < 0 ? '#DC2626' : '#94A3B8', width: 42, textAlign: 'right' }}>
                    {r.prevRank === null ? 'NEW' : r.rankDelta === 0 ? '—' : r.rankDelta > 0 ? `▲${r.rankDelta}` : `▼${-r.rankDelta}`}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', width: 54, textAlign: 'right' }}>{r.entry.points}p</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: r.pointDelta > 0 ? '#059669' : r.pointDelta < 0 ? '#DC2626' : '#94A3B8', width: 40, textAlign: 'right' }}>
                    {r.pointDelta === 0 ? '' : r.pointDelta > 0 ? `+${r.pointDelta}` : r.pointDelta}
                  </span>
                </div>
              ))}
              {preview.top.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8' }}>집계 대상 회원이 없습니다.</div>}
            </div>
          </>
        )}
      </div>

      {/* 사유 + 저장/Publish */}
      <div style={card}>
        <div style={label}>변경 사유 (필수, 4자 이상)</div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="예: 세션 우승 비중 상향 조정"
          style={{ ...input, resize: 'vertical', fontWeight: 600 } as React.CSSProperties} />
        {msg && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msg.kind === 'ok' ? '#047857' : '#DC2626' }}>{msg.text}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={doSaveDraft} disabled={!!busy || loading || errors.length > 0}
            style={{ flex: 1, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', border: '1px solid #CBD5E1', background: '#fff', color: '#334155', opacity: busy || errors.length ? 0.6 : 1 }}>
            {busy === 'draft' ? '저장 중…' : 'Draft 저장'}
          </button>
          <button type="button" onClick={doPublish} disabled={!!busy || loading || errors.length > 0}
            style={{ flex: 1, padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', border: 'none', background: '#2563EB', color: '#fff', opacity: busy || errors.length ? 0.6 : 1 }}>
            {busy === 'publish' ? 'Publish 중…' : 'Publish'}
          </button>
        </div>
      </div>

      {/* 버전 이력 */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginBottom: 10 }}>변경 이력</div>
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94A3B8' }}>저장된 버전이 없습니다(현재는 기본 산식 적용).</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: '#F8FAFC', fontSize: 11.5 }}>
                <span style={{ fontWeight: 900, color: '#0F172A' }}>v{h.version}</span>
                <span style={{ padding: '2px 7px', borderRadius: 999, fontWeight: 800, fontSize: 10, color: h.status === 'published' ? '#047857' : h.status === 'draft' ? '#B45309' : '#64748B', background: h.status === 'published' ? '#DCFCE7' : h.status === 'draft' ? '#FEF3C7' : '#E2E8F0' }}>{h.status}</span>
                <span style={{ flex: 1, color: '#475569', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  참{h.participation}·승{h.win}·1위{h.bonusFirst}·2위{h.bonusSecond}·3위{h.bonusThird} · {h.reason || '—'}
                </span>
                <span style={{ color: '#94A3B8', fontWeight: 600 }}>{new Date(h.createdAt).toLocaleDateString('ko-KR')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 시즌 종료(동결) — 접이식. 연도 시즌에서만. ── */}
      <div style={card}>
        <button type="button" onClick={() => setSeasonSectionOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#0F172A' }}>시즌 종료 · 동결</span>
          {finalizedRow && <span style={{ fontSize: 10, fontWeight: 800, color: '#047857', background: '#DCFCE7', borderRadius: 999, padding: '2px 8px' }}>FINALIZED</span>}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#64748B' }}>{seasonSectionOpen ? '접기 ▲' : '펼치기 ▼'}</span>
        </button>

        {seasonSectionOpen && (
          <div style={{ marginTop: 12 }}>
            {!isYearSeason ? (
              <div style={{ fontSize: 12, fontWeight: 700, color: '#B45309' }}>시즌 종료는 연도 시즌에서만 가능합니다(누적 제외).</div>
            ) : finalizedRow ? (
              // 이미 종료됨 — 동결 정보 + CEO 재오픈
              <div>
                <div style={{ padding: '10px 12px', borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0', fontSize: 12, fontWeight: 700, color: '#065F46', lineHeight: 1.7 }}>
                  ✓ {seasonKey} 시즌 동결됨(snapshot {finalizedRow.id.slice(0, 8)}) · v{finalizedRow.configVersion} · 회원 {finalizedRow.memberCount} · 세션 {finalizedRow.officialSessionCount}
                  <br />종료 {new Date(finalizedRow.finalizedAt).toLocaleString('ko-KR')} · 사유: {finalizedRow.finalizeReason || '—'}
                  <br /><span style={{ color: '#047857' }}>이 시즌은 이제 snapshot 기준으로 표시되며 가중치·Archive 변경에 영향받지 않습니다.</span>
                </div>
                {isCeo && (
                  <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid #FCA5A5', background: '#FEF2F2' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#B91C1C', marginBottom: 4 }}>⚠ 시즌 재오픈 (CEO 전용)</div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: '#7F1D1D', lineHeight: 1.6 }}>
                      재오픈하면 현재 동결 snapshot 이 superseded 로 바뀌고 다시 live 계산됩니다. 기존 snapshot 은 삭제되지 않고 이력에 보존됩니다.
                    </p>
                    <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2} placeholder="재오픈 사유 (4자 이상)"
                      style={{ ...input, resize: 'vertical', fontWeight: 600 } as React.CSSProperties} />
                    <button type="button" onClick={doReopen} disabled={!!busy || reopenReason.trim().length < 4}
                      style={{ marginTop: 8, padding: '9px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', border: 'none', background: '#DC2626', color: '#fff', opacity: busy || reopenReason.trim().length < 4 ? 0.6 : 1 }}>
                      {busy === 'reopen' ? '재오픈 중…' : '시즌 재오픈'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              // 종료 전 — 체크리스트 + 사유 + 확인 + 종료 버튼
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#334155', lineHeight: 1.9, marginBottom: 8 }}>
                  <div style={{ color: finalizeChecks.hasPublished ? '#047857' : '#DC2626' }}>{finalizeChecks.hasPublished ? '✓' : '✗'} published 산식 존재 {publishedRow ? `(v${publishedRow.version})` : '(없음 — 먼저 Publish)'}</div>
                  <div style={{ color: finalizeChecks.hasSessions ? '#047857' : '#DC2626' }}>{finalizeChecks.hasSessions ? '✓' : '✗'} 공식 세션 {finalizeChecks.officialCount}개</div>
                  <div style={{ color: finalizeChecks.hasEntries ? '#047857' : '#DC2626' }}>{finalizeChecks.hasEntries ? '✓' : '✗'} 집계 회원 {finalizeChecks.entryCount}명</div>
                </div>
                {publishedResult && (
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>
                    TOP3: {publishedResult.entries.slice(0, 3).map((e, i) => `${i + 1}.${e.name}(${e.points}p)`).join(' · ') || '—'}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, color: '#B45309', marginBottom: 8 }}>종료 후에는 이 시즌 순위·수상이 변경되지 않습니다(재오픈은 CEO만).</div>
                <textarea value={finalizeReason} onChange={(e) => setFinalizeReason(e.target.value)} rows={2} placeholder="종료 사유 (4자 이상)"
                  style={{ ...input, resize: 'vertical', fontWeight: 600 } as React.CSSProperties} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                  <input type="checkbox" checked={finalizeConfirm} onChange={(e) => setFinalizeConfirm(e.target.checked)} />
                  최종 Ranking·Awards를 확인했으며 이 시즌을 동결하는 데 동의합니다.
                </label>
                <button type="button" onClick={doFinalize} disabled={!!busy || loading || !canFinalize}
                  style={{ marginTop: 12, width: '100%', padding: '12px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: busy || !canFinalize ? 'default' : 'pointer', border: 'none', background: '#0F766E', color: '#fff', opacity: busy || !canFinalize ? 0.55 : 1 }}>
                  {busy === 'finalize' ? '종료 처리 중…' : `${seasonKey} 시즌 종료(동결)`}
                </button>
              </div>
            )}

            {/* snapshot 이력 */}
            {snapshotHistory.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, fontWeight: 900, color: '#0F172A', marginBottom: 6 }}>snapshot 이력</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {snapshotHistory.map((s) => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: '#F8FAFC', fontSize: 11 }}>
                      <span style={{ padding: '2px 7px', borderRadius: 999, fontWeight: 800, fontSize: 10, color: s.status === 'finalized' ? '#047857' : '#64748B', background: s.status === 'finalized' ? '#DCFCE7' : '#E2E8F0' }}>{s.status}</span>
                      <span style={{ flex: 1, color: '#475569', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        v{s.configVersion} · 회원{s.memberCount} · {s.finalizeReason || '—'}{s.reopenReason ? ` · 재오픈: ${s.reopenReason}` : ''}
                      </span>
                      <span style={{ color: '#94A3B8', fontWeight: 600 }}>{new Date(s.finalizedAt).toLocaleDateString('ko-KR')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
