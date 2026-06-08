'use client';

import React, { useState } from 'react';
import { ChevronLeft, CheckCircle2, Clock, MapPin, Users, CalendarDays, Info } from 'lucide-react';
import Link from 'next/link';

// ─── Mock data ────────────────────────────────────────────────────────────────
// TODO: Supabase guest_recruitments 테이블과 연결 예정.
//       현재 active recruitment row를 fetchGuestRecruitment()로 가져오는 구조로 교체.
const MOCK_RECRUITMENT = {
  id: 'recruit-mock-001',
  isOpen: true,
  date: '2026-06-14',         // TODO: guest_recruitments.event_date
  displayDate: '6월 14일 (일)',
  time: '09:00 – 13:00',      // TODO: guest_recruitments.start_time / end_time
  venue: '수원 매원공원 테니스장', // TODO: guest_recruitments.venue
  courts: 3,                   // TODO: guest_recruitments.court_count
  guestSlots: 4,               // TODO: guest_recruitments.guest_slots
  fee: '코트비 1/n',           // TODO: guest_recruitments.fee_note
  level: '초급 이상 (구력 6개월~)', // TODO: guest_recruitments.level_note
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Level = '입문' | '초급' | '중급' | '상급';
type DatePref = '기본 일정' | '다른 날짜도 가능';

interface FormState {
  name: string;
  contact: string;
  level: Level | '';
  datePref: DatePref | '';
  memo: string;
  agreed: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const SectionCard = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => (
  <div
    style={{
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      padding: '18px 18px',
      ...style,
    }}
  >
    {children}
  </div>
);

const CardLabel = ({ children }: { children: React.ReactNode }) => (
  <p
    style={{
      fontSize: 8.5,
      fontWeight: 800,
      letterSpacing: '0.28em',
      textTransform: 'uppercase' as const,
      color: '#0D9488',
      margin: '0 0 8px',
    }}
  >
    {children}
  </p>
);

const InfoRow = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      paddingBottom: 10,
      borderBottom: '1px solid rgba(0,0,0,0.05)',
    }}
  >
    <span style={{ color: '#0D9488', flexShrink: 0, marginTop: 1 }}>{icon}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: '#94A3B8', lineHeight: 1.4 }}>
        {label}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: '#1E293B', lineHeight: 1.4 }}>
        {value}
      </p>
    </div>
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GuestPage() {
  const [form, setForm] = useState<FormState>({
    name: '',
    contact: '',
    level: '',
    datePref: '',
    memo: '',
    agreed: false,
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const r = MOCK_RECRUITMENT;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError('');
  };

  const handleSubmit = () => {
    if (!form.name.trim()) { setError('이름을 입력해 주세요.'); return; }
    if (!form.contact.trim()) { setError('연락 가능한 정보를 입력해 주세요.'); return; }
    if (!form.level) { setError('테니스 구력을 선택해 주세요.'); return; }
    if (!form.datePref) { setError('희망 참가일을 선택해 주세요.'); return; }
    if (!form.agreed) { setError('개인정보 수집·이용에 동의해 주세요.'); return; }

    // TODO: Supabase guest_applications INSERT 호출로 교체.
    //       payload: { recruitment_id, name, contact, level, date_pref, memo, status: 'pending' }
    console.log('[GuestPage] mock submit', form);
    setSubmitted(true);
  };

  const LEVELS: Level[] = ['입문', '초급', '중급', '상급'];
  const DATE_PREFS: DatePref[] = ['기본 일정', '다른 날짜도 가능'];

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 46,
    borderRadius: 11,
    border: '1.5px solid rgba(0,0,0,0.10)',
    backgroundColor: '#F8FAFC',
    padding: '0 13px',
    fontSize: 13,
    fontWeight: 500,
    color: '#1E293B',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const chipBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    height: 38,
    borderRadius: 10,
    border: `1.5px solid ${active ? '#0D9488' : 'rgba(0,0,0,0.09)'}`,
    backgroundColor: active ? 'rgba(13,148,136,0.08)' : '#F8FAFC',
    color: active ? '#0D9488' : '#64748B',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  });

  return (
    <main
      style={{
        width: '100%',
        minHeight: '100dvh',
        backgroundColor: '#F2F4F7',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingBottom: 16,
      }}
    >
      {/* ── Back nav ── */}
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          padding: '14px 16px 0',
        }}
      >
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            fontWeight: 700,
            color: '#64748B',
            textDecoration: 'none',
          }}
        >
          <ChevronLeft size={15} />
          TEYEON
        </Link>
      </div>

      {/* ── Content ── */}
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          padding: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >

        {/* ── Hero ── */}
        <div
          style={{
            marginTop: 16,
            borderRadius: 16,
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)',
            borderTop: '2px solid #0D9488',
            boxShadow: '0 2px 10px rgba(0,0,0,0.055)',
            padding: '22px 20px 18px',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-rajdhani), sans-serif',
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.30em',
              textTransform: 'uppercase',
              color: '#0D9488',
              margin: '0 0 6px',
            }}
          >
            TEYEON TENNIS CLUB
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-rajdhani), sans-serif',
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#0F172A',
              margin: '0 0 4px',
              lineHeight: 1.15,
            }}
          >
            TEYEON GUEST
          </h1>
          <p
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#1E293B',
              margin: '0 0 10px',
              lineHeight: 1.4,
            }}
          >
            테니스로 이어진 인연.
          </p>
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#64748B',
              margin: 0,
              lineHeight: 1.65,
            }}
          >
            TEYEON Tennis Club에서 함께 칠 게스트를 모집합니다.
            <br />
            일정과 안내를 확인하고 신청해 주세요.
          </p>
        </div>

        {/* ── Recruitment status ── */}
        <SectionCard>
          <CardLabel>모집 상태</CardLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingRight: 14,
                borderRight: '1px solid rgba(0,0,0,0.07)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: r.isOpen ? '#16A34A' : '#EF4444',
                  boxShadow: r.isOpen ? '0 0 0 3px rgba(22,163,74,0.18)' : undefined,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: r.isOpen ? '#16A34A' : '#EF4444',
                  letterSpacing: '-0.01em',
                }}
              >
                {r.isOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1E293B' }}>
                {r.displayDate} · {r.time}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 500, color: '#94A3B8' }}>
                게스트 {r.guestSlots}명 모집 중 · 신청 가능
              </p>
            </div>
          </div>
        </SectionCard>

        {/* ── Meeting info ── */}
        <SectionCard>
          <CardLabel>모임 정보</CardLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <InfoRow icon={<CalendarDays size={14} />} label="날짜" value={r.displayDate} />
            <InfoRow icon={<Clock size={14} />} label="시간" value={r.time} />
            <InfoRow icon={<MapPin size={14} />} label="장소" value={r.venue} />
            <InfoRow icon={<Users size={14} />} label="코트 수" value={`${r.courts}면`} />
            <InfoRow icon={<Users size={14} />} label="모집 인원" value={`게스트 ${r.guestSlots}명`} />
            <InfoRow icon={<Info size={14} />} label="참가비" value={r.fee} />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: '#0D9488', flexShrink: 0, marginTop: 1 }}>
                <Info size={14} />
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: '#94A3B8', lineHeight: 1.4 }}>
                  참가 레벨
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: '#1E293B', lineHeight: 1.4 }}>
                  {r.level}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Guide ── */}
        <SectionCard>
          <CardLabel>안내</CardLabel>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            {[
              '처음 오시는 분도 부담 없이 신청 가능합니다.',
              '신청 후 운영진 확인 뒤 개별 연락 예정입니다.',
              'TEYEON은 자체 앱으로 일정, 경기, 기록을 관리하는 테니스 클럽입니다.',
            ].map((text, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#475569',
                  lineHeight: 1.6,
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    backgroundColor: '#0D9488',
                    flexShrink: 0,
                    marginTop: 7,
                  }}
                />
                {text}
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* ── TEYEON GUEST NOTE ── */}
        <SectionCard style={{ backgroundColor: 'rgba(248,250,252,1)', border: '1px solid rgba(0,0,0,0.07)' }}>
          <CardLabel>TEYEON GUEST NOTE</CardLabel>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            {[
              'KDK 경기는 기본 1:1 스코어에서 시작합니다.',
              '지각/불참 등 운영 기준에 따라 벌금이 발생할 수 있습니다.',
              '게스트는 당일 순위 집계에는 참여하지만, 상금 지급 대상에서는 제외됩니다.',
              '참가비는 코트비와 운영 기준에 따라 안내됩니다.',
              '신청 후 운영진 확인을 거쳐 참여가 최종 확정됩니다.',
            ].map((text, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: '#64748B',
                  lineHeight: 1.6,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#94A3B8',
                    flexShrink: 0,
                    marginTop: 2,
                    lineHeight: 1.6,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                {text}
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* ── Application form / completion ── */}
        {submitted ? (
          /* ── Completion card ── */
          <SectionCard>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                padding: '12px 0 8px',
              }}
            >
              <CheckCircle2 size={48} strokeWidth={1.5} color="#0D9488" />
              <div style={{ textAlign: 'center' }}>
                <p
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: '#0F172A',
                    margin: '0 0 6px',
                    letterSpacing: '-0.01em',
                  }}
                >
                  신청 완료
                </p>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#64748B',
                    margin: 0,
                    lineHeight: 1.65,
                  }}
                >
                  운영진 확인 후 개별적으로 연락드릴게요.
                </p>
              </div>
              <div
                style={{
                  marginTop: 4,
                  padding: '8px 18px',
                  borderRadius: 99,
                  backgroundColor: 'rgba(13,148,136,0.08)',
                  border: '1px solid rgba(13,148,136,0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Clock size={12} color="#0D9488" />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#0D9488', letterSpacing: '0.04em' }}>
                  상태: 확인 대기
                </span>
              </div>
            </div>
          </SectionCard>
        ) : (
          /* ── Application form ── */
          <SectionCard>
            <CardLabel>게스트 신청</CardLabel>

            {/* 이름 */}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  marginBottom: 5,
                }}
              >
                이름 <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="이름을 입력해 주세요"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* 연락처 */}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  marginBottom: 5,
                }}
              >
                연락 가능한 정보 <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="휴대폰 번호 또는 인스타 ID"
                value={form.contact}
                onChange={(e) => setField('contact', e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* 테니스 구력 */}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  marginBottom: 5,
                }}
              >
                테니스 구력 <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setField('level', lv)}
                    style={chipBtn(form.level === lv)}
                  >
                    {lv}
                  </button>
                ))}
              </div>
            </div>

            {/* 희망 참가일 */}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  marginBottom: 5,
                }}
              >
                희망 참가일 <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {DATE_PREFS.map((dp) => (
                  <button
                    key={dp}
                    type="button"
                    onClick={() => setField('datePref', dp)}
                    style={chipBtn(form.datePref === dp)}
                  >
                    {dp}
                  </button>
                ))}
              </div>
            </div>

            {/* 메모 */}
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  marginBottom: 5,
                }}
              >
                간단한 메모
              </label>
              <textarea
                placeholder="궁금한 점이나 전하실 말씀을 적어주세요."
                value={form.memo}
                onChange={(e) => setField('memo', e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  borderRadius: 11,
                  border: '1.5px solid rgba(0,0,0,0.10)',
                  backgroundColor: '#F8FAFC',
                  padding: '11px 13px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#1E293B',
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  lineHeight: 1.6,
                }}
              />
            </div>

            {/* 개인정보 동의 */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                cursor: 'pointer',
                marginBottom: 16,
              }}
            >
              <input
                type="checkbox"
                checked={form.agreed}
                onChange={(e) => setField('agreed', e.target.checked)}
                style={{ marginTop: 2, accentColor: '#0D9488', width: 15, height: 15, flexShrink: 0 }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: '#64748B',
                  lineHeight: 1.6,
                }}
              >
                신청 정보(이름, 연락처)는 운영진 확인 및 연락 목적으로만 사용되며,
                확정 이후 별도 보관하지 않습니다.
                <br />
                <strong style={{ color: '#475569' }}>개인정보 수집·이용에 동의합니다.</strong>
                <span style={{ color: '#EF4444' }}> *</span>
              </span>
            </label>

            {/* Error */}
            {error && (
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#EF4444',
                  margin: '-8px 0 12px',
                  lineHeight: 1.5,
                }}
              >
                {error}
              </p>
            )}

            {/* Submit button */}
            <button
              type="button"
              onClick={handleSubmit}
              style={{
                width: '100%',
                height: 50,
                borderRadius: 14,
                backgroundColor: '#0D9488',
                border: 'none',
                fontSize: 14,
                fontWeight: 800,
                color: '#FFFFFF',
                letterSpacing: '-0.01em',
                cursor: 'pointer',
                boxShadow: '0 3px 12px rgba(13,148,136,0.22)',
                WebkitTapHighlightColor: 'transparent',
              }}
              className="active:scale-[0.98]"
            >
              게스트 신청하기
            </button>
          </SectionCard>
        )}
      </div>
    </main>
  );
}
