'use client';

export const dynamic = 'force-dynamic';

// TEYEON PUBLIC_GUEST — 공개 게스트 신청(비로그인). 공개 shell(회원 GlobalHeader/BottomNav 미노출).
//   · 모집/제출은 서버 RPC(get_open_guest_recruitments / submit_guest_application)만 사용 — 원본 테이블 직접 접근 없음.
//   · 운영 SQL 미적용(ready=false) → 실제 제출하지 않고 "준비 중" 안내.
//   · 게스트비는 KDK 세션 단일 출처를 읽기 전용 표시(0원/미설정 구분).

import React, { useEffect, useState } from 'react';
import { ChevronLeft, CheckCircle2, Clock, MapPin, Users, CalendarDays, Info } from 'lucide-react';
import Link from 'next/link';
import {
  fetchOpenRecruitments, submitGuestApplication, guestSubmitMessage,
  GUEST_SUBMIT_NOT_READY, type OpenRecruitment,
} from '@/lib/guestApplicationService';

type Level = '입문' | '초급' | '중급' | '상급';
type Affiliation = 'club' | 'independent';
interface FormState {
  name: string; phone: string; affiliation: Affiliation | ''; region: string;
  clubName: string; level: Level | ''; bestRecord: string; memo: string; agreed: boolean;
}

const SectionCard = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ backgroundColor: '#FFFFFF', borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', padding: '18px 18px', ...style }}>{children}</div>
);
const CardLabel = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#0D9488', margin: '0 0 14px' }}>{children}</p>
);
const FieldLabel = ({ children, required, optional }: { children: React.ReactNode; required?: boolean; optional?: boolean }) => (
  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
    {children}
    {required && <span style={{ color: '#EF4444', marginLeft: 3 }}>*</span>}
    {optional && <span style={{ fontSize: 10, fontWeight: 500, color: '#94A3B8', marginLeft: 4 }}>선택</span>}
  </label>
);
const InfoRow = ({ icon, label, value, last }: { icon: React.ReactNode; label: string; value: string; last?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingBottom: last ? 0 : 10, marginBottom: last ? 0 : 10, borderBottom: last ? 'none' : '1px solid rgba(0,0,0,0.05)' }}>
    <span style={{ color: '#0D9488', flexShrink: 0, marginTop: 1 }}>{icon}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: '#94A3B8', lineHeight: 1.4 }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: '#1E293B', lineHeight: 1.4, wordBreak: 'keep-all' }}>{value}</p>
    </div>
  </div>
);

const formatDate = (d: string | null): string => {
  if (!d) return '날짜 미정';
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return d;
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, day).getDay()];
  return `${m}월 ${day}일 (${dow})`;
};
const trimSec = (t: string | null) => (t ? t.slice(0, 5) : '');
const formatTime = (r: OpenRecruitment): string => {
  const s = trimSec(r.startTime), e = trimSec(r.endTime);
  return s && e ? `${s} – ${e}` : s ? `${s} 시작` : e ? `~ ${e}` : '시간 미정';
};
const formatFee = (fee: number | null): string => (fee == null ? '게스트비 추후 안내 (미설정)' : fee === 0 ? '무료 (0원)' : `${fee.toLocaleString()}원`);

