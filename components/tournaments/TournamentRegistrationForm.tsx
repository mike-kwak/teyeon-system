'use client';

// 2026 TEYEON OPEN — 공개 참가신청 폼(비로그인).
//
//   원칙
//     · 입력 필드는 최소로. 선수 2명 + 팀 정보 + 요청사항 + 확인 4가지가 전부다.
//     · 확인/동의 문구는 공식 요강 원문 또는 수집 항목 고지만 사용한다 — 새 규정·새 동의 내용 금지.
//     · "신청 = 참가 확정"으로 오해하지 않도록 접수 흐름을 먼저 보여준다.
//     · WAITLISTED(49~60팀) 입금 정책은 미확정이므로 입금을 요구하는 문구를 만들지 않는다.
//       요강 원문("입금 확인 후 참가확정 처리합니다")까지만 인용한다.
//     · 실제 저장·순번·정원 판정은 전부 서버 RPC 담당. 이 컴포넌트는 UI 와 1차 검증만 한다.

import React from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Info } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import TurnstileWidget, { type TurnstileHandle } from './TurnstileWidget';
import {
  TournamentFormStyles,
  FormCard,
  Field,
  TextInput,
  TextAreaInput,
  ConsentRow,
} from './TournamentFormControls';
import { won } from '@/lib/tournaments/format';
import {
  EMPTY_REGISTRATION_FORM,
  MAX_CLUB_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PHONE_INPUT_LENGTH,
  firstErrorField,
  formatPhoneInput,
  normalizePhone,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationFieldKey,
  type RegistrationFormValues,
} from '@/lib/tournaments/validation';
import {
  TOURNAMENT_SUBMIT_NOT_READY,
  registrationSubmitMessage,
  submitTournamentRegistration,
  type TournamentRegistrationReceipt,
} from '@/lib/tournaments/registrationService';
import type { OfficialTournament } from '@/lib/tournaments/types';

interface Props {
  event: OfficialTournament;
  /** 대회 정보(Hub) 경로 — 요강 앵커 링크에 사용. */
  hubHref: string;
  /** 접수 성공 시 호출(5단계 완료 화면 연결 지점). */
  onSubmitted?: (receipt: TournamentRegistrationReceipt) => void;
}

/** 접수 흐름 — 요강 02 의 절차를 단계로만 표시한다(새 규정 아님). */
const FLOW_STEPS = ['참가신청서 제출', '운영진 접수 확인', '입금 확인', '최종 참가 확정'];

/**
 * 비활성 사유 안내를 '입력' / '확인·동의' 로 나누기 위한 키 분류.
 *   ⚠ 규칙(체크되어 있어야 함)은 validateRegistration 이 단독으로 갖는다.
 *      여기 있는 건 어떤 오류 키가 확인·동의 항목인지의 분류일 뿐이며, 검증을 다시 구현하지 않는다.
 */
const CONSENT_KEYS: RegistrationFieldKey[] = [
  'eligibilityConfirmed',
  'regulationsConfirmed',
  'privacyAgreed',
  'mediaNoticeConfirmed',
];

