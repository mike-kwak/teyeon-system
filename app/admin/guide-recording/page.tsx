'use client';

// TEYEON Admin — 가이드 및 촬영 (PC 전용 제어판).
//   공식 매뉴얼/홍보 영상 촬영용. 실제 Auth Role·RLS·DB 는 변경하지 않는다(UI 표현 전용).
//   접근 제어는 Admin shell(서버 middleware CEO/ADMIN + admin layout 가드)이 담당.

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { maskPhone, maskEmail, maskAccountNumber } from '@/lib/guide/masking';
import {
    Clapperboard, Play, UserCircle, Users, Globe, Crown, Square,
    Eye, EyeOff, Lock, ShieldCheck, MousePointer2, Phone, Mail, CreditCard,
    Monitor, Info, ExternalLink,
} from 'lucide-react';

const SHORTCUTS: { label: string; href: string; external?: boolean }[] = [
    { label: '메인', href: '/' },
    { label: 'TEYEON Calendar', href: '/calendar' },
    { label: 'KDK', href: '/kdk' },
    { label: 'Archive', href: '/archive' },
    { label: '개인 프로필', href: '/profile' },
    { label: '멤버 프로필', href: '/members' },
    { label: '공개 TEYEON', href: '/club' },
    { label: '정모 일정', href: '/club/schedule' },
];

const PREVIEW_ROLES: { key: 'ADMIN_ORIGINAL' | 'MEMBER' | 'GUEST' | 'PUBLIC'; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: 'ADMIN_ORIGINAL', label: '관리자 원본', icon: <Crown size={16} />, desc: '실제 관리자 화면(미리보기 없음)' },
    { key: 'MEMBER', label: '일반 회원', icon: <UserCircle size={16} />, desc: '회원 관점 · 관리자 버튼 숨김' },
    { key: 'GUEST', label: '게스트', icon: <Users size={16} />, desc: '게스트 관점 · Guest Pass 중심' },
    { key: 'PUBLIC', label: '공개 사용자', icon: <Globe size={16} />, desc: '비로그인 공개 관점' },
];