export default function GuestPage() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [recruitments, setRecruitments] = useState<OpenRecruitment[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', phone: '', affiliation: '', region: '', clubName: '', level: '', bestRecord: '', memo: '', agreed: false });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchOpenRecruitments()
      .then(({ ready, recruitments }) => {
        if (cancelled) return;
        setReady(ready); setRecruitments(recruitments);
        if (recruitments.length === 1) setSelectedToken(recruitments[0].publicToken); // 1건이면 자동 선택
      })
      .catch(() => { if (!cancelled) { setReady(true); setRecruitments([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // 여러 건이면 사용자가 선택. 선택 전이면 recruitment=null → 선택 목록 표시.
  const recruitment = selectedToken ? recruitments.find((r) => r.publicToken === selectedToken) ?? null : null;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => { setForm((p) => ({ ...p, [key]: value })); setError(''); };
  const handleAffiliation = (val: Affiliation) => { setForm((p) => ({ ...p, affiliation: val, clubName: val === 'independent' ? '무소속' : '' })); setError(''); };

  const handleSubmit = async () => {
    if (submitting || !recruitment) return;
    if (!recruitment.canApply) { setError('신청이 마감되었습니다.'); return; }
    if (!form.name.trim()) { setError('이름을 입력해 주세요.'); return; }
    if (!form.phone.trim()) { setError('휴대폰 번호를 입력해 주세요.'); return; }
    if (!form.affiliation) { setError('소속 구분을 선택해 주세요.'); return; }
    if (!form.region.trim()) { setError('지역을 입력해 주세요.'); return; }
    if (!form.clubName.trim()) { setError('클럽명을 입력해 주세요.'); return; }
    if (!form.level) { setError('테니스 구력을 선택해 주세요.'); return; }
    if (!form.agreed) { setError('개인정보 수집·이용에 동의해 주세요.'); return; }
    setSubmitting(true); setError('');
    try {
      await submitGuestApplication({
        publicToken: recruitment.publicToken, name: form.name, phone: form.phone, region: form.region,
        affiliationType: form.affiliation, clubName: form.clubName, tennisExperience: form.level,
        bestResult: form.bestRecord, note: form.memo, privacyConsent: form.agreed,
      });
      setSubmitted(true);
    } catch (err: any) {
      if (err?.name === GUEST_SUBMIT_NOT_READY || String(err?.message) === GUEST_SUBMIT_NOT_READY) {
        setError('게스트 신청 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.');
      } else {
        setError(guestSubmitMessage(err));
      }
    } finally { setSubmitting(false); }
  };

  const LEVELS: Level[] = ['입문', '초급', '중급', '상급'];
  const inputStyle: React.CSSProperties = { width: '100%', height: 46, borderRadius: 11, border: '1.5px solid rgba(0,0,0,0.10)', backgroundColor: '#F8FAFC', padding: '0 13px', fontSize: 13, fontWeight: 500, color: '#1E293B', outline: 'none', boxSizing: 'border-box' };
  const chipBtn = (active: boolean): React.CSSProperties => ({ flex: 1, height: 38, borderRadius: 10, border: `1.5px solid ${active ? '#0D9488' : 'rgba(0,0,0,0.09)'}`, backgroundColor: active ? 'rgba(13,148,136,0.08)' : '#F8FAFC', color: active ? '#0D9488' : '#64748B', fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' });
  const isIndependent = form.affiliation === 'independent';

  return (
    <main style={{ width: '100%', backgroundColor: '#F2F4F7', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingTop: 16 }}>
          <Link href="/" aria-label="메인으로" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.09)', backgroundColor: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', textDecoration: 'none', flexShrink: 0 }}>
            <ChevronLeft size={17} strokeWidth={2.2} />
          </Link>
          <div>
            <p style={{ fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 8, fontWeight: 800, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#0D9488', margin: 0, lineHeight: 1.3 }}>TEYEON TENNIS CLUB</p>
            <p style={{ fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 16, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#0F172A', margin: 0, lineHeight: 1.2 }}>GUEST JOIN</p>
          </div>
        </div>

        {/* hero */}
        <div style={{ borderRadius: 16, backgroundColor: '#FFFFFF', border: '1px solid rgba(0,0,0,0.06)', borderTop: '2px solid #0D9488', boxShadow: '0 2px 10px rgba(0,0,0,0.055)', padding: '18px 20px 16px' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', margin: '0 0 6px', lineHeight: 1.4 }}>테니스로 이어진 인연.</p>
          <p style={{ fontSize: 12, fontWeight: 500, color: '#64748B', margin: 0, lineHeight: 1.65 }}>
            TEYEON Tennis Club에서 함께 칠 게스트를 모집합니다.<br />일정과 안내를 확인하고 신청해 주세요.
          </p>
        </div>

        {loading ? (
          <SectionCard><p style={{ margin: 0, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#94A3B8' }}>불러오는 중…</p></SectionCard>
        ) : !ready ? (
          <SectionCard>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <Clock size={34} strokeWidth={1.6} color="#0D9488" style={{ margin: '0 auto 10px' }} />
              <p style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>게스트 신청 준비 중</p>
              <p style={{ fontSize: 12, fontWeight: 500, color: '#64748B', margin: 0, lineHeight: 1.6 }}>게스트 모집 기능을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.</p>
            </div>
          </SectionCard>
        ) : recruitments.length === 0 ? (
          <SectionCard>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <CalendarDays size={34} strokeWidth={1.6} color="#94A3B8" style={{ margin: '0 auto 10px' }} />
              <p style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>현재 신청 가능한 게스트 모집이 없습니다</p>
              <p style={{ fontSize: 12, fontWeight: 500, color: '#64748B', margin: 0, lineHeight: 1.6 }}>새로운 게스트 모집이 열리면 이 페이지에서 안내드립니다.</p>
            </div>
          </SectionCard>
        ) : !recruitment ? (
          /* 여러 모집이 열려 있으면 참가할 정모 선택 */
          <SectionCard>
            <CardLabel>모집 중인 정모</CardLabel>
            <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 500, color: '#64748B', lineHeight: 1.6 }}>참가할 정모를 선택해 주세요.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recruitments.map((r) => (
                <button key={r.publicToken} type="button" onClick={() => setSelectedToken(r.publicToken)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: '1.5px solid rgba(0,0,0,0.10)', background: '#F8FAFC', cursor: 'pointer', font: 'inherit' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: '#0F172A', wordBreak: 'keep-all' }}>{r.title}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>
                    {formatDate(r.date)} · {formatTime(r)}{r.maxGuests != null ? ` · 게스트 ${r.maxGuests}명` : ''}{!r.canApply ? ' · 마감' : ''}
                  </span>
                </button>
              ))}
            </div>
          </SectionCard>
        ) : (
          <>
            {recruitments.length > 1 && (
              <button type="button" onClick={() => setSelectedToken(null)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#0D9488' }}>← 다른 정모 선택</button>
            )}
            {/* 모집 상태 */}
            <SectionCard>
              <CardLabel>모집 상태</CardLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 14, borderRight: '1px solid rgba(0,0,0,0.07)', flexShrink: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#16A34A', boxShadow: '0 0 0 3px rgba(22,163,74,0.18)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#16A34A', whiteSpace: 'nowrap' }}>OPEN</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1E293B', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recruitment.title}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 500, color: '#94A3B8', lineHeight: 1.4 }}>
                    {formatDate(recruitment.date)} · {formatTime(recruitment)}{recruitment.maxGuests != null ? ` · 게스트 ${recruitment.maxGuests}명` : ''}
                  </p>
                </div>
              </div>
            </SectionCard>

            {/* 모임 정보 */}
            <SectionCard>
              <CardLabel>모임 정보</CardLabel>
              <InfoRow icon={<CalendarDays size={14} />} label="날짜" value={formatDate(recruitment.date)} />
              <InfoRow icon={<Clock size={14} />} label="시간" value={formatTime(recruitment)} />
              <InfoRow icon={<MapPin size={14} />} label="장소" value={recruitment.location || '장소 추후 안내'} />
              {recruitment.maxGuests != null && <InfoRow icon={<Users size={14} />} label="모집 인원" value={`게스트 ${recruitment.maxGuests}명`} />}
              <InfoRow icon={<Info size={14} />} label="게스트비" value={formatFee(recruitment.guestFee)} last={!recruitment.publicMessage} />
              {recruitment.publicMessage && <InfoRow icon={<Info size={14} />} label="안내" value={recruitment.publicMessage} last />}
            </SectionCard>

            {/* TEYEON GUEST NOTE */}
            <SectionCard style={{ backgroundColor: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)' }}>
              <CardLabel>TEYEON GUEST NOTE</CardLabel>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {['KDK 경기는 기본 1:1 스코어에서 시작합니다.', '지각/불참 등 운영 기준에 따라 벌금이 발생할 수 있습니다.', '게스트는 당일 순위 집계에는 참여하지만, 상금 지급 대상에서는 제외됩니다.', '신청 후 운영진 확인을 거쳐 참여가 최종 확정됩니다.'].map((text, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, fontWeight: 500, color: '#64748B', lineHeight: 1.6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', flexShrink: 0, marginTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>{text}
                  </li>
                ))}
              </ul>
            </SectionCard>

            {submitted ? (
              <SectionCard>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '12px 0 8px' }}>
                  <CheckCircle2 size={48} strokeWidth={1.5} color="#0D9488" />
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>신청 완료</p>
                    <p style={{ fontSize: 12, fontWeight: 500, color: '#64748B', margin: 0, lineHeight: 1.65 }}>신청이 접수되었습니다. 운영진 확인 후 개별적으로 연락드릴게요.</p>
                  </div>
                  <div style={{ marginTop: 4, padding: '8px 18px', borderRadius: 99, backgroundColor: 'rgba(13,148,136,0.08)', border: '1px solid rgba(13,148,136,0.18)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} color="#0D9488" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#0D9488', letterSpacing: '0.04em' }}>상태: 확인 대기</span>
                  </div>
                </div>
              </SectionCard>
            ) : (
              <>
                <SectionCard>
                  <CardLabel>기본 정보</CardLabel>
                  <div style={{ marginBottom: 14 }}><FieldLabel required>이름</FieldLabel><input type="text" placeholder="이름을 입력해 주세요" value={form.name} onChange={(e) => setField('name', e.target.value)} style={inputStyle} /></div>
                  <div style={{ marginBottom: 14 }}><FieldLabel required>휴대폰 번호</FieldLabel><input type="tel" inputMode="numeric" placeholder="010-0000-0000" value={form.phone} onChange={(e) => setField('phone', e.target.value)} style={inputStyle} /></div>
                  <div style={{ marginBottom: 14 }}><FieldLabel required>지역</FieldLabel><input type="text" placeholder="예: 아산, 천안, 평택, 세종 등" value={form.region} onChange={(e) => setField('region', e.target.value)} style={inputStyle} /></div>
                  <div style={{ marginBottom: 14 }}>
                    <FieldLabel required>소속 구분</FieldLabel>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => handleAffiliation('club')} style={chipBtn(form.affiliation === 'club')}>클럽 소속</button>
                      <button type="button" onClick={() => handleAffiliation('independent')} style={chipBtn(form.affiliation === 'independent')}>무소속</button>
                    </div>
                  </div>
                  <div><FieldLabel required>클럽명</FieldLabel><input type="text" placeholder={isIndependent ? '무소속' : '소속 클럽명을 입력해 주세요'} value={form.clubName} onChange={(e) => !isIndependent && setField('clubName', e.target.value)} readOnly={isIndependent} style={{ ...inputStyle, backgroundColor: isIndependent ? 'rgba(0,0,0,0.04)' : '#F8FAFC', color: isIndependent ? '#94A3B8' : '#1E293B', cursor: isIndependent ? 'default' : 'text' }} /></div>
                </SectionCard>

                <SectionCard>
                  <CardLabel>테니스 정보</CardLabel>
                  <div style={{ marginBottom: 14 }}>
                    <FieldLabel required>테니스 구력</FieldLabel>
                    <div style={{ display: 'flex', gap: 6 }}>{LEVELS.map((lv) => <button key={lv} type="button" onClick={() => setField('level', lv)} style={chipBtn(form.level === lv)}>{lv}</button>)}</div>
                  </div>
                  <div><FieldLabel optional>대회 최고 성적</FieldLabel><input type="text" placeholder="예: 지역대회 8강, 입상 없음 등" value={form.bestRecord} onChange={(e) => setField('bestRecord', e.target.value)} style={inputStyle} />
                    <p style={{ margin: '5px 0 0', fontSize: 10, fontWeight: 500, color: '#94A3B8', lineHeight: 1.5 }}>운영진이 참가 레벨을 참고하기 위한 선택 정보입니다.</p></div>
                </SectionCard>

                <SectionCard>
                  <CardLabel>참여 정보</CardLabel>
                  <div style={{ marginBottom: 14 }}><FieldLabel optional>간단한 메모</FieldLabel>
                    <textarea placeholder="궁금한 점이나 전하실 말씀을 적어주세요." value={form.memo} onChange={(e) => setField('memo', e.target.value)} rows={3} style={{ width: '100%', borderRadius: 11, border: '1.5px solid rgba(0,0,0,0.10)', backgroundColor: '#F8FAFC', padding: '11px 13px', fontSize: 13, fontWeight: 500, color: '#1E293B', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }} /></div>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', marginBottom: 16 }}>
                    <input type="checkbox" checked={form.agreed} onChange={(e) => setField('agreed', e.target.checked)} style={{ marginTop: 2, accentColor: '#0D9488', width: 15, height: 15, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#64748B', lineHeight: 1.6 }}>
                      신청 정보(이름, 휴대폰 번호)는 운영진 확인 및 연락 목적으로만 사용됩니다.<br />
                      <strong style={{ color: '#475569' }}>개인정보 수집·이용에 동의합니다.</strong><span style={{ color: '#EF4444' }}> *</span>
                    </span>
                  </label>
                  {error && <p style={{ fontSize: 11, fontWeight: 600, color: '#EF4444', margin: '-8px 0 12px', lineHeight: 1.5 }}>{error}</p>}
                  <button type="button" onClick={handleSubmit} disabled={submitting || !recruitment.canApply}
                    style={{ width: '100%', height: 50, borderRadius: 14, backgroundColor: '#0D9488', border: 'none', fontSize: 14, fontWeight: 800, color: '#FFFFFF', cursor: (submitting || !recruitment.canApply) ? 'default' : 'pointer', opacity: (submitting || !recruitment.canApply) ? 0.6 : 1, boxShadow: '0 3px 12px rgba(13,148,136,0.22)', WebkitTapHighlightColor: 'transparent' }}>
                    {!recruitment.canApply ? '신청이 마감되었습니다' : submitting ? '신청 접수 중…' : '게스트 신청하기'}
                  </button>
                </SectionCard>
              </>
            )}
          </>
        )}

        <div style={{ height: 'var(--page-bottom-safe, 40px)' }} aria-hidden />
      </div>
    </main>
  );
}
