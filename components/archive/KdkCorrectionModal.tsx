'use client';

// KDK 경기 기록 정정 모달 — CEO/ADMIN 전용.
//
//   흐름: 경기 선택 → 점수 수정 → 변경 영향 미리보기 → 사유 입력 → 최종 확인 → RPC 1회
//   ⚠ optimistic UI 금지. 성공하면 호출부가 서버에서 다시 읽는다.
//   ⚠ 계산은 lib/kdk/correction.ts(순수, 기존 SSoT 조합)만 한다 — 이 파일은 그리고 전달한다.
//   ⚠ 영향이 없는 항목도 '변경 없음' 으로 명시한다(생략 금지).
//   ⚠ 공식 확정 전/후 모두 쓴다. 명칭만 바뀌고 계산·RPC·감사 구조는 하나다.
//   ⚠ 배경 스크롤 잠금은 기존 useBodyScrollLock 을 재사용한다(새 구현 금지).

import React from 'react';
import { X, AlertTriangle, ChevronRight, Check } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import {
  computeCorrectionImpact, listCorrectableMatches, memberIdsForBirthYear,
  type CorrectionImpact, type CorrectionMatchOption, type CorrectionPlayerRow,
} from '@/lib/kdk/correction';
import {
  correctKdkArchiveMatchScore, correctionActionMessage, correctionBlockMessage,
  fetchCorrectionContext, fetchMemberBirthYears,
  type CorrectionContext,
} from '@/lib/kdk/correctionService';

const NAVY = '#0F2747';
const INK = '#13243D';
const MUTED = '#5A7193';
const FAINT = '#94A3B8';
const LINE = '#DCE8F5';
const SOFT = '#F4F8FC';
const TEAL = '#0F9F98';
const WARN_BG = '#FFF4DE';
const WARN_BD = '#F4C979';
const WARN_INK = '#B7791F';
const DANGER = '#C0392B';

type Step = 'pick' | 'edit' | 'confirm';

interface Props {
  archiveId: string;
  sessionTitle?: string | null;
  sessionDate?: string | null;
  /** 모달을 열 때의 공식 상태 — 제목 문구에만 쓴다(권위는 서버 context). */
  isOfficial: boolean;
  onClose: () => void;
  /** 정정이 성공했을 때. 호출부가 authoritative refetch 한다. */
  onCorrected: () => void;
}

const won = (v: number): string => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ko-KR')}원`;
const teamText = (names: string[]): string => names.filter(n => n.trim() !== '').join(' / ') || '—';