export default function GuideRecordingPage() {
    const { role } = useAuth();
    const g = useGuideRecording();

    return (
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            <header style={{ marginBottom: 18 }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.26em', color: '#2563EB' }}>TEYEON ADMIN</p>
                <h1 style={{ margin: '3px 0 0', fontSize: 24, fontWeight: 900, color: '#0F1B33', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Clapperboard size={22} style={{ color: '#0E7C76' }} /> 가이드 및 촬영
                </h1>
                <p style={{ margin: '5px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B' }}>
                    실제 데이터 변경 없이 회원·게스트·공개 사용자 화면을 미리보기하며 PC 화면을 촬영합니다.
                </p>
            </header>

            {/* 모바일: PC 권장 + 종료 */}
            <div className="lg:hidden" style={{ ...CARD, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: 'rgba(37,99,235,0.08)', color: '#2563EB', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Monitor size={17} /></span>
                    <div><p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F1B33' }}>PC 전용 기능</p><p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#64748B' }}>촬영 제어와 커서 강조는 PC에서만 사용할 수 있습니다.</p></div>
                </div>
                {(g.isPreviewMode || g.isRecordingMode) && (
                    <button type="button" onClick={g.endAllRecordingModes} style={{ ...dangerBtn, width: '100%' }}>현재 미리보기/녹화 종료</button>
                )}
            </div>

            {/* 데스크톱 전용 */}
            <div className="hidden lg:block">
                {/* 현재 상태 */}
                <section style={{ ...CARD, marginBottom: 14 }}>
                    <SectionTitle icon={<Info size={16} />}>현재 상태</SectionTitle>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                        <StatePill label="미리보기 역할" value={PREVIEW_ROLES.find((r) => r.key === g.previewRole)?.label || '관리자 원본'} on={g.isPreviewMode} />
                        <StatePill label="녹화 모드" value={g.isRecordingMode ? 'ON' : 'OFF'} on={g.isRecordingMode} />
                        <StatePill label="개인정보 마스킹" value={g.shouldMaskPrivateData ? 'ON' : 'OFF'} on={g.shouldMaskPrivateData} />
                        <StatePill label="쓰기 차단" value={g.isWriteBlocked ? '차단' : '허용'} on={g.isWriteBlocked} danger={g.isWriteBlocked} />
                        <StatePill label="커서 강조" value={g.isCursorHighlightEnabled ? 'ON' : 'OFF'} on={g.isCursorHighlightEnabled} />
                    </div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                    {/* 빠른 시작 */}
                    <section style={CARD}>
                        <SectionTitle icon={<Play size={16} />}>빠른 시작</SectionTitle>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <QuickBtn icon={<UserCircle size={15} />} label="회원용 촬영 시작" desc="MEMBER 미리보기 + 녹화 + 마스킹 + 쓰기차단 → 메인" onClick={g.startMemberRecording} />
                            <QuickBtn icon={<Users size={15} />} label="게스트용 촬영 시작" desc="GUEST 미리보기 → 공개 TEYEON" onClick={g.startGuestRecording} />
                            <QuickBtn icon={<Globe size={15} />} label="공개 사용자 촬영 시작" desc="PUBLIC 미리보기 → 공개 TEYEON" onClick={g.startPublicRecording} />
                            <QuickBtn icon={<Crown size={15} />} label="관리자 원본 보기" desc="미리보기 해제(녹화 옵션은 유지)" onClick={g.showAdminOriginal} subtle />
                            <button type="button" onClick={g.endAllRecordingModes} style={dangerBtn}><Square size={14} /> 모든 미리보기 종료</button>
                        </div>
                    </section>

                    {/* 권한 미리보기 */}
                    <section style={CARD}>
                        <SectionTitle icon={<Eye size={16} />}>권한 미리보기</SectionTitle>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {PREVIEW_ROLES.map((r) => {
                                const active = g.previewRole === r.key;
                                return (
                                    <button key={r.key} type="button" onClick={() => g.setPreviewRole(r.key)} aria-pressed={active}
                                        style={{
                                            textAlign: 'left', padding: '11px 12px', borderRadius: 11, cursor: 'pointer',
                                            border: `1.5px solid ${active ? '#0E7C76' : '#E3E9F2'}`,
                                            backgroundColor: active ? 'rgba(15,124,118,0.06)' : '#FFFFFF',
                                        }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 800, color: active ? '#0E7C76' : '#0F1B33' }}>{r.icon}{r.label}</span>
                                        <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.4 }}>{r.desc}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                </div>

                {/* 녹화 옵션 */}
                <section style={{ ...CARD, marginBottom: 14 }}>
                    <SectionTitle icon={<MousePointer2 size={16} />}>녹화 옵션</SectionTitle>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 28px' }}>
                        <Toggle label="녹화 모드" checked={g.isRecordingMode} onChange={g.setRecordingMode} />
                        <Toggle label="개인정보 마스킹" checked={g.optMask} onChange={g.setMask} />
                        <Toggle label="관리자 버튼 숨김" checked={g.optHideAdmin} onChange={g.setHideAdmin} />
                        <Toggle label="쓰기 차단" checked={g.optWriteBlock} onChange={g.setWriteBlock} danger />
                        <Toggle label="커서 하이라이트" checked={g.cursor.enabled} onChange={g.setCursorHighlight} />
                        <Toggle label="클릭 ripple" checked={g.cursor.ripple} onChange={g.setCursorRipple} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 14, paddingTop: 12, borderTop: '1px solid #F1F5FA' }}>
                        <Segmented label="커서 크기" value={g.cursor.size} options={[['sm', 'S'], ['md', 'M'], ['lg', 'L']]} onChange={(v) => g.setCursorSize(v as 'sm' | 'md' | 'lg')} />
                        <Segmented label="커서 색상" value={g.cursor.color} options={[['accent', 'TEYEON'], ['red', 'Red']]} onChange={(v) => g.setCursorColor(v as 'accent' | 'red')} />
                    </div>
                    <p style={{ margin: '12px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>커서 강조는 PC 마우스에서만 동작하며, 모바일·터치에서는 활성화되지 않습니다. reduced-motion 환경에서는 ripple이 생략됩니다.</p>
                </section>

                {/* 마스킹 미리보기 */}
                <section style={{ ...CARD, marginBottom: 14 }}>
                    <SectionTitle icon={<Lock size={16} />}>개인정보 마스킹 미리보기 {g.shouldMaskPrivateData ? <Tag tone="ok">적용 중</Tag> : <Tag tone="muted">미적용</Tag>}</SectionTitle>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                        <MaskDemo icon={<Phone size={14} />} label="전화번호" raw="010-1234-5678" masked={maskPhone('010-1234-5678')} on={g.shouldMaskPrivateData} />
                        <MaskDemo icon={<Mail size={14} />} label="이메일" raw="sample@example.com" masked={maskEmail('sample@example.com')} on={g.shouldMaskPrivateData} />
                        <MaskDemo icon={<CreditCard size={14} />} label="계좌번호" raw="123-456-789012" masked={maskAccountNumber('123-456-789012')} on={g.shouldMaskPrivateData} />
                    </div>
                    <p style={{ margin: '12px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>마스킹은 렌더링 단계에서만 적용되며 DB 값은 변경되지 않습니다. (적용 화면은 단계적으로 확대 예정)</p>
                </section>

                {/* 촬영 바로가기 */}
                <section style={{ ...CARD, marginBottom: 14 }}>
                    <SectionTitle icon={<ExternalLink size={16} />}>촬영 바로가기</SectionTitle>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {SHORTCUTS.map((s) => (
                            <Link key={s.href} href={s.href} style={shortcut}>{s.label}</Link>
                        ))}
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>현재 미리보기/녹화 상태를 유지한 채 해당 화면으로 이동합니다.</p>
                </section>

                {/* 촬영 보호 적용 현황 */}
                <section style={{ ...CARD, marginBottom: 14 }}>
                    <SectionTitle icon={<ShieldCheck size={16} />}>촬영 보호 적용 현황</SectionTitle>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <div>
                            <Tag tone="ok">완료</Tag>
                            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, fontWeight: 700, color: '#334155', lineHeight: 1.8 }}>
                                <li>정모 참석 · 댓글</li>
                                <li>Admin 설정 · 직책 · 권한</li>
                                <li>KDK / LIVE COURT</li>
                                <li>Archive (공식 기록)</li>
                                <li>Guest Pass 설정</li>
                                <li>일정 등록 · 수정 (Calendar)</li>
                            </ul>
                        </div>
                        <div>
                            <Tag tone="muted">후속</Tag>
                            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, fontWeight: 700, color: '#94A3B8', lineHeight: 1.8 }}>
                                <li>Finance</li>
                                <li>프로필 개인정보</li>
                            </ul>
                        </div>
                    </div>
                    <p style={{ margin: '12px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                        “완료” 화면은 촬영 보호 모드에서 운영 버튼이 숨겨지고 쓰기 동작이 차단됩니다. 전체 화면이 적용된 것은 아니므로 “모든 쓰기 차단”은 아닙니다.
                    </p>
                </section>

                {/* 안전 안내 */}
                <section style={{ ...CARD, borderLeft: '3px solid #0E7C76', backgroundColor: '#F6FBFA' }}>
                    <SectionTitle icon={<ShieldCheck size={16} />}>안전 안내</SectionTitle>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, fontWeight: 600, color: '#475569', lineHeight: 1.7 }}>
                        <li><b>권한 미리보기는 화면 촬영을 위한 UI 전용 기능</b>입니다. 실제 접근 권한과 데이터 보안은 Auth 및 Supabase RLS가 담당합니다.</li>
                        <li>실제 회원/게스트 권한 검증은 별도 테스트 계정으로 해야 합니다.</li>
                        <li>촬영 보호 모드에서는 <b>적용된 화면</b>의 쓰기 동작(저장·삭제 등)이 차단됩니다. 적용 범위는 단계적으로 확대되며, 모든 화면이 차단된 것은 아닙니다.</li>
                        <li>브라우저(탭) 종료 시 미리보기 상태는 초기화됩니다.</li>
                        <li>현재 로그인 역할: <b>{role || '—'}</b> (실제 역할은 변경되지 않습니다.)</li>
                    </ul>
                </section>
            </div>
        </div>
    );
}

// ── UI helpers ────────────────────────────────────────────────────────────────
const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };
const dangerBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, padding: '0 14px', borderRadius: 11, border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2', color: '#B91C1C', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' };
const shortcut: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 34, padding: '0 13px', borderRadius: 9, backgroundColor: '#F6F8FC', border: '1px solid #E3E9F2', color: '#334155', fontSize: 12, fontWeight: 800, textDecoration: 'none' };

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}><span style={{ color: '#0E7C76', display: 'inline-flex' }}>{icon}</span>{children}</h3>;
}
function StatePill({ label, value, on, danger }: { label: string; value: string; on: boolean; danger?: boolean }) {
    const color = danger && on ? '#B91C1C' : on ? '#0E7C76' : '#94A3B8';
    const bg = danger && on ? 'rgba(185,28,28,0.07)' : on ? 'rgba(15,124,118,0.07)' : '#F6F8FC';
    return (
        <div style={{ padding: '10px 12px', borderRadius: 10, backgroundColor: bg, border: '1px solid #E3E9F2', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, fontWeight: 900, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</p>
        </div>
    );
}
function QuickBtn({ icon, label, desc, onClick, subtle }: { icon: React.ReactNode; label: string; desc: string; onClick: () => void; subtle?: boolean }) {
    return (
        <button type="button" onClick={onClick} style={{
            display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '11px 13px', borderRadius: 11, cursor: 'pointer',
            border: `1px solid ${subtle ? '#E3E9F2' : '#99E0DA'}`, backgroundColor: subtle ? '#FFFFFF' : 'rgba(15,124,118,0.05)',
        }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: subtle ? '#F6F8FC' : 'rgba(15,124,118,0.12)', color: '#0E7C76' }}>{icon}</span>
            <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: '#0F1B33' }}>{label}</span>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.4 }}>{desc}</span>
            </span>
        </button>
    );
}
function Toggle({ label, checked, onChange, danger }: { label: string; checked: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
    const onColor = danger ? '#DC2626' : '#0E7C76';
    return (
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 0', cursor: 'pointer' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>{label}</span>
            <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
                style={{ position: 'relative', width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', backgroundColor: checked ? onColor : '#CBD5E1', transition: 'background-color .15s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 18, height: 18, borderRadius: '50%', backgroundColor: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }} />
            </button>
        </label>
    );
}
function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
    return (
        <div>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: '#64748B' }}>{label}</p>
            <div style={{ display: 'inline-flex', backgroundColor: '#F6F8FC', border: '1px solid #E3E9F2', borderRadius: 9, padding: 3, gap: 2 }}>
                {options.map(([v, l]) => {
                    const active = value === v;
                    return <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={active}
                        style={{ height: 28, padding: '0 13px', borderRadius: 7, border: 'none', cursor: 'pointer', backgroundColor: active ? '#0E7C76' : 'transparent', color: active ? '#fff' : '#475569', fontSize: 12, fontWeight: 800 }}>{l}</button>;
                })}
            </div>
        </div>
    );
}
function MaskDemo({ icon, label, raw, masked, on }: { icon: React.ReactNode; label: string; raw: string; masked: string; on: boolean }) {
    return (
        <div style={{ padding: '11px 12px', borderRadius: 10, backgroundColor: '#FBFCFE', border: '1px solid #E3E9F2' }}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: '#64748B' }}><span style={{ color: '#0E7C76' }}>{icon}</span>{label}</p>
            <p style={{ margin: '7px 0 0', fontSize: 14, fontWeight: 900, color: '#0F1B33', fontFeatureSettings: '"tnum"' }}>{on ? masked : raw}</p>
            <p style={{ margin: '2px 0 0', fontSize: 10, fontWeight: 600, color: '#B6C0CE' }}>원본: {raw}</p>
        </div>
    );
}
function Tag({ tone, children }: { tone: 'ok' | 'muted'; children: React.ReactNode }) {
    const c = tone === 'ok' ? { color: '#0E7C76', bg: 'rgba(15,124,118,0.10)' } : { color: '#94A3B8', bg: '#F1F5FA' };
    return <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: c.color, backgroundColor: c.bg, padding: '2px 8px', borderRadius: 999 }}>{children}</span>;
}