export default function TournamentRegistrationForm({ event, hubHref, onSubmitted }: Props) {
  const [values, setValues] = React.useState<RegistrationFormValues>(EMPTY_REGISTRATION_FORM);
  const [errors, setErrors] = React.useState<RegistrationErrors>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState('');
  const submittingRef = React.useRef(false); // 더블클릭/연타 1차 차단(최종 차단은 서버).
  // 봇 방어 — 판정은 전부 서버가 한다. 여기 값은 서버에 넘길 재료일 뿐이다.
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const turnstileRef = React.useRef<TurnstileHandle | null>(null);
  const honeypotRef = React.useRef<HTMLInputElement | null>(null);

  const refs = {
    player1Name: React.useRef<HTMLInputElement | null>(null),
    player1Phone: React.useRef<HTMLInputElement | null>(null),
    player2Name: React.useRef<HTMLInputElement | null>(null),
    player2Phone: React.useRef<HTMLInputElement | null>(null),
    clubName: React.useRef<HTMLInputElement | null>(null),
    depositorName: React.useRef<HTMLInputElement | null>(null),
    note: React.useRef<HTMLTextAreaElement | null>(null),
    eligibilityConfirmed: React.useRef<HTMLInputElement | null>(null),
    regulationsConfirmed: React.useRef<HTMLInputElement | null>(null),
    privacyAgreed: React.useRef<HTMLInputElement | null>(null),
    mediaNoticeConfirmed: React.useRef<HTMLInputElement | null>(null),
  };

  const setField = <K extends RegistrationFieldKey>(key: K, value: RegistrationFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // 입력을 고치는 순간 해당 필드 오류만 지운다(다른 필드 오류는 유지).
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    setSubmitError('');
  };

  const setPhone = (key: 'player1Phone' | 'player2Phone', raw: string) => {
    setField(key, formatPhoneInput(raw));
  };

  const focusField = (key: RegistrationFieldKey) => {
    const el = refs[key]?.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 스크롤 도중 포커스하면 위치가 튀므로 약간 늦춘다.
    window.setTimeout(() => el.focus({ preventScroll: true }), 250);
  };

  // 제출 버튼 활성 조건.
  //   ⚠ 규칙을 여기서 새로 쓰지 않는다. validateRegistration 이 필수 입력 + 확인/동의 4개의
  //      단일 출처이므로 그 결과를 그대로 쓴다(규칙이 두 곳으로 갈라지는 것을 막는다).
  //   ⚠ 서버의 CONSENT_REQUIRED 방어는 그대로 유지된다 — 이건 UX 1차 차단일 뿐이다.
  const formErrors = React.useMemo(() => validateRegistration(values), [values]);
  const formReady = !Object.values(formErrors).some(Boolean);
  const canSubmit = formReady && !!turnstileToken && !submitting;

  // 버튼이 왜 비활성인지 한 줄로만 알려준다(우선순위: 입력 → 확인·동의 → 보안 확인).
  //   formErrors 를 그대로 재사용하므로 조건이 버튼 상태와 절대 어긋나지 않는다.
  const blockReason = React.useMemo(() => {
    if (submitting) return '';
    const failed = (Object.keys(formErrors) as RegistrationFieldKey[]).filter((k) => !!formErrors[k]);
    if (failed.some((k) => !CONSENT_KEYS.includes(k))) return '필수 정보를 모두 입력해 주세요.';
    if (failed.length > 0) return '필수 확인 및 동의를 완료해 주세요.';
    if (!turnstileToken) return '보안 확인을 완료해 주세요.';
    return '';
  }, [formErrors, turnstileToken, submitting]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;

    const nextErrors = validateRegistration(values);
    const first = firstErrorField(nextErrors);
    if (first) {
      setErrors(nextErrors);
      setSubmitError('');
      focusField(first);
      return;
    }

    if (!turnstileToken) {
      setSubmitError('보안 확인이 완료될 때까지 잠시 기다려 주세요.');
      return;
    }

    setErrors({});
    setSubmitError('');
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const receipt = await submitTournamentRegistration({
        slug: event.slug,
        player1Name: values.player1Name.trim(),
        player1Phone: normalizePhone(values.player1Phone),
        player2Name: values.player2Name.trim(),
        player2Phone: normalizePhone(values.player2Phone),
        clubName: values.clubName.trim() ? values.clubName.trim() : null,
        depositorName: values.depositorName.trim(),
        note: values.note.trim() ? values.note.trim() : null,
        eligibilityConfirmed: values.eligibilityConfirmed,
        regulationsConfirmed: values.regulationsConfirmed,
        privacyAgreed: values.privacyAgreed,
        mediaNoticeConfirmed: values.mediaNoticeConfirmed,
        turnstileToken,
        company: honeypotRef.current?.value ?? '',
      });
      onSubmitted?.(receipt);
    } catch (err) {
      const name = (err as { name?: string; message?: string })?.name;
      const message = String((err as { message?: string })?.message || '');
      if (name === TOURNAMENT_SUBMIT_NOT_READY || message === TOURNAMENT_SUBMIT_NOT_READY) {
        setSubmitError(
          '온라인 참가신청 접수를 준비 중입니다. 잠시 후 다시 시도하시거나 대회 운영본부로 문의해 주세요.',
        );
      } else {
        setSubmitError(registrationSubmitMessage(err));
      }
      // Turnstile 토큰은 1회용이다. 실패했으면 새 토큰을 받아야 재시도할 수 있다.
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const regulationsAnchor = `${hubHref}#tournament-regulations`;

  const anchorLink = (label: string, href: string) => (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12.5,
        fontWeight: 800,
        color: TT.teal,
        textDecoration: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
      <ArrowRight size={13} strokeWidth={2.5} />
    </Link>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <TournamentFormStyles />

      {/* 접수 안내 — 신청 = 참가확정이 아님을 먼저 알린다. */}
      <section
        style={{
          backgroundColor: TT.navy,
          borderRadius: 12,
          padding: '18px 17px 19px',
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: FONT_LABEL,
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '0.18em',
            color: TT.tealOnNavy,
          }}
        >
          REGISTRATION FLOW
        </p>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 15.5,
            fontWeight: 900,
            color: '#FFFFFF',
            lineHeight: 1.55,
            wordBreak: 'keep-all',
          }}
        >
          참가신청 완료가 최종 참가확정을 의미하지 않으며, 입금 확인 후 참가확정 처리합니다.
        </p>

        <ol style={{ margin: '16px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {FLOW_STEPS.map((step, i) => (
            <li
              key={step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.82)',
                lineHeight: 1.5,
                wordBreak: 'keep-all',
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(62,214,192,0.16)',
                  color: TT.tealOnNavy,
                  fontSize: 11,
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {i + 1}
              </span>
              <span style={{ minWidth: 0 }}>{step}</span>
            </li>
          ))}
        </ol>

        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>참가비</span>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: '#FFFFFF' }}>
              팀당 {won(event.entryFee)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>신청 마감</span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 800,
                color: '#FFFFFF',
                textAlign: 'right',
                lineHeight: 1.5,
                wordBreak: 'keep-all',
              }}
            >
              {event.registrationCloseLabel}
            </span>
          </div>
        </div>

        <p
          style={{
            margin: '14px 0 0',
            fontSize: 12,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.55)',
            lineHeight: 1.7,
            wordBreak: 'keep-all',
          }}
        >
          {event.targetCapacity}팀은 우선 참가 기준이며, 이후 신청은 대기팀으로 접수될 수 있습니다.
        </p>
      </section>

      {/* 선수 1 */}
      <FormCard label="PLAYER 1">
        <Field id="p1-name" label="이름" required error={errors.player1Name}>
          <TextInput
            id="p1-name"
            inputRef={refs.player1Name}
            value={values.player1Name}
            onChange={(v) => setField('player1Name', v)}
            placeholder="선수 1 이름"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            error={!!errors.player1Name}
          />
        </Field>
        <Field
          id="p1-phone"
          label="휴대폰 번호"
          required
          error={errors.player1Phone}
          helper="대회 안내 연락을 받을 번호를 입력해 주세요."
        >
          <TextInput
            id="p1-phone"
            inputRef={refs.player1Phone}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={values.player1Phone}
            onChange={(v) => setPhone('player1Phone', v)}
            placeholder="010-1234-5678"
            maxLength={MAX_PHONE_INPUT_LENGTH}
            error={!!errors.player1Phone}
          />
        </Field>
      </FormCard>

      {/* 선수 2 */}
      <FormCard label="PLAYER 2">
        <Field id="p2-name" label="이름" required error={errors.player2Name}>
          <TextInput
            id="p2-name"
            inputRef={refs.player2Name}
            value={values.player2Name}
            onChange={(v) => setField('player2Name', v)}
            placeholder="선수 2 이름"
            maxLength={MAX_NAME_LENGTH}
            error={!!errors.player2Name}
          />
        </Field>
        <Field id="p2-phone" label="휴대폰 번호" required error={errors.player2Phone}>
          <TextInput
            id="p2-phone"
            inputRef={refs.player2Phone}
            type="tel"
            inputMode="numeric"
            value={values.player2Phone}
            onChange={(v) => setPhone('player2Phone', v)}
            placeholder="010-1234-5678"
            maxLength={MAX_PHONE_INPUT_LENGTH}
            error={!!errors.player2Phone}
          />
        </Field>
      </FormCard>

      {/* 팀 정보 */}
      <FormCard label="TEAM">
        <Field
          id="club-name"
          label="클럽명"
          optional
          error={errors.clubName}
          helper="소속 클럽이 없으면 비워 두셔도 됩니다."
        >
          <TextInput
            id="club-name"
            inputRef={refs.clubName}
            value={values.clubName}
            onChange={(v) => setField('clubName', v)}
            placeholder="소속 클럽명"
            maxLength={MAX_CLUB_LENGTH}
            error={!!errors.clubName}
          />
        </Field>
        <Field
          id="depositor-name"
          label="입금자명"
          required
          error={errors.depositorName}
          helper="입금 확인에 사용됩니다."
        >
          <TextInput
            id="depositor-name"
            inputRef={refs.depositorName}
            value={values.depositorName}
            onChange={(v) => setField('depositorName', v)}
            placeholder="입금자명"
            maxLength={MAX_NAME_LENGTH}
            error={!!errors.depositorName}
          />
        </Field>
        <Field
          id="note"
          label="요청사항 · 문의사항"
          optional
          error={errors.note}
          helper={`${values.note.trim().length} / ${MAX_NOTE_LENGTH}자`}
        >
          <TextAreaInput
            id="note"
            inputRef={refs.note}
            value={values.note}
            onChange={(v) => setField('note', v)}
            placeholder="대회 운영본부에 전할 내용이 있으면 적어주세요."
            maxLength={MAX_NOTE_LENGTH}
            error={!!errors.note}
          />
        </Field>
      </FormCard>

      {/* 확인 · 동의 */}
      <FormCard label="CONFIRMATION" description="아래 4가지를 모두 확인해야 신청이 접수됩니다.">
        <div>
          <ConsentRow
            id="agree-eligibility"
            inputRef={refs.eligibilityConfirmed}
            checked={values.eligibilityConfirmed}
            onChange={(v) => setField('eligibilityConfirmed', v)}
            title="참가 자격을 확인했습니다"
            body="공식 대회요강의 참가 자격 · 페어 요건을 확인했으며, 그 기준에 따라 출전 가능한 팀입니다."
            action={anchorLink('참가 자격 전문 보기', regulationsAnchor)}
            error={errors.eligibilityConfirmed}
          />
          <ConsentRow
            id="agree-regulations"
            inputRef={refs.regulationsConfirmed}
            checked={values.regulationsConfirmed}
            onChange={(v) => setField('regulationsConfirmed', v)}
            title="공식 대회요강을 확인했습니다"
            body={`일시 · 장소 · 경기 방법 · 시상 등 ${event.titleFull} 공식 대회요강 내용을 확인했습니다.`}
            action={anchorLink('대회 요강 보기', hubHref)}
            error={errors.regulationsConfirmed}
          />
          {/* 보유·파기 기간은 운영 정책으로 확정된 값이다(대회 종료 후 3개월 보관 후 파기).
              공식 요강에는 없는 항목이므로 여기서만 관리하며, 기간을 바꾸려면 이 문구를 고친다.
              수집 항목·이용 목적 문장은 기존 문맥을 그대로 유지하고 보유기간만 이어 붙였다.
              저장 구조(privacy_agreed_at)는 변경하지 않는다 — 동의 시각만 기록한다. */}
          <ConsentRow
            id="agree-privacy"
            inputRef={refs.privacyAgreed}
            checked={values.privacyAgreed}
            onChange={(v) => setField('privacyAgreed', v)}
            title="개인정보 수집·이용에 동의합니다"
            body="신청 정보(선수 이름, 휴대폰 번호, 클럽명, 입금자명)는 대회 접수 확인과 대회 운영 연락 목적으로만 사용되며, 대회 종료 후 3개월간 보관한 뒤 파기합니다."
            error={errors.privacyAgreed}
          />
          <ConsentRow
            id="agree-media"
            inputRef={refs.mediaNoticeConfirmed}
            checked={values.mediaNoticeConfirmed}
            onChange={(v) => setField('mediaNoticeConfirmed', v)}
            title="촬영 · 중계 안내를 확인했습니다"
            body={event.mediaNotice}
            error={errors.mediaNoticeConfirmed}
            last
          />
        </div>
      </FormCard>

      {/* 제출 */}
      <div>
        {submitError && (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: '13px 14px',
              borderRadius: 10,
              backgroundColor: '#FEF2F2',
              border: '1px solid #FCA5A5',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
            }}
          >
            <AlertCircle size={16} strokeWidth={2.3} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                fontWeight: 700,
                color: '#B91C1C',
                lineHeight: 1.65,
                wordBreak: 'keep-all',
                minWidth: 0,
              }}
            >
              {submitError}
            </p>
          </div>
        )}

        {/* honeypot — 사람에게 보이지 않는 필드. 봇이 채우면 서버가 즉시 거절한다.
            display:none 이 아니라 화면 밖으로 밀어내되, 스크린리더·탭 순서·자동완성에서
            완전히 제외한다(aria-hidden + tabIndex -1 + autoComplete off). */}
        <input
          ref={honeypotRef}
          type="text"
          name="company"
          defaultValue=""
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            clipPath: 'inset(50%)',
            whiteSpace: 'nowrap',
            left: '-9999px',
          }}
        />

        <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />

        {/* 제출 CTA.
            ⚠ disabled 를 opacity 만으로 표현하면 실기기(밝은 화면·야외)에서 여전히
               채도 높은 teal 로 보여 "눌리는 버튼"처럼 읽힌다. 색 자체를 중립 회색으로 바꾼다.
            ⚠ tt-submit-cta:disabled 규칙(tournamentShell.css)이 !important 로 같은 값을
               한 번 더 못 박는다 — 인라인이 어긋나거나 모바일 브라우저 기본 스타일이
               끼어들어도 disabled 속성만 있으면 반드시 비활성으로 보이게 하기 위함이다. */}
        <button
          type="button"
          className="tt-submit-cta"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: '100%',
            minHeight: 56,
            padding: '15px 18px',
            borderRadius: 9,
            border: 'none',
            backgroundColor: canSubmit ? TT.teal : TT.line,
            color: canSubmit ? '#FFFFFF' : TT.muted,
            WebkitTextFillColor: canSubmit ? '#FFFFFF' : TT.muted,
            boxShadow: 'none',
            fontFamily: 'inherit',
            fontSize: 15.5,
            fontWeight: 800,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: 1,
            transform: 'none',
            boxSizing: 'border-box',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {submitting ? '신청 접수 중…' : '참가 신청하기'}
        </button>

        {blockReason && (
          <p
            role="status"
            style={{
              margin: '9px 0 0',
              textAlign: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: TT.muted,
              lineHeight: 1.6,
              wordBreak: 'keep-all',
            }}
          >
            {blockReason}
          </p>
        )}

        <p
          style={{
            margin: '12px 0 0',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 7,
            fontSize: 12,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.7,
            wordBreak: 'keep-all',
          }}
        >
          <Info size={14} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 2, color: TT.subtle }} />
          <span style={{ minWidth: 0 }}>
            접수 후 수정이 필요하면 대회 운영본부로 연락해 주세요. TEYEON 회원가입 없이 신청할 수 있습니다.
          </span>
        </p>
      </div>
    </div>
  );
}
