'use client';

// Guide & Recording — 회원 상대전적 확인(MEMBER용 촬영 모듈).
//   목적: 관리자/운영진이 상대전적 화면의 각 촬영 항목을 확인하고, 회원 관점으로 이동해 녹화.
//   ⚠ 상대전적은 "조회 전용" 화면이다 — 실제 저장/삭제/DB 변경이 없다(공통 쓰기 차단과 무관).
//   ⚠ 공식 KDK Archive 경기만 반영. 테스트·비공식·게스트 상대전적은 이번 범위 아님.
//   ⚠ 접근 제어는 Admin shell(canUseGuideRecording)이 담당 — 여기서 확대하지 않음.
//   ⚠ 이메일·전화번호·auth_user_id 등 개인정보는 화면에 노출되지 않는다(집계는 stable member id 기준).

import React from 'react';
import { useRouter } from 'next/navigation';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import {
    Swords, Play, Eye, CheckCircle2, Circle, Clock, ListOrdered,
    Info, ShieldCheck, Database, Lock,
} from 'lucide-react';

const COMPLETION_KEY = 'teyeon:guide:head-to-head:completion';

// 촬영 예시로 사용할 실제 회원(공식 KDK 기록이 존재하는 조합).
//   · 김병식 vs 김영호 = 3:3 동률(승패 반전 없는 균형 예시)
//   · 김병식 vs 구봉준 = 6:1(우세·A/B 교체 시 승률 반전 예시)
//   · 김병식 × 김재형 = 같은 팀 파트너 전적 예시(view=partner)
const H2H = '/ranking/head-to-head';
const EX_A = '38f05c6c-0410-4abe-bbf4-0cd18a89f5d6'; // 김병식
const EX_B = '21b0f073-551a-4d66-bbf6-a9620d930348'; // 김영호
const EX_C = 'b15208b7-8898-4135-a975-5844ef3811ba'; // 구봉준
const EX_D = 'f0967987-c117-4acb-90ae-2291b1165569'; // 김재형
const EX_PAIR = `${H2H}?memberA=${EX_A}&memberB=${EX_B}`;
const EX_SWAP = `${H2H}?memberA=${EX_A}&memberB=${EX_C}`;
const EX_PARTNER = `${H2H}?memberA=${EX_A}&memberB=${EX_D}&view=partner`;

// 공통 촬영 주의사항(개인정보·조회 전용·범위).
const COMMON_CAUTIONS = [
    '실제 회원 이름·프로필 사진은 그대로 노출해도 됩니다(공개 대상).',
    '이메일·전화번호·auth_user_id 등 식별 정보가 화면·개발자 도구에 보이지 않도록 합니다.',
    '조회 전용 기능이므로 실제 저장·삭제가 발생하지 않습니다.',
    '테스트·비공식 경기는 집계에 포함되지 않습니다.',
    '게스트 상대전적은 이번 촬영 범위가 아닙니다.',
];

interface ShootItem {
    id: string;
    title: string;
    desc: string;
    path: string;
    length: string;
    flow: string[];
    narration: string[];
    cautions?: string[];
}

