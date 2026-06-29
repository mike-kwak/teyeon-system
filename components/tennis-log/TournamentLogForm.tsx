'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Lock, Plus, Trash2, Check, X } from 'lucide-react';
import { useTennisLogAccess } from '@/hooks/useTennisLogAccess';
import {
  EVENT_TYPE_OPTIONS,
  PARTICIPATION_CATEGORY_OPTIONS,
  PARTICIPATION_CATEGORY_CUSTOM_VALUE,
  FINAL_RESULT_OPTIONS,
  FINAL_RESULT_DETAIL_TRIGGER,
  MATCH_OUTCOME_OPTIONS,
  isPartnerRequired,
  type TournamentMatchResult,
  type TournamentMatchOutcome,
  type TournamentRecord,
  type TournamentRecordInput,
} from '@/types/tennisLog';
import {
  getTournament,
  createTournament,
  updateTournament,
  deleteTournament,
} from '@/lib/tennisLogTournamentService';
import TennisLogConfirmDialog from './TennisLogConfirmDialog';

// Cool Premium Light 토큰
const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';
const FIELD_BORDER = 'rgba(15,27,51,0.14)';

function todayString(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

type LoadState = 'loading' | 'ready' | 'notfound' | 'error';

export default function TournamentLogForm({
  mode,
  recordId,
}: {
  mode: 'new' | 'edit';
  recordId?: string;
}) {
  const router = useRouter();
  const access = useTennisLogAccess();
  const [isMounted, setIsMounted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [loadState, setLoadState] = useState<LoadState>(mode === 'edit' ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 입력 상태
  const [date, setDate] = useState<string>(todayString());
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [venue, setVenue] = useState('');
  const [eventType, setEventType] = useState('');
  const [participationCategory, setParticipationCategory] = useState('');
  const [participationCategoryCustom, setParticipationCategoryCustom] = useState('');
  const [partner, setPartner] = useState('');
  const [result, setResult] = useState('');
  const [resultDetail, setResultDetail] = useState('');
  const [condition, setCondition] = useState<number | null>(null);
  const [oneLine, setOneLine] = useState('');
  const [goodPoints, setGoodPoints] = useState('');
  const [improvements, setImprovements] = useState('');
  const [nextGoal, setNextGoal] = useState('');
  const [partnerMemo, setPartnerMemo] = useState('');
  const [matches, setMatches] = useState<TournamentMatchResult[]>([]);

  const [openRows, setOpenRows] = useState<Record<string, boolean>>({
    matches: false,
    good: false,
    improve: false,
    goal: false,
    partner: false,
  });

  const matchIdRef = useRef(0);
  const nextMatchId = () => `m_${++matchIdRef.current}`;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 접근 권한 가드 — 미로그인 '/', 잠금 '/tennis-log'.
  useEffect(() => {
    if (access === 'unauthenticated') router.replace('/');
    else if (access === 'locked') router.replace('/tennis-log');
  }, [access, router]);

  // 수정 모드 — 기존 데이터 로드.
  useEffect(() => {
    if (mode !== 'edit' || !recordId) return;
    if (access !== 'allowed') return;
    let cancelled = false;
    setLoadState('loading');
    (async () => {
      const { data, error } = await getTournament(recordId);
      if (cancelled) return;
      if (error) {
        setLoadState('error');
        return;
      }
      if (!data) {
        setLoadState('notfound');
        return;
      }
      hydrateFromRecord(data);
      setLoadState('ready');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recordId, access]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function hydrateFromRecord(r: TournamentRecord) {
    setDate(r.tournament_date);
    setName(r.tournament_name);
    setRegion(r.region ?? '');
    setVenue(r.venue ?? '');
    setEventType(r.event_type);
    setParticipationCategory(r.participation_category ?? '');
    setParticipationCategoryCustom(r.participation_category_custom ?? '');
    setPartner(r.partner_name ?? '');
    setResult(r.final_result);
    setResultDetail(r.result_detail ?? '');
    setCondition(r.condition_rating ?? null);
    setOneLine(r.one_line_review);
    setGoodPoints(r.good_points ?? '');
    setImprovements(r.improvements ?? '');
    setNextGoal(r.next_goal ?? '');
    setPartnerMemo(r.partner_memo ?? '');
    setMatches(
      (r.match_results ?? []).map((m) => ({ ...m, id: m.id || nextMatchId() })),
    );
    // 내용이 있는 상세 영역은 펼쳐 보여준다.
    setOpenRows({
      matches: (r.match_results?.length ?? 0) > 0,
      good: !!(r.good_points && r.good_points.trim()),
      improve: !!(r.improvements && r.improvements.trim()),
      goal: !!(r.next_goal && r.next_goal.trim()),
      partner: !!(r.partner_memo && r.partner_memo.trim()),
    });
  }

  if (!isMounted || access === 'loading' || access !== 'allowed') return null;

  // 수정 모드 로딩/오류/없음 처리
  if (mode === 'edit' && loadState !== 'ready') {
    return (
      <StatusScreen
        title={
          loadState === 'loading'
            ? '기록을 불러오는 중…'
            : loadState === 'notfound'
              ? '기록을 찾을 수 없습니다'
              : '기록을 불러오지 못했습니다'
        }
        body={
          loadState === 'loading'
            ? undefined
            : loadState === 'notfound'
              ? '이미 삭제되었거나 접근할 수 없는 기록입니다.'
              : '잠시 후 다시 시도해 주세요.'
        }
        showBack={loadState !== 'loading'}
        onBack={() => router.replace('/tennis-log/tournaments')}
      />
    );
  }

  const partnerRequired = isPartnerRequired(eventType);

  function validate(): string | null {
    if (!date) return '대회 날짜를 입력해 주세요.';
    if (!name.trim()) return '대회명을 입력해 주세요.';
    if (!eventType) return '종목을 선택해 주세요.';
    if (participationCategory === PARTICIPATION_CATEGORY_CUSTOM_VALUE && !participationCategoryCustom.trim())
      return "참가 구분에서 '기타'를 선택하면 직접 입력값이 필요합니다.";
    if (partnerRequired && !partner.trim()) return '복식·혼합복식은 파트너를 입력해 주세요.';
    if (!result) return '최종 성적을 선택해 주세요.';
    if (result === FINAL_RESULT_DETAIL_TRIGGER && !resultDetail.trim())
      return "최종 성적에서 '본선'을 선택하면 본선 상세를 입력해 주세요.";
    if (!oneLine.trim()) return '한 줄 회고를 입력해 주세요.';
    return null;
  }

  function collectInput(): TournamentRecordInput {
    return {
      tournament_date: date,
      tournament_name: name,
      region,
      venue,
      event_type: eventType,
      participation_category: participationCategory,
      participation_category_custom: participationCategoryCustom,
      partner_name: partner,
      final_result: result,
      result_detail: resultDetail,
      condition_rating: condition,
      one_line_review: oneLine,
      good_points: goodPoints,
      improvements,
      next_goal: nextGoal,
      partner_memo: partnerMemo,
      match_results: matches,
    };
  }

  async function handleSave() {
    if (saving) return; // 중복 클릭 차단
    const err = validate();
    if (err) {
      setToast(err);
      return;
    }
    setSaving(true);
    try {
      const input = collectInput();
      if (mode === 'edit' && recordId) {
        const { data, error } = await updateTournament(recordId, input);
        if (error || !data) {
          setToast(error || '저장하지 못했습니다.');
          return; // 작성값 유지
        }
        setToast('수정했습니다.');
        router.push(`/tennis-log/tournaments/${recordId}`);
      } else {
        const { data, error } = await createTournament(input);
        if (error || !data) {
          setToast(error || '저장하지 못했습니다.');
          return; // 작성값 유지
        }
        setToast('기록을 저장했습니다.');
        router.push(`/tennis-log/tournaments/${data.id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!recordId || deleting) return;
    setDeleting(true);
    const { error } = await deleteTournament(recordId);
    setDeleting(false);
    if (error) {
      setConfirmDelete(false);
      setToast(error);
      return;
    }
    setConfirmDelete(false);
    setToast('기록을 삭제했습니다.');
    router.replace('/tennis-log/tournaments');
  }

  const toggleRow = (key: string) => setOpenRows((p) => ({ ...p, [key]: !p[key] }));

  // 경기별 결과 editor
  const addMatch = () =>
    setMatches((prev) => [
      ...prev,
      { id: nextMatchId(), stage: '', opponent: '', scoreFor: '', scoreAgainst: '', result: 'win', memo: '' },
    ]);
  const removeMatch = (id: string) => setMatches((prev) => prev.filter((m) => m.id !== id));
  const patchMatch = (id: string, patch: Partial<TournamentMatchResult>) =>
    setMatches((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  return (
    <div style={{ width: '100%', maxWidth: 450, margin: '0 auto', boxSizing: 'border-box' }}>
      {/* 상단 헤더 바 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${CARD_BORDER}`,
          backgroundColor: '#FFFFFF',
        }}
      >
        <button
          type="button"
          onClick={() =>
            router.push(mode === 'edit' && recordId ? `/tennis-log/tournaments/${recordId}` : '/tennis-log')
          }
          aria-label="뒤로"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: NAVY,
            minWidth: 0,
          }}
        >
          <ChevronLeft size={20} strokeWidth={2.2} />
          <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>
            {mode === 'edit' ? '대회 기록 수정' : '대회 기록 추가'}
          </span>
        </button>
        <span
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 9px',
            borderRadius: 999,
            border: `1px solid ${FIELD_BORDER}`,
            color: SUB,
            fontSize: 10.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          <Lock size={11} strokeWidth={2.4} />
          나만 보기
        </span>
      </div>

      {/* 본문 */}
      <div
        style={{
          padding: '14px 16px',
          paddingBottom: 'calc(104px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* 안내 배너 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 11,
            backgroundColor: 'rgba(14,124,118,0.08)',
            border: '1px solid rgba(14,124,118,0.16)',
            color: '#0E6B66',
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: 1.5,
            wordBreak: 'keep-all',
          }}
        >
          <Check size={14} strokeWidth={2.6} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>필수 항목만 채워도 기록할 수 있어요. 나머지는 나중에 천천히 채워도 괜찮아요.</span>
        </div>

        {/* 기본 정보 */}
        <FieldGroupTitle required>기본 정보</FieldGroupTitle>

        <Field label="대회 날짜" required>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="대회명" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 제9회 충청 오픈 테니스"
            style={inputStyle}
          />
        </Field>

        {/* 지역 / 장소 — 2열(선택) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="지역">
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="예: 대전"
              style={inputStyle}
            />
          </Field>
          <Field label="장소">
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="예: ○○테니스장"
              style={inputStyle}
            />
          </Field>
        </div>

        {/* 종목 — 칩 선택(필수). 복식·혼합복식 선택 시 파트너 필수. */}
        <Field label="종목" required>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.value}
                selected={eventType === opt.value}
                onClick={() => setEventType(eventType === opt.value ? '' : opt.value)}
              />
            ))}
          </div>
        </Field>

        {/* 참가 구분 — 칩(선택). '기타' 선택 시 직접 입력 필수. 360px flex-wrap 유지 */}
        <Field label="참가 구분">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PARTICIPATION_CATEGORY_OPTIONS.map((opt) => (
              <Chip
                key={opt}
                label={opt}
                selected={participationCategory === opt}
                onClick={() => setParticipationCategory(participationCategory === opt ? '' : opt)}
              />
            ))}
          </div>
        </Field>
        {participationCategory === PARTICIPATION_CATEGORY_CUSTOM_VALUE && (
          <Field label="참가 구분 직접 입력" required>
            <input
              type="text"
              value={participationCategoryCustom}
              onChange={(e) => setParticipationCategoryCustom(e.target.value)}
              placeholder="예: 동호인부, 마스터즈"
              style={inputStyle}
            />
          </Field>
        )}

        {/* 파트너 — 종목에 따라 필수 여부 표시(복식·혼합복식 필수) */}
        <Field label="파트너" required={partnerRequired}>
          <input
            type="text"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            placeholder={partnerRequired ? '파트너 이름' : '복식일 때 입력'}
            style={inputStyle}
          />
        </Field>

        {/* 최종 성적 — 칩(필수). '본선' 선택 시 본선 상세 필수. 360px flex-wrap 유지 */}
        <Field label="최종 성적" required>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {FINAL_RESULT_OPTIONS.map((opt) => (
              <Chip
                key={opt}
                label={opt}
                ariaLabel={opt === '예탈' ? '예선 탈락' : opt}
                selected={result === opt}
                onClick={() => setResult(result === opt ? '' : opt)}
              />
            ))}
          </div>
        </Field>
        {result === FINAL_RESULT_DETAIL_TRIGGER && (
          <Field label="본선 상세" required>
            <input
              type="text"
              value={resultDetail}
              onChange={(e) => setResultDetail(e.target.value)}
              placeholder="예: 32강, 본선 2회전, 16강"
              style={inputStyle}
            />
          </Field>
        )}

        {/* 컨디션 (선택) 1~5 */}
        <Field label="컨디션">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Chip
                key={n}
                label={String(n)}
                selected={condition === n}
                onClick={() => setCondition(condition === n ? null : n)}
                minWidth={42}
              />
            ))}
            <span style={{ fontSize: 11, fontWeight: 600, color: FAINT }}>1 낮음 · 5 좋음</span>
          </div>
        </Field>

        <Field label="한 줄 회고" required>
          <textarea
            value={oneLine}
            onChange={(e) => setOneLine(e.target.value)}
            placeholder="예: 8강부터 흐름이 좋았고 결승에서 첫 게임 리듬을 못 잡았다."
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60, lineHeight: 1.5 }}
          />
        </Field>

        {/* 자세히 기록 (선택) */}
        <FieldGroupTitle>
          자세히 기록 <span style={{ color: FAINT, fontWeight: 600 }}>(선택)</span>
        </FieldGroupTitle>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 경기별 결과 */}
          <CollapsibleRow
            label="경기별 결과"
            hint="라운드별 상대 · 점수"
            open={openRows.matches}
            onToggle={() => toggleRow('matches')}
          >
            <MatchEditor
              matches={matches}
              onAdd={addMatch}
              onRemove={removeMatch}
              onPatch={patchMatch}
            />
          </CollapsibleRow>

          <CollapsibleRow label="잘된 점" open={openRows.good} onToggle={() => toggleRow('good')}>
            <DetailTextarea value={goodPoints} onChange={setGoodPoints} placeholder="잘된 점을 기록해 보세요." />
          </CollapsibleRow>

          <CollapsibleRow label="아쉬운 점" open={openRows.improve} onToggle={() => toggleRow('improve')}>
            <DetailTextarea value={improvements} onChange={setImprovements} placeholder="아쉬운 점을 기록해 보세요." />
          </CollapsibleRow>

          <CollapsibleRow label="다음 개선 목표" open={openRows.goal} onToggle={() => toggleRow('goal')}>
            <DetailTextarea value={nextGoal} onChange={setNextGoal} placeholder="다음에 개선할 목표를 적어 보세요." />
          </CollapsibleRow>

          <CollapsibleRow label="파트너 호흡 메모" open={openRows.partner} onToggle={() => toggleRow('partner')}>
            <DetailTextarea value={partnerMemo} onChange={setPartnerMemo} placeholder="파트너와의 호흡·소통 메모." />
          </CollapsibleRow>
        </div>
      </div>

      {/* 하단 저장 바 — 신규에는 삭제 없음, 수정에만 삭제 진입 */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 600,
          width: '100%',
          maxWidth: 450,
          boxSizing: 'border-box',
          backgroundColor: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 -2px 16px rgba(0,0,0,0.06)',
          padding: '12px 16px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={saving}
            aria-label="기록 삭제"
            style={{
              flexShrink: 0,
              width: 52,
              height: 50,
              borderRadius: 12,
              border: '1px solid rgba(220,38,38,0.28)',
              backgroundColor: '#FFFFFF',
              color: '#DC2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Trash2 size={19} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            height: 50,
            borderRadius: 12,
            border: 'none',
            backgroundColor: NAVY,
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 800,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
          }}
        >
          {saving ? (
            '저장 중…'
          ) : (
            <>
              <Check size={18} strokeWidth={2.6} />
              저장
            </>
          )}
        </button>
      </div>

      <TennisLogConfirmDialog
        open={confirmDelete}
        title="대회 기록을 삭제할까요?"
        body="삭제한 기록은 복구할 수 없습니다."
        confirmLabel="기록 삭제"
        cancelLabel="취소"
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => (deleting ? undefined : setConfirmDelete(false))}
      />

      {toast && <Toast text={toast} />}
    </div>
  );
}

