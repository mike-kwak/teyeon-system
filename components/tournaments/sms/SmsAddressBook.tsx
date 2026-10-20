'use client';

// 문자 안내 센터 — 참가자 주소록(검토 · 제외 · 확인 필요 포함 · 주소록 확정 · CSV).
//   ⚠ 번호는 기본으로 가린다(010-****-1234). '전체 번호 보기'는 이 화면 안에서만, 새로고침하면 다시 가린다.
//   ⚠ 원본 번호를 고치지 않는다 — 수정은 기존 '신청 현황' 화면에서 한다.

import React from 'react';
import Link from 'next/link';
import { Download, Eye, EyeOff, Lock, RefreshCw, Search, Users } from 'lucide-react';
import {
  PARTICIPATION_LABEL, PHONE_CHECK_LABEL, entryLabel, maskKrMobile,
  type AddressBook, type ContactEntry, type RecipientResult, type RecipientState, type SnapshotDiff, type Snapshot,
} from '@/lib/tournaments/smsModel';
import {
  AMBER, BODY, Chip, FAINT, INK, LINE, LINE_SOFT, MUTED, Notice, RED, SectionHead, TEAL, TEAL_DEEP, btn, btnSmall, card, fmtTime, input,
} from './smsUi';

type RowFilter = 'all' | 'included' | 'out' | 'review' | 'shared' | 'changed';

const STATE_CHIP: Record<RecipientState | 'scope', { label: string; tone: 'teal' | 'neutral' | 'amber' | 'red' }> = {
  included: { label: '발송 대상', tone: 'teal' },
  duplicate: { label: '중복 제외', tone: 'neutral' },
  excluded: { label: '관리자 제외', tone: 'neutral' },
  error: { label: '오류 제외', tone: 'red' },
  review: { label: '확인 필요', tone: 'amber' },
  scope: { label: '대상 아님', tone: 'neutral' },
};

