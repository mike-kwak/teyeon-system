'use client';

// 엑셀 붙여넣기 → 예선 조편성 일괄 반영 (Batch 2B-2).
//
//   ⚠⚠ 시스템이 조편성을 만들지 않는다. 경기이사가 엑셀에서 완성한 결과를
//     빠르게 시스템에 옮겨 담는 입력 도구다.
//   ⚠ 붙여넣는 즉시 저장하지 않는다. 반드시 미리보기를 거친다.
//   ⚠ 전체가 유효할 때만 반영한다. 부분 저장이 없다.
//   ⚠ 매칭은 완전 일치만 인정한다. 애매하면 AMBIGUOUS 로 두고 운영자가 고른다.

import React from 'react';
import { ClipboardPaste, Eye, Check, AlertTriangle, HelpCircle, Upload } from 'lucide-react';
import { replaceGroupAssignments, drawActionMessage } from '@/lib/tournaments/drawAdminService';
import {
  buildPastePreview, PASTE_BLOCKER_LABEL,
  type MatchableTeam, type PastePreview,
} from '@/lib/tournaments/groupPasteParser';

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 15, marginBottom: 10,
};
const label: React.CSSProperties = {
  margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8',
};
const btn = (tone: 'primary' | 'plain' | 'ghost' = 'plain'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 34, padding: '7px 12px', borderRadius: 8,
  border: `1px solid ${tone === 'primary' ? '#0E8C80' : '#E2E8F0'}`,
  background: tone === 'primary' ? '#0E8C80' : tone === 'ghost' ? 'transparent' : '#fff',
  color: tone === 'primary' ? '#fff' : '#475569',
  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
});

const SAMPLE = `1조\t12
1조\t18
1조\t25
2조\t김민수\t이정훈
2조\t박준호/최성민
\t이재현/김태호
순위결정전\t49
순위결정전\t50`;

interface Props {
  slug: string;
  /** 매칭 대상 — 배정/미배정 구분 없이 대회의 모든 팀. */
  teams: MatchableTeam[];
  version: number | null;
  locked: boolean;
  /** 현재 저장된 배정 수. 0 보다 크면 전체 교체 확인을 받는다. */
  assignedCount: number;
  onApplied: (msg: string) => void;
  onError: (msg: string) => void;
  /** 반영 후 부모가 full refetch 한다. */
  reload: () => Promise<void>;
}