// ── 보조 컴포넌트 ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: 11,
  border: `1px solid ${FIELD_BORDER}`,
  backgroundColor: '#FFFFFF',
  fontSize: 14,
  fontWeight: 600,
  color: INK,
  outline: 'none',
  fontFamily: 'inherit',
};

function Chip({
  label,
  selected,
  onClick,
  minWidth,
  ariaLabel,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  minWidth?: number;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={selected}
      style={{
        flex: '0 0 auto',
        minWidth,
        padding: '9px 14px',
        borderRadius: 999,
        border: selected ? `1px solid ${TEAL}` : `1px solid ${FIELD_BORDER}`,
        backgroundColor: selected ? TEAL : '#FFFFFF',
        color: selected ? '#FFFFFF' : SUB,
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function FieldGroupTitle({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p style={{ margin: '2px 0 -4px', fontSize: 13, fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', gap: 6 }}>
      {children}
      {required && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: '#DC2626',
            backgroundColor: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.20)',
            borderRadius: 5,
            padding: '1px 5px',
          }}
        >
          필수
        </span>
      )}
    </p>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: SUB,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        {required && <span style={{ color: '#DC2626' }}>*</span>}
      </span>
      {children}
    </label>
  );
}

function CollapsibleRow({
  label,
  hint,
  open,
  onToggle,
  children,
}: {
  label: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ backgroundColor: '#FFFFFF', border: `1px solid ${CARD_BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Plus
          size={16}
          strokeWidth={2.4}
          style={{ flexShrink: 0, color: TEAL, transition: 'transform 0.18s', transform: open ? 'rotate(45deg)' : 'none' }}
        />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          {hint && <span style={{ fontSize: 11, fontWeight: 500, color: FAINT, marginTop: 1 }}>{hint}</span>}
        </span>
        <ChevronRight
          size={15}
          strokeWidth={2.2}
          style={{ flexShrink: 0, color: '#CBD5E1', transition: 'transform 0.18s', transform: open ? 'rotate(90deg)' : 'none' }}
        />
      </button>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

function DetailTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      placeholder={placeholder}
      style={{ ...inputStyle, resize: 'vertical', minHeight: 76, lineHeight: 1.5 }}
    />
  );
}

function MatchEditor({
  matches,
  onAdd,
  onRemove,
  onPatch,
}: {
  matches: TournamentMatchResult[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<TournamentMatchResult>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {matches.length === 0 && (
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, color: FAINT, lineHeight: 1.5 }}>
          라운드별 결과를 추가할 수 있어요. 점수는 6, 7(5), RET, W.O 처럼 자유롭게 입력하세요.
        </p>
      )}

      {matches.map((m, idx) => (
        <div
          key={m.id}
          style={{
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            backgroundColor: '#FBFCFD',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>경기 {idx + 1}</span>
            <button
              type="button"
              onClick={() => onRemove(m.id)}
              aria-label={`경기 ${idx + 1} 삭제`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#DC2626',
                fontSize: 11,
                fontWeight: 700,
                padding: 2,
              }}
            >
              <X size={13} strokeWidth={2.6} />
              삭제
            </button>
          </div>

          {/* 단계 / 상대 — 2열 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              type="text"
              value={m.stage}
              onChange={(e) => onPatch(m.id, { stage: e.target.value })}
              placeholder="단계 (예: 8강)"
              style={miniInput}
            />
            <input
              type="text"
              value={m.opponent}
              onChange={(e) => onPatch(m.id, { opponent: e.target.value })}
              placeholder="상대"
              style={miniInput}
            />
          </div>

          {/* 내 점수 / 상대 점수 — 2열 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              type="text"
              inputMode="text"
              value={m.scoreFor}
              onChange={(e) => onPatch(m.id, { scoreFor: e.target.value })}
              placeholder="내 점수 (예: 6)"
              style={miniInput}
            />
            <input
              type="text"
              inputMode="text"
              value={m.scoreAgainst}
              onChange={(e) => onPatch(m.id, { scoreAgainst: e.target.value })}
              placeholder="상대 점수 (예: 7(5))"
              style={miniInput}
            />
          </div>

          {/* 승패 칩 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {MATCH_OUTCOME_OPTIONS.map((o) => {
              const selected = m.result === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onPatch(m.id, { result: o.value as TournamentMatchOutcome })}
                  style={{
                    flex: '0 0 auto',
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: selected ? `1px solid ${TEAL}` : `1px solid ${FIELD_BORDER}`,
                    backgroundColor: selected ? TEAL : '#FFFFFF',
                    color: selected ? '#FFFFFF' : SUB,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>

          <input
            type="text"
            value={m.memo ?? ''}
            onChange={(e) => onPatch(m.id, { memo: e.target.value })}
            placeholder="메모 (선택)"
            style={miniInput}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={onAdd}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: '100%',
          padding: '11px 0',
          borderRadius: 10,
          border: `1px dashed ${FIELD_BORDER}`,
          backgroundColor: '#FFFFFF',
          color: TEAL,
          fontSize: 13,
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <Plus size={15} strokeWidth={2.6} />
        경기 추가
      </button>
    </div>
  );
}

const miniInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  borderRadius: 9,
  border: `1px solid ${FIELD_BORDER}`,
  backgroundColor: '#FFFFFF',
  fontSize: 13,
  fontWeight: 600,
  color: INK,
  outline: 'none',
  fontFamily: 'inherit',
};

function StatusScreen({
  title,
  body,
  showBack,
  onBack,
}: {
  title: string;
  body?: string;
  showBack?: boolean;
  onBack?: () => void;
}) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 450,
        margin: '0 auto',
        padding: '0 16px',
        minHeight: '60dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: NAVY, wordBreak: 'keep-all' }}>{title}</p>
        {body && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: SUB, lineHeight: 1.6, wordBreak: 'keep-all' }}>
            {body}
          </p>
        )}
        {showBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              marginTop: 18,
              height: 44,
              padding: '0 22px',
              borderRadius: 11,
              border: 'none',
              backgroundColor: TEAL,
              color: '#FFFFFF',
              fontSize: 13.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            목록으로
          </button>
        )}
      </div>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(86px + env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        width: '92%',
        maxWidth: 420,
        backgroundColor: '#0F766E',
        borderRadius: 11,
        padding: '12px 18px',
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 700,
        color: '#FFFFFF',
        boxShadow: '0 6px 24px rgba(13,148,136,0.28)',
        wordBreak: 'keep-all',
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}