const ITEMS: ShootItem[] = [
    {
        id: 'enter',
        title: 'Ranking에서 상대전적 진입',
        desc: 'Ranking 상단 진입 버튼 → 상대전적 화면',
        path: '/ranking',
        length: '8~12초',
        flow: [
            'Ranking 화면 진입',
            '상단 우측 “상대전적” 버튼 확인',
            '상대전적 버튼 선택',
            '상대전적 화면 진입',
            '공식 KDK 경기만 반영된다는 안내 문구 확인',
        ],
        narration: [
            '두 회원의 공식 맞대결 기록을 확인하는 화면입니다.',
            'TEYEON 공식 KDK 경기 기록만 반영됩니다.',
            '테스트·비공식 경기와 무승부는 집계에서 제외됩니다.',
        ],
        cautions: COMMON_CAUTIONS,
    },
    {
        id: 'select',
        title: '기준 회원 자동 선택 · 상대 선택',
        desc: '로그인 회원이 기준(A)로 자동 선택 → 상대(B) 검색·선택',
        path: H2H,
        length: '15~20초',
        flow: [
            '상대전적 화면 진입',
            '기준 회원(A)이 본인으로 자동 선택된 것 확인',
            '상대 회원(B) 선택 영역 선택',
            '검색창에 회원 이름 일부 입력',
            '목록에서 상대 회원 선택',
            '두 회원이 채워지며 결과가 표시되는 것 확인',
        ],
        narration: [
            '로그인한 회원이 기준 회원으로 자동 선택됩니다.',
            '상대 회원은 이름으로 검색해 선택할 수 있습니다.',
            '이미 선택한 회원은 상대 목록에서 제외됩니다.',
        ],
        cautions: COMMON_CAUTIONS,
    },
    {
        id: 'summary',
        title: '총 맞대결 · 승 · 패 · 승률 · 우세 확인',
        desc: '요약 카드(총 경기/기준 승/상대 승/승률) + 우세 회원',
        path: EX_PAIR,
        length: '12~18초',
        flow: [
            '두 회원 선택 완료 상태 확인',
            '총 맞대결 경기 수 확인',
            '기준 회원 승 · 상대 회원 승 확인',
            '기준 회원 관점 승률 확인',
            '우세 회원(또는 동률) 표시 확인',
        ],
        narration: [
            '총 맞대결 수와 각 회원의 승수를 한눈에 보여줍니다.',
            '승률은 기준 회원 관점으로 계산됩니다.',
            '두 회원이 서로 반대 팀으로 만난 공식 경기만 집계합니다.',
            '같은 팀(파트너)으로 함께 뛴 경기는 제외됩니다.',
        ],
        cautions: COMMON_CAUTIONS,
    },
    {
        id: 'recent',
        title: '최근 공식 경기 확인',
        desc: '최근 맞대결 5경기 + 전체 펼치기',
        path: EX_PAIR,
        length: '12~18초',
        flow: [
            '요약 아래 “최근 맞대결” 목록 확인',
            '경기별 날짜 · 세션 · 팀 구성 · 점수 확인',
            '기준 회원 관점 승/패 표시 확인',
            '“전체 N경기 보기” 선택',
            '전체 맞대결 목록 펼침 확인',
        ],
        narration: [
            '가장 최근 맞대결부터 순서대로 보여줍니다.',
            '각 경기의 팀 구성과 점수, 승패를 확인할 수 있습니다.',
            '전체 보기로 모든 맞대결 기록을 펼칠 수 있습니다.',
        ],
        cautions: COMMON_CAUTIONS,
    },
    {
        id: 'swap-card',
        title: 'A/B 교체 · 회원 카드 열기',
        desc: '기준/상대 교체 시 승률 반전 + 회원 프로필 카드',
        path: EX_SWAP,
        length: '15~22초',
        flow: [
            '우세가 뚜렷한 두 회원 선택 상태 확인(예: 6:1)',
            '기준/상대 교체(⇄) 선택',
            '승·패·승률이 관점에 맞게 반전되는 것 확인',
            '회원 사진 또는 이름 선택',
            '회원 프로필 카드가 열리는 것 확인',
            '카드 닫은 뒤 두 회원 선택이 유지되는 것 확인',
        ],
        narration: [
            '기준과 상대를 교체하면 승률이 관점에 맞게 반전됩니다.',
            '실제 우세 회원은 교체와 무관하게 동일합니다.',
            '회원 사진이나 이름을 누르면 프로필 카드가 열립니다.',
        ],
        cautions: COMMON_CAUTIONS,
    },
    {
        id: 'empty',
        title: '맞대결 없음 상태',
        desc: '공식 맞대결 기록이 없는 조합의 안내',
        path: H2H,
        length: '8~12초',
        flow: [
            '아직 맞대결이 없는 두 회원 선택',
            '“아직 공식 맞대결 기록이 없습니다” 안내 확인',
            '오류 없이 안내만 표시되는 것 확인',
        ],
        narration: [
            '공식 맞대결 기록이 없으면 안내 문구가 표시됩니다.',
            '기록이 쌓이면 자동으로 집계되어 나타납니다.',
        ],
        cautions: COMMON_CAUTIONS,
    },
    {
        id: 'partner',
        title: '파트너 전적 탭 (같은 팀 공동 성적)',
        desc: '상대 전적 ↔ 파트너 전적 탭 전환 · 공동 승·패·파트너 승률',
        path: EX_PARTNER,
        length: '20~28초',
        flow: [
            '같은 두 회원 선택 상태에서 “파트너 전적” 탭 선택',
            '회원 선택을 다시 하지 않고 탭만 전환되는 것 확인',
            '함께 출전한 경기 수 확인',
            '공동 승리 · 공동 패배 확인',
            '파트너 승률 확인',
            '최근 함께한 경기 확인(같은 팀 · 상대 팀 · 점수)',
            '“전체 경기 보기”로 전체 파트너 경기 펼치기',
            '“상대 전적” 탭으로 되돌아가 결과가 유지되는 것 확인',
            '(선택) 함께 뛴 적 없는 조합으로 “아직 함께 출전한 공식 경기 기록이 없습니다” 확인',
        ],
        narration: [
            '두 회원이 같은 팀으로 함께 뛴 공식 경기의 공동 성적입니다.',
            '함께한 경기, 공동 승리·패배, 파트너 승률을 보여줍니다.',
            '기준·상대 순서를 바꿔도 파트너 전적 결과는 동일합니다.',
            '같은 팀 경기만 집계하며, 서로 상대 팀이던 경기는 상대 전적에서 확인합니다.',
        ],
        cautions: COMMON_CAUTIONS,
    },
];