export default function SmsAddressBook({
  slug, book, result, diff, snapshot, revealed, maskForced, excludedKeys, reviewIncludedKeys,
  onReveal, onToggleExclude, onToggleReview, onSaveSnapshot, onClearSnapshot, snapshotBusy, exclusionsDirty, onCsv, csvDisabledReason,
}: {
  slug: string;
  book: AddressBook;
  result: RecipientResult;
  diff: SnapshotDiff | null;
  snapshot: Snapshot | null;
  revealed: boolean;
  maskForced: boolean;
  excludedKeys: string[];
  reviewIncludedKeys: string[];
  onReveal: (v: boolean) => void;
  onToggleExclude: (key: string) => void;
  onToggleReview: (key: string) => void;
  onSaveSnapshot: () => void;
  onClearSnapshot: () => void;
  snapshotBusy: boolean;
  exclusionsDirty: boolean;
  onCsv: () => void;
  csvDisabledReason: string | null;
}) {
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState<RowFilter>('all');
  const [openShared, setOpenShared] = React.useState<string | null>(null);
  const stateByKey = React.useMemo(() => new Map(result.rows.map((r) => [r.entry.key, r])), [result]);
  const ex = React.useMemo(() => new Set(excludedKeys), [excludedKeys]);
  const revInc = React.useMemo(() => new Set(reviewIncludedKeys), [reviewIncludedKeys]);
  const showFull = revealed && !maskForced;

  const list = book.entries.filter((e) => {
    const st = stateByKey.get(e.key)?.state;
    if (filter === 'included' && st !== 'included') return false;
    if (filter === 'out' && !(st === 'excluded' || st === 'error' || st === 'duplicate')) return false;
    if (filter === 'review' && e.phone.check !== 'review') return false;
    if (filter === 'shared' && e.sharedWith.length === 0) return false;
    if (filter === 'changed' && !(diff && diff.byKey.get(e.key) && diff.byKey.get(e.key) !== 'same')) return false;
    const s = q.trim();
    if (!s) return true;
    const digits = s.replace(/[^0-9]/g, '');
    return e.name.includes(s) || e.registrationNo.toLowerCase().includes(s.toLowerCase())
      || (e.teamNo != null && String(e.teamNo) === s)
      || (digits.length >= 4 && e.phone.digits.endsWith(digits));
  });

  const counts = book.checkCounts;
  const changedCount = diff ? diff.changed.length + diff.added.length : 0;

  return (
    <section id="sms-book" data-sms-section="book" style={{ scrollMarginTop: 80 }}>
      <SectionHead no="01" en="CONTACTS" title="참가자 주소록"
        desc="참가 신청 원본(선수 1 · 선수 2)을 읽어 만든 발송 후보입니다. 원본은 바뀌지 않습니다. 번호 수정은 ‘신청 현황’ 화면에서 합니다."
        right={(
          <>
            <button type="button" style={btnSmall} data-sms-action="reveal" disabled={maskForced}
              onClick={() => onReveal(!revealed)} title={maskForced ? '촬영 모드에서는 번호를 가립니다' : undefined}>
              {showFull ? <EyeOff size={15} /> : <Eye size={15} />}{showFull ? '번호 가리기' : '전체 번호 보기'}
            </button>
            <button type="button" style={btnSmall} data-sms-action="csv" onClick={onCsv} disabled={!!csvDisabledReason}
              title={csvDisabledReason ?? undefined}>
              <Download size={15} />CSV 다운로드
            </button>
          </>
        )} />

      {/* 연락처 검증 현황 */}
      <div className="sms-stats" data-sms-stats style={{ marginBottom: 10 }}>
        {[
          { k: 'regs', label: '참가 신청', v: `${book.registrations}팀`, sub: `확정 ${book.statusCounts.confirmed} · 접수 ${book.statusCounts.applied} · 대기 ${book.statusCounts.waitlisted}` },
          { k: 'people', label: '연락처 후보', v: `${book.entries.length}명`, sub: '팀마다 선수 2명' },
          { k: 'ok', label: '정상 번호', v: `${counts.ok}`, sub: `확인 필요 ${counts.review}` },
          { k: 'bad', label: '오류 · 빈 번호', v: `${counts.invalid + counts.empty + counts.temporary}`, sub: `형식 ${counts.invalid} · 빈 ${counts.empty} · 임시 ${counts.temporary}`, warn: counts.invalid + counts.empty + counts.temporary > 0 },
          { k: 'shared', label: '같은 번호 공유', v: `${book.sharedGroups}묶음`, sub: book.sharedEntries ? `${book.sharedEntries}명 관련` : '없음', warn: book.sharedGroups > 0 },
        ].map((s) => (
          <div key={s.k} data-sms-stat={s.k} style={{ ...card, padding: '10px 12px' }}>
            <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, color: MUTED }}>{s.label}</p>
            <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 900, color: s.warn ? AMBER : INK, fontVariantNumeric: 'tabular-nums' }}>{s.v}</p>
            <p style={{ margin: '1px 0 0', fontSize: 11, fontWeight: 700, color: FAINT, wordBreak: 'keep-all' }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* 주소록 확정(스냅샷) */}
      <div data-sms-snapshot={snapshot ? (diff?.hasChanges ? 'changed' : 'saved') : 'none'} style={{ marginBottom: 10 }}>
        {!snapshot ? (
          <Notice tone="info">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 240px' }}>
                <b>주소록 미확정</b> — 지금 목록은 참가 신청 원본 기준입니다. 검토를 마치면 확정해 두세요. 확정 후 원본이 바뀌면 이 화면이 알려 줍니다.
                관리자 제외 설정도 확정할 때 함께 저장됩니다.
              </span>
              <button type="button" style={{ ...btnSmall, borderColor: TEAL, color: TEAL_DEEP }} disabled={snapshotBusy}
                data-sms-action="snapshot-save" onClick={onSaveSnapshot}><Lock size={14} />주소록 확정</button>
            </div>
          </Notice>
        ) : (
          <Notice tone={diff?.hasChanges || exclusionsDirty ? 'warn' : 'ok'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 240px' }}>
                <b>주소록 확정됨</b> · {fmtTime(snapshot.createdAt)}{snapshot.createdByName ? ` · ${snapshot.createdByName}` : ''} · 확정 당시 발송 대상 {snapshot.recipientCount}명
                {diff?.hasChanges && (
                  <><br /><b data-sms-snapshot-changes>확정 후 원본 변경 {diff.changed.length + diff.added.length + diff.removed}건</b>
                    {' '}(번호 변경 {diff.changed.length} · 새 참가자 {diff.added.length} · 빠진 참가자 {diff.removed}) — 목록에서 ‘변경’ 표시를 확인한 뒤 다시 확정해 주세요.</>
                )}
                {exclusionsDirty && <><br /><b data-sms-exclusions-dirty>확정 이후 바꾼 제외 설정이 아직 저장되지 않았습니다.</b></>}
              </span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={btnSmall} disabled={snapshotBusy} data-sms-action="snapshot-save" onClick={onSaveSnapshot}>
                  <RefreshCw size={14} />다시 확정
                </button>
                <button type="button" style={btnSmall} disabled={snapshotBusy} data-sms-action="snapshot-clear" onClick={onClearSnapshot}>확정 해제</button>
              </span>
            </div>
          </Notice>
        )}
      </div>

      {/* 검색 · 필터 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <label style={{ ...input, display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 220px', padding: '0 10px' }}>
          <Search size={16} color={MUTED} style={{ flexShrink: 0 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 팀 번호 · 신청번호 · 번호 끝 4자리"
            data-sms-search aria-label="주소록 검색" autoComplete="off"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontSize: 15, fontFamily: 'inherit', background: 'transparent', color: INK }} />
        </label>
      </div>
      <div role="tablist" aria-label="주소록 필터" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {([
          ['all', `전체 ${book.entries.length}`],
          ['included', `발송 대상 ${result.counts.final}`],
          ['out', `제외 · 오류 · 중복 ${result.counts.manualExcluded + result.counts.errorRemoved + result.counts.duplicateRemoved}`],
          ['review', `확인 필요 ${counts.review}`],
          ['shared', `같은 번호 ${book.sharedEntries}`],
          ...(diff ? [['changed', `확정 후 변경 ${changedCount}`]] : []),
        ] as [RowFilter, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} data-sms-filter={k} onClick={() => setFilter(k)}
            style={{ ...btnSmall, minHeight: 34, borderColor: filter === k ? INK : LINE, background: filter === k ? INK : '#fff', color: filter === k ? '#fff' : BODY }}>
            {label}
          </button>
        ))}
      </div>

      {book.entries.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '26px 16px' }} data-sms-empty>
          <Users size={22} color={FAINT} />
          <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 800, color: INK }}>참가 신청이 아직 없습니다.</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: MUTED }}>
            신청이 들어오면 이곳에 선수별 연락처가 표시됩니다. <Link href={`/admin/tournaments/${slug}/registrations`} style={{ color: TEAL_DEEP }}>신청 현황</Link>
          </p>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div className="sms-row sms-row-head" aria-hidden>
            <span>#</span><span>팀 · 신청</span><span>선수</span><span>전화번호</span><span>참가</span><span>번호</span><span>발송</span>
          </div>
          {list.length === 0 && <p style={{ margin: 0, padding: '18px 14px', fontSize: 13, fontWeight: 700, color: MUTED, textAlign: 'center' }}>조건에 맞는 참가자가 없습니다.</p>}
          {list.map((e) => (
            <ContactRow key={e.key} e={e} book={book} st={stateByKey.get(e.key)?.state ?? 'scope'} dupOf={stateByKey.get(e.key)?.dupOf ?? null}
              change={diff?.byKey.get(e.key) ?? null} showFull={showFull} excluded={ex.has(e.key)} reviewIncluded={revInc.has(e.key)}
              openShared={openShared === e.key} onShared={() => setOpenShared(openShared === e.key ? null : e.key)}
              onToggleExclude={() => onToggleExclude(e.key)} onToggleReview={() => onToggleReview(e.key)} />
          ))}
        </div>
      )}
      <p style={{ margin: '8px 2px 0', fontSize: 11.5, fontWeight: 600, color: FAINT, lineHeight: 1.6, wordBreak: 'keep-all' }}>
        ‘발송’ 표시는 아래 ‘발송 준비’에서 고른 대상 기준입니다. 같은 번호는 한 번만 보냅니다. 확인 필요 번호는 기본으로 보내지 않으며, 직접 확인한 뒤 포함할 수 있습니다.
      </p>
    </section>
  );
}

function ContactRow({ e, book, st, dupOf, change, showFull, excluded, reviewIncluded, openShared, onShared, onToggleExclude, onToggleReview }: {
  e: ContactEntry; book: AddressBook; st: RecipientState | 'scope'; dupOf: string | null; change: 'same' | 'changed' | 'new' | null;
  showFull: boolean; excluded: boolean; reviewIncluded: boolean; openShared: boolean;
  onShared: () => void; onToggleExclude: () => void; onToggleReview: () => void;
}) {
  const chip = STATE_CHIP[st];
  const phoneText = e.phone.digits ? (showFull ? e.phone.display : maskKrMobile(e.phone.display))
    : e.phone.check === 'empty' ? '(빈 번호)' : (showFull ? e.phone.display : maskKrMobile(e.phone.display) || '(형식 오류)');
  const checkTone = e.phone.check === 'ok' ? 'teal' : e.phone.check === 'review' ? 'amber' : 'red';
  const muted = e.participation !== 'confirmed';
  return (
    <div className="sms-row" data-sms-row={e.key} data-sms-state={st} data-sms-check={e.phone.check}>
      <span className="sms-c-no" style={{ color: FAINT, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{e.order}</span>
      <span className="sms-c-team" style={{ color: MUTED, fontWeight: 800, fontSize: 12.5 }}>
        {e.teamNo != null ? `${e.teamNo}번 팀` : (e.registrationNo || `신청 ${e.sequenceNo}`)}
      </span>
      <span className="sms-c-name" style={{ minWidth: 0 }}>
        <span style={{ fontSize: 14.5, fontWeight: 800, color: muted ? MUTED : INK, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{e.name || '(이름 없음)'}</span>
        <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: FAINT, whiteSpace: 'nowrap' }}>선수 {e.slot}</span>
        <span className="sms-m-only" style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: FAINT, whiteSpace: 'nowrap' }}>
          · {e.teamNo != null ? `${e.teamNo}번 팀` : (e.registrationNo || `신청 ${e.sequenceNo}`)}
        </span>
        {change && change !== 'same' && <span style={{ marginLeft: 6 }}><Chip tone="amber">{change === 'new' ? '새 참가자' : '번호 변경'}</Chip></span>}
      </span>
      <span className="sms-c-phone" data-sms-phone style={{ fontSize: 14, fontWeight: 800, color: e.phone.digits ? BODY : RED, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {phoneText}
      </span>
      <span className="sms-c-part"><Chip tone={e.participation === 'confirmed' ? 'navy' : 'neutral'}>{PARTICIPATION_LABEL[e.participation]}</Chip></span>
      <span className="sms-c-check" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <span className="sms-m-only"><Chip tone={e.participation === 'confirmed' ? 'navy' : 'neutral'}>{PARTICIPATION_LABEL[e.participation]}</Chip></span>
        <Chip tone={checkTone} title={e.phone.reason ?? undefined}>{PHONE_CHECK_LABEL[e.phone.check]}{e.phone.reason && e.phone.check === 'review' ? ` · ${e.phone.reason}` : ''}</Chip>
        {e.sharedWith.length > 0 && (
          <button type="button" onClick={onShared} data-sms-shared={e.key} aria-expanded={openShared}
            style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer' }}>
            <Chip tone="amber">같은 번호 {e.sharedWith.length + 1}명</Chip>
          </button>
        )}
      </span>
      <span className="sms-c-send" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Chip tone={chip.tone}>{chip.label}</Chip>
        {e.phone.check === 'review' && !excluded && (
          <button type="button" style={{ ...btnSmall, minHeight: 32, padding: '0 9px', fontSize: 12 }} data-sms-review-toggle={e.key} onClick={onToggleReview}>
            {reviewIncluded ? '포함 취소' : '확인 후 포함'}
          </button>
        )}
        {(e.phone.digits || excluded) && (
          <button type="button" style={{ ...btnSmall, minHeight: 32, padding: '0 9px', fontSize: 12, color: excluded ? TEAL_DEEP : BODY }}
            data-sms-exclude-toggle={e.key} onClick={onToggleExclude}>
            {excluded ? '다시 포함' : '제외'}
          </button>
        )}
      </span>
      {openShared && (
        <div className="sms-c-shared" data-sms-shared-list={e.key} style={{ gridColumn: '1 / -1', background: LINE_SOFT, borderRadius: 9, padding: '8px 10px', fontSize: 12.5, fontWeight: 700, color: BODY, lineHeight: 1.7 }}>
          이 번호를 함께 쓰는 참가자: {[e.key, ...e.sharedWith].map((k) => book.byKey.get(k)).filter(Boolean).map((x) => entryLabel(x as ContactEntry)).join(' / ')}
          {dupOf && <><br />발송은 한 번만 합니다(먼저 나온 {entryLabel(book.byKey.get(dupOf) as ContactEntry)}로 보냄).</>}
        </div>
      )}
    </div>
  );
}

export const ADDRESS_BOOK_CSS = `
  .sms-row { display: grid; grid-template-columns: 30px minmax(0, 1fr); grid-template-areas: "no name" "no phone" "no meta" "no send";
    column-gap: 8px; row-gap: 5px; align-items: center; padding: 11px 12px; border-top: 1px solid ${LINE_SOFT}; font-size: 13px; }
  .sms-row > .sms-c-send { justify-content: flex-start !important; }
  .sms-row-head { display: none; }
  .sms-c-no { grid-area: no; align-self: start; padding-top: 2px; }
  .sms-c-name { grid-area: name; }
  .sms-c-phone { grid-area: phone; }
  .sms-c-send { grid-area: send; align-self: start; }
  .sms-c-team, .sms-c-part, .sms-c-check { grid-area: meta; }
  .sms-row > .sms-c-team { display: none; }
  .sms-row > .sms-c-part { display: none; }
  .sms-c-check { display: flex; }
  @media (min-width: 860px) {
    .sms-row { grid-template-columns: 40px 90px minmax(150px, 1.4fr) 140px 96px minmax(130px, 1fr) minmax(170px, auto);
      grid-template-areas: none; row-gap: 0; }
    .sms-row > * { grid-area: auto !important; }
    .sms-row > .sms-c-send { justify-content: flex-end !important; }
    .sms-row > .sms-c-team, .sms-row > .sms-c-part { display: block; }
    .sms-m-only { display: none !important; }
    .sms-row-head { display: grid; padding: 9px 12px; border-top: 0; background: #F8FAFC; font-size: 11.5px; font-weight: 800; color: ${MUTED}; }
  }
  .sms-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  @media (min-width: 720px) { .sms-stats { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
`;