export default function GroupPasteImport({
  slug, teams, version, locked, assignedCount, onApplied, onError, reload,
}: Props) {
  const [text, setText] = React.useState('');
  const [preview, setPreview] = React.useState<PastePreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [help, setHelp] = React.useState(false);

  // 입력이 바뀌면 이전 미리보기는 무효다(낡은 payload 로 반영되는 사고 방지).
  const onText = (v: string) => { setText(v); if (preview) setPreview(null); };

  const doPreview = () => {
    if (text.trim() === '') { onError('붙여넣은 내용이 없습니다.'); return; }
    setPreview(buildPastePreview(text, teams));
  };

  const doApply = async () => {
    if (!preview?.canApply || !preview.payload || version === null || busy) return;
    if (assignedCount > 0) {
      const ok = window.confirm(
        `현재 조편성 ${assignedCount}팀이 이미 저장되어 있습니다.\n` +
        '붙여넣은 조편성으로 전체 교체하시겠습니까?\n\n' +
        '기존 배정은 모두 지워지고, 붙여넣기에 없는 조도 제거됩니다.',
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await replaceGroupAssignments(slug, preview.payload, version);
      setText('');
      setPreview(null);
      await reload();
      onApplied(
        `조편성을 반영했습니다 — ${r.assignedTeams}팀 배정` +
        (r.createdGroups > 0 ? ` · 조 ${r.createdGroups}개 생성` : '') +
        (r.removedGroups > 0 ? ` · 빈 조 ${r.removedGroups}개 정리` : ''),
      );
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      if (reason === 'version_conflict') {
        onError('다른 운영자가 조편성을 변경했습니다. 최신 상태를 불러온 뒤 다시 미리보기 해주세요.');
        setPreview(null);
        await reload();
      } else {
        onError(drawActionMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (locked) {
    return (
      <div style={{ ...card, background: '#F8FAFC', display: 'flex', gap: 9 }}>
        <AlertTriangle size={16} color="#94A3B8" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#475569', lineHeight: 1.7 }}>
          조편성이 확정(잠금)되어 있어 붙여넣기 반영을 할 수 없습니다.
          수정하려면 아래에서 잠금을 해제해 주세요.
        </p>
      </div>
    );
  }

  const s = preview?.summary;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p style={{ ...label, display: 'flex', alignItems: 'center', gap: 5 }}>
          <ClipboardPaste size={12} strokeWidth={2.6} color="#0E8C80" />
          엑셀에서 붙여넣기
        </p>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setHelp((v) => !v)} style={{ ...btn('ghost'), minHeight: 28 }}>
          <HelpCircle size={12} strokeWidth={2.4} />
          형식 도움말
        </button>
      </div>

      {help && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#0F172A', lineHeight: 1.8, wordBreak: 'keep-all' }}>
            엑셀/구글시트에서 <strong>조 열 + 팀 열</strong>을 복사해 그대로 붙여넣으세요.
          </p>
          <ul style={{ margin: '7px 0 0', paddingLeft: 17, fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.9 }}>
            <li><strong>팀 번호</strong>가 있으면 가장 정확합니다 (<code>1조 ⇥ 12</code>)</li>
            <li>선수 이름은 두 명 모두 필요합니다 (<code>1조 ⇥ 김민수 ⇥ 이정훈</code> 또는 <code>김민수/이정훈</code>)</li>
            <li>조 칸이 비어 있으면 <strong>바로 위 조</strong>를 이어받습니다</li>
            <li>순위결정전은 <code>순위결정전</code> / <code>순위결정</code> / <code>placement</code> 로 적습니다</li>
            <li>머리글 행(<code>조 ⇥ 선수1 ⇥ 선수2</code>)은 <strong>빼고</strong> 붙여넣어 주세요</li>
          </ul>
          <pre style={{
            margin: '9px 0 0', padding: 10, borderRadius: 8, background: '#0F172A', color: '#E2E8F0',
            fontSize: 11.5, lineHeight: 1.7, overflowX: 'auto',
          }}>{SAMPLE}</pre>
          <button
            type="button"
            onClick={() => { onText(SAMPLE); setHelp(false); }}
            style={{ ...btn(), marginTop: 8, minHeight: 28, fontSize: 11.5 }}
          >
            예시 넣어보기
          </button>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder={'여기에 붙여넣기 (Ctrl+V)\n\n1조\t12\n1조\t18\n1조\t25\n2조\t김민수\t이정훈'}
        rows={8}
        spellCheck={false}
        style={{
          width: '100%', boxSizing: 'border-box', marginTop: 10, padding: '10px 11px',
          borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5, lineHeight: 1.7, color: '#0F172A', resize: 'vertical',
          whiteSpace: 'pre', overflowX: 'auto',
        }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
        <button type="button" onClick={doPreview} disabled={busy || text.trim() === ''}
                style={{ ...btn('primary'), opacity: text.trim() === '' ? 0.5 : 1 }}>
          <Eye size={13} strokeWidth={2.4} />
          미리보기
        </button>
        {text !== '' && (
          <button type="button" onClick={() => { setText(''); setPreview(null); }} disabled={busy} style={btn()}>
            지우기
          </button>
        )}
      </div>

      {/* ── 미리보기 ─────────────────────────────────────────────────────── */}
      {preview && (
        <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid #F1F5F9' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: 7 }}>
            {[
              ['입력 행', s!.inputRows, '#0F172A'],
              ['매칭', s!.matched, '#047857'],
              ['미매칭', s!.unmatched, s!.unmatched ? '#B91C1C' : '#94A3B8'],
              ['애매', s!.ambiguous, s!.ambiguous ? '#B45309' : '#94A3B8'],
              ['중복', s!.duplicates, s!.duplicates ? '#B91C1C' : '#94A3B8'],
              ['일반 조', s!.preliminaryGroups, '#0F172A'],
              ['순위결정전', s!.placementGroups, s!.placementGroups ? '#7C3AED' : '#94A3B8'],
            ].map(([k, v, c]) => (
              <div key={k as string} style={{ padding: '8px 9px', borderRadius: 9, background: '#F8FAFC' }}>
                <p style={{ ...label, fontSize: 9.5 }}>{k}</p>
                <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 900, color: c as string }}>{v}</p>
              </div>
            ))}
          </div>

          {/* 차단 사유 */}
          {preview.blockers.length > 0 && (
            <div style={{ marginTop: 11, padding: 12, borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA' }}>
              {preview.blockers.map((b, i) => (
                <div key={`${b.code}-${i}`} style={{ marginTop: i === 0 ? 0 : 9 }}>
                  <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: '#B91C1C' }}>
                    <AlertTriangle size={13} strokeWidth={2.6} />
                    {PASTE_BLOCKER_LABEL[b.code]}
                  </p>
                  {b.detail.slice(0, 12).map((d, j) => (
                    <p key={j} style={{ margin: '3px 0 0 19px', fontSize: 11.5, fontWeight: 600, color: '#475569', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                      · {d}
                    </p>
                  ))}
                  {b.detail.length > 12 && (
                    <p style={{ margin: '3px 0 0 19px', fontSize: 11.5, fontWeight: 700, color: '#94A3B8' }}>
                      외 {b.detail.length - 12}건
                    </p>
                  )}
                </div>
              ))}
              <p style={{ margin: '10px 0 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                문제를 표시만 합니다. 시스템이 팀을 고르거나 자동으로 고치지 않습니다.
                엑셀에서 수정한 뒤 다시 붙여넣어 주세요.
              </p>
            </div>
          )}

          {/* 조별 미리보기 */}
          <div className="tg-preview" style={{ marginTop: 11 }}>
            {preview.groups.map((g) => {
              const okSize = g.rows.length === g.expectedSize;
              const isPlace = g.kind === 'placement';
              return (
                <div
                  key={g.key}
                  style={{
                    padding: 11, borderRadius: 10, background: '#fff',
                    border: `1px solid ${isPlace ? '#DDD6FE' : '#E2E8F0'}`,
                    borderLeft: `3px solid ${isPlace ? '#7C3AED' : okSize ? '#047857' : '#F59E0B'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                      {isPlace ? '순위결정전' : `${g.groupNo}조`}
                    </p>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: okSize ? '#047857' : '#B45309' }}>
                      {g.rows.length} / {g.expectedSize}
                    </span>
                  </div>
                  <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {g.rows.map((r) => (
                      <p
                        key={`${r.lineNo}`}
                        style={{
                          margin: 0, display: 'flex', alignItems: 'flex-start', gap: 5,
                          fontSize: 12, fontWeight: 600, lineHeight: 1.55, wordBreak: 'keep-all',
                          color: r.status === 'matched' ? '#334155' : '#B91C1C',
                        }}
                      >
                        {r.status === 'matched'
                          ? <Check size={12} strokeWidth={3} color="#047857" style={{ flexShrink: 0, marginTop: 2 }} />
                          : <AlertTriangle size={12} strokeWidth={2.6} style={{ flexShrink: 0, marginTop: 2 }} />}
                        <span>
                          {r.status === 'matched'
                            ? <><strong>{r.teamNo}번</strong> {teams.find((t) => t.teamId === r.teamId)
                                ? `${teams.find((t) => t.teamId === r.teamId)!.player1Name} · ${teams.find((t) => t.teamId === r.teamId)!.player2Name}`
                                : ''}</>
                            : <>{r.lineNo}행 — {r.note}
                                {r.candidates.length > 0 && (
                                  <span style={{ color: '#64748B', fontWeight: 600 }}>
                                    {' '}(후보: {r.candidates.map((c) => `${c.teamNo}번`).join(', ')})
                                  </span>
                                )}
                              </>}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void doApply()}
            disabled={!preview.canApply || busy || version === null}
            style={{
              ...btn('primary'), width: '100%', minHeight: 42, marginTop: 12,
              opacity: preview.canApply ? 1 : 0.45,
              cursor: preview.canApply ? 'pointer' : 'not-allowed',
            }}
          >
            <Upload size={14} strokeWidth={2.5} />
            {busy ? '반영 중…' : '조편성 반영'}
          </button>
          {!preview.canApply && (
            <p style={{ margin: '7px 0 0', fontSize: 11.5, fontWeight: 700, color: '#94A3B8', textAlign: 'center' }}>
              위 문제를 모두 해결해야 반영할 수 있습니다. 일부만 저장하지 않습니다.
            </p>
          )}
        </div>
      )}

      <style>{`
        .tg-preview { display: grid; grid-template-columns: 1fr; gap: 8px; }
        @media (min-width: 760px) {
          .tg-preview { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
        }
      `}</style>
    </div>
  );
}