/** 변경 목록 한 줄 — 비어 있으면 '변경 없음' 을 반드시 출력한다. */
function ImpactRow({ label, items, tone }: {
  label: string;
  items: string[];
  tone?: 'warn' | 'plain';
}) {
  const none = items.length === 0;
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '8px 0', borderBottom: `1px solid ${LINE}`,
    }}>
      <span style={{
        flexShrink: 0, width: 82, fontSize: 11.5, fontWeight: 900, color: MUTED,
        wordBreak: 'keep-all', lineHeight: 1.5,
      }}>
        {label}
      </span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {none ? (
          <span style={{ fontSize: 12, fontWeight: 800, color: FAINT }}>변경 없음</span>
        ) : items.map((t, i) => (
          <span key={i} style={{
            fontSize: 12, fontWeight: 800, lineHeight: 1.55, wordBreak: 'keep-all',
            color: tone === 'warn' ? WARN_INK : INK,
          }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScoreBadge({ s1, s2 }: { s1: number; s2: number }) {
  return (
    <span style={{
      flexShrink: 0, fontVariantNumeric: 'tabular-nums',
      fontSize: 13, fontWeight: 900, color: INK, whiteSpace: 'nowrap',
    }}>
      {s1} : {s2}
    </span>
  );
}

export default function KdkCorrectionModal({
  archiveId, sessionTitle, sessionDate, isOfficial, onClose, onCorrected,
}: Props) {
  useBodyScrollLock(true);

  const [loading, setLoading] = React.useState(true);
  const [notReady, setNotReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [ctx, setCtx] = React.useState<CorrectionContext | null>(null);
  const [birthYears, setBirthYears] = React.useState<Map<string, string>>(new Map());
  const [birthReady, setBirthReady] = React.useState(true);

  const [step, setStep] = React.useState<Step>('pick');
  const [matchId, setMatchId] = React.useState<string>('');
  const [s1, setS1] = React.useState('');
  const [s2, setS2] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [done, setDone] = React.useState<string | null>(null);

  // 공식 확정 전/후 명칭만 다르다(계산·RPC·감사는 하나).
  const official = ctx ? ctx.isOfficial : isOfficial;
  const titleLabel = official ? '공식 기록 정정' : '경기 기록 정정';

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotReady(false);
    try {
      const r = await fetchCorrectionContext(archiveId);
      if (!r.ready) { setNotReady(true); return; }
      if (!r.ok) { setLoadError(correctionActionMessage({ reason: r.reason })); return; }
      setCtx(r.context);
      const ids = memberIdsForBirthYear(r.context.rawData);
      const b = await fetchMemberBirthYears(ids);
      setBirthYears(b.birthYears);
      setBirthReady(b.ready);
    } catch (err) {
      setLoadError(correctionActionMessage(err));
    } finally {
      setLoading(false);
    }
  }, [archiveId]);

  React.useEffect(() => { void load(); }, [load]);

  const options = React.useMemo<CorrectionMatchOption[]>(
    () => (ctx ? listCorrectableMatches(ctx.rawData) : []),
    [ctx],
  );
  const picked = React.useMemo(
    () => options.find(o => o.matchId === matchId) ?? null,
    [options, matchId],
  );

  const n1 = Number(s1);
  const n2 = Number(s2);
  const filled = s1.trim() !== '' && s2.trim() !== '';
  const parsed = filled && Number.isInteger(n1) && Number.isInteger(n2);

  const impact = React.useMemo<CorrectionImpact | null>(() => {
    if (!ctx || !picked || !parsed) return null;
    return computeCorrectionImpact(ctx.rawData, picked.matchId, n1, n2, birthYears);
  }, [ctx, picked, parsed, n1, n2, birthYears]);

  const canSubmit = !!impact?.ok && !!impact.nextRawData
    && reason.trim().length >= 4 && !busy;

  const submit = React.useCallback(async () => {
    if (!ctx || !picked || !impact?.nextRawData || busy) return;
    setBusy(true);
    try {
      const r = await correctKdkArchiveMatchScore({
        archiveId: ctx.archiveId,
        matchId: picked.matchId,
        score1: n1,
        score2: n2,
        reason: reason.trim(),
        expectedFingerprint: ctx.fingerprint,
        nextRawData: impact.nextRawData,
        impact,
      });
      // ⚠ 여기서 바로 onCorrected() 를 부르지 않는다 — 부모가 Archive 를 다시 읽으면서
      //   리렌더되면 이 모달이 언마운트돼 완료 화면이 사라진다. 닫을 때 재조회한다.
      setDone(`${r.beforeScore1} : ${r.beforeScore2} → ${r.afterScore1} : ${r.afterScore2}`);
    } catch (err) {
      setToast(correctionActionMessage(err));
      // 실패 뒤에는 오래된 미리보기를 들고 있지 않는다 — 전부 다시 읽는다.
      setStep('pick');
      setMatchId(''); setS1(''); setS2('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [ctx, picked, impact, busy, n1, n2, reason, load]);

  /**
   * 닫기 — 정정에 성공했다면 이때 부모가 서버에서 다시 읽는다(authoritative refetch).
   *   ⚠ 성공 직후 바로 재조회하면 부모 리렌더로 이 모달이 언마운트돼 완료 안내가 사라진다.
   */
  const finish = React.useCallback(() => {
    if (done) onCorrected();
    onClose();
  }, [done, onCorrected, onClose]);

  // ── 공통 껍데기 ───────────────────────────────────────────────────────────
  const shell = (body: React.ReactNode, footer?: React.ReactNode) => (
    <div
      role="dialog" aria-modal="true" aria-label={titleLabel}
      data-kdk-correction
      onClick={() => { if (!busy) finish(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(15,39,71,0.46)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 0,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520,
          // 작은 화면에서 bottom sheet, 넓은 화면에서 가운데 카드처럼 보이게 한다.
          maxHeight: 'min(92vh, 860px)',
          display: 'flex', flexDirection: 'column',
          background: '#FFFFFF',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -10px 40px rgba(15,39,71,0.22)',
          overflow: 'hidden',
        }}
      >
        {/* 머리 */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 16px', borderBottom: `1px solid ${LINE}`,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{
              margin: 0, fontSize: 14, fontWeight: 900, color: NAVY,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {titleLabel}
            </p>
            <p style={{
              margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: MUTED,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {sessionTitle || archiveId}{sessionDate ? ` · ${sessionDate}` : ''}
            </p>
          </div>
          <button
            type="button" aria-label="닫기" onClick={finish} disabled={busy}
            style={{
              flexShrink: 0, width: 36, height: 36, borderRadius: 999,
              border: `1px solid ${LINE}`, background: '#FFFFFF', color: MUTED,
              display: 'grid', placeItems: 'center',
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 본문 — 여기만 스크롤한다 */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          padding: '14px 16px',
        }}>
          {body}
        </div>

        {/* 바닥 CTA — 키보드가 올라와도 접근 가능하도록 sticky footer 로 둔다 */}
        {footer && (
          <div style={{
            flexShrink: 0, padding: '12px 16px',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
            borderTop: `1px solid ${LINE}`, background: '#FFFFFF',
            display: 'flex', gap: 8,
          }}>
            {footer}
          </div>
        )}
      </div>

      {toast && (
        <div role="status" style={{
          position: 'fixed', left: 16, right: 16, bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
          margin: '0 auto', maxWidth: 480, padding: '11px 14px', borderRadius: 12,
          background: NAVY, color: '#FFFFFF', fontSize: 12.5, fontWeight: 800,
          lineHeight: 1.6, textAlign: 'center', wordBreak: 'keep-all', zIndex: 1300,
        }}>
          {toast}
        </div>
      )}
    </div>
  );

  const btn = (kind: 'primary' | 'ghost' | 'danger', disabled = false): React.CSSProperties => ({
    flex: 1, minHeight: 46, borderRadius: 12, fontSize: 13.5, fontWeight: 900,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    border: kind === 'ghost' ? `1px solid ${LINE}` : 'none',
    background: kind === 'primary' ? NAVY : kind === 'danger' ? DANGER : '#FFFFFF',
    color: kind === 'ghost' ? MUTED : '#FFFFFF',
  });

  // ── 상태별 화면 ───────────────────────────────────────────────────────────

  if (loading) {
    return shell(<p style={{ margin: '28px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: MUTED }}>불러오는 중…</p>);
  }

  if (notReady) {
    return shell(
      <div style={{ padding: '18px 0' }}>
        <div style={{
          display: 'flex', gap: 10, padding: 14, borderRadius: 14,
          background: WARN_BG, border: `1px solid ${WARN_BD}`,
        }}>
          <AlertTriangle size={18} color={WARN_INK} style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: WARN_INK }}>정정 기능 준비 중</p>
            <p style={{ margin: '4px 0 0', fontSize: 11.5, fontWeight: 700, color: MUTED, lineHeight: 1.65, wordBreak: 'keep-all' }}>
              서버 준비(migration)가 끝나면 이 화면에서 경기 점수를 정정할 수 있습니다.
              기존 기록 조회와 공식 확정 기능에는 영향이 없습니다.
            </p>
          </div>
        </div>
      </div>,
      <button type="button" onClick={finish} style={btn('ghost')}>닫기</button>,
    );
  }

  if (loadError || !ctx) {
    return shell(
      <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: DANGER, wordBreak: 'keep-all' }}>
        {loadError || '기록을 불러오지 못했습니다.'}
      </p>,
      <button type="button" onClick={finish} style={btn('ghost')}>닫기</button>,
    );
  }

  if (done) {
    return shell(
      <div style={{ padding: '18px 0', textAlign: 'center' }}>
        <div style={{
          width: 52, height: 52, margin: '0 auto 12px', borderRadius: 999,
          background: '#E0F5EB', display: 'grid', placeItems: 'center',
        }}>
          <Check size={26} color={TEAL} />
        </div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: INK }}>정정이 완료되었습니다.</p>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 800, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
          {done}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 11.5, fontWeight: 700, color: FAINT, lineHeight: 1.65, wordBreak: 'keep-all' }}>
          정정 이력이 영구 기록되었습니다. 순위·정산과 프로필·랭킹·공개 결과에 즉시 반영됩니다.
        </p>
      </div>,
      <button type="button" data-correction-done onClick={finish} style={btn('primary')}>확인</button>,
    );
  }

  // ① 경기 선택
  if (step === 'pick') {
    return shell(
      <>
        <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 800, color: MUTED, lineHeight: 1.65, wordBreak: 'keep-all' }}>
          점수를 정정할 경기를 선택해 주세요. 완료된 경기만 정정할 수 있습니다.
          {ctx.correctionCount > 0 && ` 이 기록은 이미 ${ctx.correctionCount}회 정정됐습니다.`}
        </p>
        {options.length === 0 ? (
          <p style={{ margin: '18px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: FAINT }}>
            정정할 수 있는 완료 경기가 없습니다.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {options.map(o => {
              const on = o.matchId === matchId;
              return (
                <button
                  key={o.matchId}
                  type="button"
                  data-correction-match={o.matchId}
                  onClick={() => {
                    setMatchId(o.matchId);
                    setS1(String(o.score1));
                    setS2(String(o.score2));
                  }}
                  style={{
                    textAlign: 'left', width: '100%', padding: '10px 12px', borderRadius: 12,
                    border: `1px solid ${on ? TEAL : LINE}`,
                    background: on ? '#E8F7F5' : '#FFFFFF',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <span style={{
                    flexShrink: 0, minWidth: 54, fontSize: 10.5, fontWeight: 900, color: MUTED,
                    whiteSpace: 'nowrap',
                  }}>
                    {o.group ? `${o.group}조 ` : ''}R{o.round ?? '-'}
                  </span>
                  <span style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 800, color: INK, lineHeight: 1.5, wordBreak: 'keep-all' }}>
                    {teamText(o.team1Names)}
                    <span style={{ color: FAINT, fontWeight: 700 }}> vs </span>
                    {teamText(o.team2Names)}
                  </span>
                  <ScoreBadge s1={o.score1} s2={o.score2} />
                </button>
              );
            })}
          </div>
        )}
      </>,
      <>
        <button type="button" onClick={finish} style={btn('ghost')}>취소</button>
        <button
          type="button" disabled={!picked}
          onClick={() => setStep('edit')}
          style={btn('primary', !picked)}
        >
          다음
        </button>
      </>,
    );
  }

  // ② 점수 수정 + 영향 미리보기 + 사유
  if (step === 'edit' && picked) {
    const blockMsg = impact && !impact.ok ? correctionBlockMessage(impact.blocked) : '';
    const fmt = (c: { name: string; before: unknown; after: unknown }) =>
      `${c.name} ${c.before} → ${c.after}`;

    return shell(
      <>
        {/* 경기 */}
        <div style={{ padding: 12, borderRadius: 14, background: SOFT, border: `1px solid ${LINE}` }}>
          <p style={{ margin: 0, fontSize: 10.5, fontWeight: 900, color: MUTED, letterSpacing: '0.06em' }}>
            {picked.group ? `${picked.group}조 ` : ''}R{picked.round ?? '-'}
            {picked.court != null ? ` · C${picked.court}` : ''}
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 13, fontWeight: 900, color: INK, lineHeight: 1.55, wordBreak: 'keep-all' }}>
            {teamText(picked.team1Names)}
          </p>
          <p style={{ margin: '2px 0', fontSize: 10.5, fontWeight: 900, color: FAINT }}>VS</p>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: INK, lineHeight: 1.55, wordBreak: 'keep-all' }}>
            {teamText(picked.team2Names)}
          </p>
        </div>

        {/* 점수 */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 900, color: MUTED }}>
              {teamText(picked.team1Names)}
            </p>
            <input
              id="kdk-correction-score1"
              type="number" inputMode="numeric" min={0} max={99}
              value={s1} onChange={e => setS1(e.target.value)} disabled={busy}
              aria-label="팀1 점수"
              style={{
                width: '100%', height: 52, textAlign: 'center',
                border: `1px solid ${LINE}`, borderRadius: 12, background: '#FFFFFF',
                fontSize: 22, fontWeight: 900, color: INK,
              }}
            />
          </div>
          <span style={{ flexShrink: 0, paddingTop: 18, fontSize: 16, fontWeight: 900, color: FAINT }}>:</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 900, color: MUTED }}>
              {teamText(picked.team2Names)}
            </p>
            <input
              id="kdk-correction-score2"
              type="number" inputMode="numeric" min={0} max={99}
              value={s2} onChange={e => setS2(e.target.value)} disabled={busy}
              aria-label="팀2 점수"
              style={{
                width: '100%', height: 52, textAlign: 'center',
                border: `1px solid ${LINE}`, borderRadius: 12, background: '#FFFFFF',
                fontSize: 22, fontWeight: 900, color: INK,
              }}
            />
          </div>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11.5, fontWeight: 800, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
          {picked.score1} : {picked.score2} → {filled ? `${s1} : ${s2}` : '— : —'}
        </p>

        {!birthReady && (
          <div style={{
            marginTop: 10, padding: 11, borderRadius: 12,
            background: WARN_BG, border: `1px solid ${WARN_BD}`,
            fontSize: 11.5, fontWeight: 800, color: WARN_INK, lineHeight: 1.6, wordBreak: 'keep-all',
          }}>
            회원 출생연도를 불러오지 못했습니다. 동률이 생기면 공식 순위를 확정할 수 없습니다.
          </div>
        )}

        {blockMsg && (
          <div style={{
            marginTop: 10, padding: 11, borderRadius: 12,
            background: WARN_BG, border: `1px solid ${WARN_BD}`,
          }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 900, color: WARN_INK, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              {blockMsg}
            </p>
            {impact && impact.unresolvedTieBirthYears.length > 0 && (
              <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 800, color: MUTED, lineHeight: 1.6, wordBreak: 'keep-all' }}>
                확인 필요: {impact.unresolvedTieBirthYears.map(u => u.name).join(', ')}
                <br />출생연도를 입력한 뒤 다시 시도해 주세요. 임의 순위를 만들지 않습니다.
              </p>
            )}
          </div>
        )}

        {/* 영향 미리보기 — 변경 없는 항목도 전부 표시 */}
        {impact && impact.before.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 900, color: NAVY, letterSpacing: '0.08em' }}>
              변경 영향 미리보기
            </p>
            <ImpactRow label="승 / 패" items={impact.winLossChanges.map(fmt)} />
            <ImpactRow label="득점" items={impact.pointsForChanges.map(fmt)} />
            <ImpactRow label="실점" items={impact.pointsAgainstChanges.map(fmt)} />
            <ImpactRow label="득실" items={impact.diffChanges.map(fmt)} />
            <ImpactRow
              label="전체 순위"
              items={impact.rankChanges.map(c => `${c.name} ${c.before}위 → ${c.after}위`)}
            />
            <ImpactRow
              label="조별 순위"
              items={impact.groupRankChanges.map(c => `${c.name} ${c.before ?? '-'}위 → ${c.after ?? '-'}위`)}
            />
            <ImpactRow
              label="벌금"
              items={impact.moneyChanges
                .filter(c => c.before.penaltyAmount !== c.after.penaltyAmount || c.before.penaltyLevel !== c.after.penaltyLevel)
                .map(c => `${c.name} ${c.before.penaltyLevel ?? '없음'} ${won(c.before.penaltyAmount)} → ${c.after.penaltyLevel ?? '없음'} ${won(c.after.penaltyAmount)}`)}
              tone="warn"
            />
            <ImpactRow
              label="우승 상금"
              items={impact.moneyChanges
                .filter(c => c.before.prizeAmount !== c.after.prizeAmount)
                .map(c => `${c.name} ${won(c.before.prizeAmount)} → ${won(c.after.prizeAmount)}`)}
              tone="warn"
            />
            <ImpactRow
              label="게스트비"
              items={impact.moneyChanges
                .filter(c => c.before.guestFeeAmount !== c.after.guestFeeAmount)
                .map(c => `${c.name} ${won(c.before.guestFeeAmount)} → ${won(c.after.guestFeeAmount)}`)}
            />
            <ImpactRow
              label="최종 정산"
              items={impact.moneyChanges
                .filter(c => c.before.finalAmount !== c.after.finalAmount)
                .map(c => `${c.name} ${won(c.before.finalAmount)} → ${won(c.after.finalAmount)}`)}
              tone="warn"
            />
            <ImpactRow
              label="Finance"
              items={impact.moneyChanges.length === 0 ? [] : [
                '금액이 바뀌므로 이미 등록·납부된 Finance 내역과 어긋날 수 있습니다. '
                + '납부 데이터는 자동으로 수정·삭제되지 않습니다 — 벌금·상금 정산 관리에서 직접 확인해 주세요.',
              ]}
              tone="warn"
            />
            {impact.match?.winnerChanged && (
              <div style={{
                marginTop: 10, padding: 11, borderRadius: 12,
                background: '#FDECEA', border: `1px solid #F5B7B1`,
                fontSize: 12, fontWeight: 900, color: DANGER, lineHeight: 1.6, wordBreak: 'keep-all',
              }}>
                승자가 바뀝니다. 현장 기록을 다시 확인한 뒤 진행해 주세요.
              </div>
            )}
          </div>
        )}

        {/* 사유 */}
        <div style={{ marginTop: 14 }}>
          <label htmlFor="kdk-correction-reason" style={{
            display: 'block', marginBottom: 5, fontSize: 11, fontWeight: 900, color: NAVY, letterSpacing: '0.06em',
          }}>
            정정 사유 (필수 · 4자 이상)
          </label>
          <input
            id="kdk-correction-reason"
            type="text" value={reason} onChange={e => setReason(e.target.value)}
            disabled={busy} maxLength={300}
            placeholder="예: 현장 점수 입력 오류 확인"
            style={{
              width: '100%', minHeight: 46, padding: '10px 12px',
              border: `1px solid ${reason.trim().length > 0 && reason.trim().length < 4 ? WARN_BD : LINE}`,
              borderRadius: 12, background: '#FFFFFF', fontSize: 13, fontWeight: 700, color: INK,
            }}
          />
          {reason.trim().length > 0 && reason.trim().length < 4 && (
            <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 800, color: WARN_INK }}>
              4자 이상 입력해 주세요.
            </p>
          )}
        </div>
      </>,
      <>
        <button type="button" onClick={() => setStep('pick')} disabled={busy} style={btn('ghost', busy)}>
          이전
        </button>
        <button
          type="button" disabled={!canSubmit}
          onClick={() => setStep('confirm')}
          style={btn('primary', !canSubmit)}
        >
          정정 확정
          <ChevronRight size={14} style={{ marginLeft: 2, verticalAlign: 'middle' }} />
        </button>
      </>,
    );
  }

  // ③ 최종 확인
  if (step === 'confirm' && picked && impact) {
    return shell(
      <>
        <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 900, color: INK, lineHeight: 1.6, wordBreak: 'keep-all' }}>
          {official ? '공식 기록을 정정합니다.' : '경기 기록을 정정합니다.'}
        </p>

        <div style={{ padding: 13, borderRadius: 14, background: SOFT, border: `1px solid ${LINE}` }}>
          <p style={{ margin: 0, fontSize: 10.5, fontWeight: 900, color: MUTED }}>
            {picked.group ? `${picked.group}조 ` : ''}R{picked.round ?? '-'}
            {picked.court != null ? ` · C${picked.court}` : ''}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 900, color: INK, lineHeight: 1.55, wordBreak: 'keep-all' }}>
            {teamText(picked.team1Names)}
          </p>
          <p style={{ margin: '2px 0', fontSize: 10.5, fontWeight: 900, color: FAINT }}>VS</p>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: INK, lineHeight: 1.55, wordBreak: 'keep-all' }}>
            {teamText(picked.team2Names)}
          </p>
          <p style={{
            margin: '10px 0 0', fontSize: 19, fontWeight: 900, color: NAVY,
            fontVariantNumeric: 'tabular-nums', textAlign: 'center',
          }}>
            {picked.score1} : {picked.score2} <span style={{ color: FAINT }}>→</span> {n1} : {n2}
          </p>
        </div>

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: INK }}>
            전체 순위 {impact.rankChanges.length === 0 ? '변경 없음' : `${impact.rankChanges.length}건 변경`}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: INK }}>
            득실 {impact.diffChanges.length === 0 ? '변경 없음' : `${impact.diffChanges.length}명 변경`}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: INK }}>
            승/패 {impact.winLossChanges.length === 0 ? '변경 없음' : `${impact.winLossChanges.length}명 변경`}
          </p>
          <p style={{
            margin: 0, fontSize: 12.5, fontWeight: 800,
            color: impact.moneyChanges.length === 0 ? INK : WARN_INK,
          }}>
            금액 {impact.moneyChanges.length === 0 ? '변경 없음' : `${impact.moneyChanges.length}명 변경`}
          </p>
        </div>

        <div style={{
          marginTop: 12, padding: 11, borderRadius: 12,
          background: SOFT, border: `1px solid ${LINE}`,
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 900, color: MUTED }}>정정 사유</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 800, color: INK, lineHeight: 1.6, wordBreak: 'break-word' }}>
            {reason.trim()}
          </p>
        </div>

        <p style={{ margin: '12px 0 0', fontSize: 11.5, fontWeight: 700, color: MUTED, lineHeight: 1.7, wordBreak: 'keep-all' }}>
          정정 이력이 영구 기록되며, Archive 상세 · 프로필 공식 기록 · Club Ranking ·
          상대/파트너 전적 · Guest Pass 결과에 즉시 반영됩니다.
          Finance 납부 데이터는 자동으로 변경되지 않습니다.
        </p>
      </>,
      <>
        <button type="button" onClick={() => setStep('edit')} disabled={busy} style={btn('ghost', busy)}>
          돌아가기
        </button>
        <button
          type="button" data-correction-submit disabled={!canSubmit}
          onClick={() => { void submit(); }}
          style={btn('primary', !canSubmit)}
        >
          {busy ? '정정 중…' : '정정 확정'}
        </button>
      </>,
    );
  }

  // 방어 — 선택이 사라진 경우 처음으로 되돌린다.
  return shell(
    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: MUTED }}>
      경기를 다시 선택해 주세요.
    </p>,
    <button type="button" onClick={() => { setStep('pick'); setMatchId(''); }} style={btn('primary')}>
      경기 선택
    </button>,
  );
}