// ── 촬영 완료 상태(로컬 전용 체크리스트) ──────────────────────────────────────
type Completion = Record<string, { done: boolean; at: string }>;

function readCompletion(): Completion {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(COMPLETION_KEY);
        return raw ? (JSON.parse(raw) as Completion) : {};
    } catch {
        return {};
    }
}
function writeCompletion(next: Completion): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(COMPLETION_KEY, JSON.stringify(next));
    } catch {
        /* 저장 실패해도 화면은 정상 동작 */
    }
}
function todayStr(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function HeadToHeadRecordingGuide() {
    const router = useRouter();
    const g = useGuideRecording();
    const [completion, setCompletion] = React.useState<Completion>({});
    const [hydrated, setHydrated] = React.useState(false);

    React.useEffect(() => {
        setCompletion(readCompletion());
        setHydrated(true);
    }, []);

    // 회원 관점 미리보기(녹화 오버레이 없이 화면만) → 지정 화면 이동.
    const openPreview = (path: string) => {
        g.setPreviewRole('MEMBER');
        router.push(path);
    };
    // 촬영 모드로 열기 — 회원 미리보기 + 녹화 + 마스킹 + 관리자 UI 숨김 + 쓰기 차단 + 커서 강조 → 지정 화면.
    //   (상대전적은 조회 전용이라 쓰기 차단은 안전용이며 실제로 막을 저장 동작이 없다.)
    const openRecording = (path: string) => {
        g.setPreviewRole('MEMBER');
        g.setRecordingMode(true);
        g.setMask(true);
        g.setHideAdmin(true);
        g.setWriteBlock(true);
        g.setCursorHighlight(true);
        router.push(path);
    };

    const toggleDone = (id: string) => {
        setCompletion((prev) => {
            const wasDone = prev[id]?.done;
            const next: Completion = { ...prev, [id]: { done: !wasDone, at: todayStr() } };
            writeCompletion(next);
            return next;
        });
    };

    const doneCount = ITEMS.filter((it) => completion[it.id]?.done).length;
    const lastCheckedAt = Object.values(completion)
        .map((v) => v.at)
        .filter(Boolean)
        .sort()
        .pop();

    return (
        <section style={{ ...CARD, marginBottom: 14 }}>
            <SectionTitle icon={<Swords size={16} />}>
                회원 상대전적 확인 (회원용)
                <Tag tone={hydrated && doneCount === ITEMS.length ? 'ok' : 'muted'}>
                    촬영 {hydrated ? doneCount : 0}/{ITEMS.length}
                </Tag>
            </SectionTitle>

            {/* 요약 / 상태 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <p style={{ margin: 0, flex: 1, minWidth: 240, fontSize: 12.5, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
                    두 회원의 공식 KDK <b>상대 전적</b>(총·승·패·승률·우세)과 <b>파트너 전적</b>(같은 팀 공동 성적)을 탭으로 전환하며 확인하는 흐름을 촬영합니다. 대상 표기: <b>회원용</b> · 진입 경로{' '}
                    <code style={codeStyle}>/ranking</code> → <code style={codeStyle}>/ranking/head-to-head</code>
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={ghostBtn} onClick={() => openPreview('/ranking')}>
                        <Eye size={14} /> 미리보기
                    </button>
                    <button type="button" style={primaryBtn} onClick={() => openRecording('/ranking')}>
                        <Play size={14} /> 촬영 모드 시작
                    </button>
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
                <StatePill label="가이드 연결" value="완료" on />
                <StatePill label="촬영 준비" value="준비됨" on />
                <StatePill
                    label="촬영 완료"
                    value={hydrated ? (doneCount === ITEMS.length ? '완료' : `${doneCount}/${ITEMS.length}`) : '—'}
                    on={hydrated && doneCount === ITEMS.length}
                />
                <StatePill label="마지막 확인일" value={hydrated ? (lastCheckedAt || '—') : '—'} on={!!lastCheckedAt} />
            </div>

            {/* 조회 전용 안내 */}
            <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, backgroundColor: '#F0FDF9', border: '1px solid #99E0DA' }}>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: '#0E7C76' }}>
                    <Lock size={13} /> 조회 전용 · 저장 없음
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 10.5, fontWeight: 600, color: '#0E7C76', lineHeight: 1.55 }}>
                    상대전적은 <b>공식 KDK Archive 경기만</b> 읽어 계산하는 조회 화면입니다. 촬영 중 <b>실제 저장·삭제·DB 변경이 발생하지 않으며</b>,
                    이메일·전화번호·auth_user_id 등 개인정보는 화면에 표시되지 않습니다. 테스트·비공식·게스트 상대전적은 이번 범위가 아닙니다.
                </p>
            </div>

            {/* 촬영 항목 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {ITEMS.map((it, idx) => {
                    const done = !!completion[it.id]?.done;
                    return (
                        <div key={it.id} style={{ ...CARD, padding: 14, borderColor: done ? '#99E0DA' : '#E3E9F2' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}>
                                        <span style={{ color: '#94A3B8', marginRight: 6 }}>{idx + 1}.</span>
                                        {it.title}
                                    </p>
                                    <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{it.desc}</p>
                                </div>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#0E7C76', backgroundColor: 'rgba(15,124,118,0.08)', padding: '4px 9px', borderRadius: 999 }}>
                                    <Clock size={12} /> {it.length}
                                </span>
                            </div>

                            {/* 추천 촬영 순서 */}
                            <p style={miniLabel}><ListOrdered size={12} /> 추천 촬영 순서</p>
                            <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
                                {it.flow.map((step, i) => (
                                    <li key={i}>{step}</li>
                                ))}
                            </ol>

                            {/* 핵심 설명 */}
                            <p style={miniLabel}><Info size={12} /> 핵심 설명 문구</p>
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
                                {it.narration.map((n, i) => (
                                    <li key={i}>{n}</li>
                                ))}
                            </ul>

                            {/* 주의사항 */}
                            {it.cautions && (
                                <>
                                    <p style={{ ...miniLabel, color: '#9A3412' }}><ShieldCheck size={12} /> 주의사항</p>
                                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 11, fontWeight: 600, color: '#9A3412', lineHeight: 1.6 }}>
                                        {it.cautions.map((c, i) => (
                                            <li key={i}>{c}</li>
                                        ))}
                                    </ul>
                                </>
                            )}

                            {/* 액션 */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #F1F5FA' }}>
                                <button type="button" style={ghostBtn} onClick={() => openPreview(it.path)}>
                                    <Eye size={13} /> 미리보기
                                </button>
                                <button type="button" style={primaryBtn} onClick={() => openRecording(it.path)}>
                                    <Play size={13} /> 촬영 모드로 열기
                                </button>
                                <button
                                    type="button"
                                    onClick={() => toggleDone(it.id)}
                                    aria-pressed={done}
                                    style={done ? doneBtn : todoBtn}
                                >
                                    {done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                                    {done ? '완료 표시 해제' : '촬영 완료 표시'}
                                </button>
                            </div>
                            {done && completion[it.id]?.at && (
                                <p style={{ margin: '7px 0 0', fontSize: 10, fontWeight: 700, color: '#0E7C76' }}>
                                    촬영 완료 · 확인일 {completion[it.id].at}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>

            <p style={{ margin: '12px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.55 }}>
                “촬영 모드로 열기”는 현재 창의 미리보기/녹화 상태를 회원 관점 + 녹화 + 마스킹 + 관리자 UI 숨김 + 쓰기 차단으로 설정한 뒤 해당 화면으로 이동합니다.
                상대전적은 조회 전용이라 실제 저장은 발생하지 않으며, 촬영 완료 표시는 이 브라우저에만 저장되는 체크리스트입니다.
            </p>
        </section>
    );
}

// ── 스타일/보조 (guide-recording 페이지 디자인과 동일 계열) ──────────────────
const CARD: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: 14, border: '1px solid #E3E9F2', boxShadow: '0 1px 3px rgba(15,27,51,0.05)', padding: 16 };
const codeStyle: React.CSSProperties = { backgroundColor: '#F1F5FA', border: '1px solid #E3E9F2', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 800, color: '#334155' };
const miniLabel: React.CSSProperties = { margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: '#64748B' };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: 'none', backgroundColor: '#0E7C76', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const doneBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: '1px solid #99E0DA', backgroundColor: 'rgba(15,124,118,0.08)', color: '#0E7C76', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const todoBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: '1px solid #E3E9F2', backgroundColor: '#F6F8FC', color: '#64748B', fontSize: 12, fontWeight: 800, cursor: 'pointer' };

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 900, color: '#0F1B33' }}><span style={{ color: '#0E7C76', display: 'inline-flex' }}>{icon}</span>{children}</h3>;
}
function StatePill({ label, value, on }: { label: string; value: string; on: boolean }) {
    const color = on ? '#0E7C76' : '#94A3B8';
    const bg = on ? 'rgba(15,124,118,0.07)' : '#F6F8FC';
    return (
        <div style={{ padding: '10px 12px', borderRadius: 10, backgroundColor: bg, border: '1px solid #E3E9F2', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, fontWeight: 900, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</p>
        </div>
    );
}
function Tag({ tone, children }: { tone: 'ok' | 'muted'; children: React.ReactNode }) {
    const c = tone === 'ok' ? { color: '#0E7C76', bg: 'rgba(15,124,118,0.10)' } : { color: '#94A3B8', bg: '#F1F5FA' };
    return <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: c.color, backgroundColor: c.bg, padding: '2px 8px', borderRadius: 999 }}>{children}</span>;
}
