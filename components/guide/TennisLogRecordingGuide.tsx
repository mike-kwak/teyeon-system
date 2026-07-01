'use client';

// Guide & Recording — TENNIS LOG 회원용 가이드 촬영 섹션.
//   목적: 관리자/운영진이 각 촬영 항목을 확인하고, 해당 TENNIS LOG 화면으로 이동해 녹화 모드를 사용.
//   ⚠ TENNIS LOG 실제 기능(CRUD/캘린더)은 건드리지 않는다. 여기서는 "이동 + 녹화 상태 적용 + 촬영 완료 체크"만.
//   ⚠ 접근 제어는 Admin shell(canUseGuideRecording: CEO/ADMIN/OPERATOR/FINANCE_MANAGER)이 담당 — 여기서 확대하지 않음.
//   ⚠ TENNIS LOG 는 공통 쓰기 차단(guardWriteAction)을 적용하지 않으므로 녹화 모드에서도 실제 저장이 이뤄진다.
//     → 대회/레슨 작성·삭제 촬영의 "저장 허용 정책"은 미해결(하단 TODO). 이번 작업에서 쓰기 예외를 새로 만들지 않는다.

import React from 'react';
import { useRouter } from 'next/navigation';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import {
    NotebookPen, Play, Eye, CheckCircle2, Circle, Clock, ListOrdered,
    Info, AlertTriangle, Database, ShieldCheck,
} from 'lucide-react';

const COMPLETION_KEY = 'teyeon:guide:tennis-log:completion';

interface ShootItem {
    id: string;
    title: string;
    desc: string;
    path: string;
    length: string;
    flow: string[];
    narration: string[];
    cautions?: string[];
    example?: { label: string; value: string }[];
    /** 실제 저장이 필요한 항목(공통 쓰기 차단 정책 TODO 대상). */
    writeNeeded?: boolean;
}

const ITEMS: ShootItem[] = [
    {
        id: 'intro',
        title: 'TENNIS LOG 소개',
        desc: '진입 및 기능 소개',
        path: '/tennis-log',
        length: '8~12초',
        flow: [
            '메인 화면 진입',
            'TENNIS LOG 카드 선택',
            'TENNIS LOG 홈 진입',
            '개인 전용 안내 영역 확인',
            '대회 기록·레슨일지·기록 캘린더 영역 확인',
        ],
        narration: [
            '외부 대회 기록과 레슨일지를 남기는 개인 공간입니다.',
            'TEYEON 공식 KDK 기록과는 별도로 관리됩니다.',
            '기본적으로 본인만 확인할 수 있습니다.',
            '멤버 프로필과 자동으로 연결되지 않습니다.',
        ],
        cautions: [
            '실제 개인 회고가 노출되지 않도록 합니다.',
            '실제 회원 이름·파트너 평가가 보이지 않도록 합니다.',
            '관리자 버튼이나 개발용 문구를 숨깁니다.',
        ],
    },
    {
        id: 'tournament-create',
        title: '외부 대회 기록 작성',
        desc: '대회 기록 신규 작성 흐름',
        path: '/tennis-log/tournaments/new',
        length: '20~30초',
        writeNeeded: true,
        flow: [
            'TENNIS LOG 홈 진입',
            '대회 기록 추가 선택',
            '날짜 입력', '대회명 입력', '종목 및 참가 구분 입력', '파트너 입력',
            '최종 성적 입력', '한 줄 회고 및 선택 항목 입력', '저장',
            '목록에서 저장 결과 확인', '기록 캘린더에서 Gold dot 확인',
        ],
        narration: [
            '필수 정보만 빠르게 작성할 수 있습니다.',
            '경기별 결과와 자세한 회고는 선택 항목입니다.',
            '개인 회고와 파트너 관련 기록은 본인만 확인합니다.',
        ],
        example: [
            { label: '대회명', value: '아산 생활체육 테니스대회' },
            { label: '날짜', value: '촬영일 기준 최근 테스트 날짜' },
            { label: '종목', value: '남자 복식' },
            { label: '파트너', value: '테스트 파트너' },
            { label: '성적', value: '본선 16강' },
            { label: '회고', value: '리턴 방향과 포칭 타이밍을 더 맞춰보기' },
        ],
    },
    {
        id: 'lesson-create',
        title: '레슨일지 작성',
        desc: '레슨일지 신규 작성 흐름',
        path: '/tennis-log/lessons/new',
        length: '15~25초',
        writeNeeded: true,
        flow: [
            'TENNIS LOG 홈 진입', '레슨일지 작성 선택',
            '날짜 입력', '레슨 주제 입력', '배운 점 입력', '교정 포인트 입력', '연습 과제 입력', '저장',
            '목록에서 저장 결과 확인', '기록 캘린더에서 Aqua dot 확인',
        ],
        narration: [
            '레슨 내용을 잊기 전에 간단히 기록할 수 있습니다.',
            '교정 포인트와 다음 연습 과제를 남길 수 있습니다.',
            '과거 레슨 내용을 날짜별로 다시 확인할 수 있습니다.',
        ],
        example: [
            { label: '주제', value: '백핸드 리턴' },
            { label: '배운 점', value: '준비 동작을 더 빠르게' },
            { label: '교정 포인트', value: '임팩트 시 몸이 뒤로 빠지지 않기' },
            { label: '연습 과제', value: '크로스 리턴 반복 연습' },
        ],
    },
    {
        id: 'calendar',
        title: '기록 캘린더 사용',
        desc: '접기·펼치기·dot·핀 고정 흐름',
        path: '/tennis-log',
        length: '20~30초',
        flow: [
            'TENNIS LOG 홈 진입', '접힌 기록 캘린더 확인', '캘린더 보기 선택', '캘린더 펼침',
            '대회 Gold dot 확인', '레슨 Aqua dot 확인',
            '기록이 있는 날짜 선택', '선택 날짜의 기록 카드 확인',
            '이전 달 이동', '다음 달 이동', '오늘 이동',
            '핀 고정', '핀 해제', '캘린더 접기',
        ],
        narration: [
            '대회와 레슨 기록을 날짜별로 한눈에 확인할 수 있습니다.',
            'Gold dot은 대회 기록, Aqua dot은 레슨 기록입니다.',
            '핀 고정 시 다음 방문에도 캘린더가 펼쳐진 상태로 유지됩니다.',
            '핀을 해제해도 현재 화면은 열린 상태를 유지하고, 다음 방문부터 기본 접힘 상태로 돌아갑니다.',
        ],
    },
    {
        id: 'edit-delete',
        title: '기록 수정 및 삭제',
        desc: '기록 수정 후 삭제 흐름',
        path: '/tennis-log/tournaments',
        length: '10~15초',
        writeNeeded: true,
        flow: [
            '대회 또는 레슨 기록 상세 진입', '수정 선택', '일부 내용 변경', '저장', '수정 결과 확인',
            '삭제 선택', '삭제 확인', '목록과 캘린더에서 제거 여부 확인',
        ],
        narration: [
            '작성한 기록은 언제든지 수정할 수 있습니다.',
            '삭제한 기록은 목록과 기록 캘린더에서도 제거됩니다.',
        ],
        cautions: [
            '촬영용 테스트 기록만 삭제합니다.',
            '실제 회원 기록은 사용하지 않습니다.',
            '삭제 전 확인 과정이 영상에 포함되도록 합니다.',
        ],
    },
    {
        id: 'full-flow',
        title: '전체 사용 흐름',
        desc: '상단 미리보기/기능 소개용 종합 영상',
        path: '/tennis-log',
        length: '40~60초',
        writeNeeded: true,
        flow: [
            '메인에서 TENNIS LOG 진입', '대회 기록 작성', '레슨일지 작성',
            '기록 캘린더 펼치기', '날짜별 기록 확인', '홈으로 복귀',
        ],
        narration: [
            '전체 회원 가이드의 상단 미리보기 또는 기능 소개 영상으로 사용합니다.',
        ],
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

export default function TennisLogRecordingGuide() {
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
            <SectionTitle icon={<NotebookPen size={16} />}>
                TENNIS LOG (회원용 가이드)
                <Tag tone={hydrated && doneCount === ITEMS.length ? 'ok' : 'muted'}>
                    촬영 {hydrated ? doneCount : 0}/{ITEMS.length}
                </Tag>
            </SectionTitle>

            {/* 요약 / 상태 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <p style={{ margin: 0, flex: 1, minWidth: 240, fontSize: 12.5, fontWeight: 600, color: '#475569', lineHeight: 1.6 }}>
                    외부 대회 기록과 레슨일지 작성, 기록 캘린더 사용 흐름을 촬영합니다. 대상 표기: <b>회원용 가이드</b> · 진입 경로{' '}
                    <code style={codeStyle}>/tennis-log</code>
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={ghostBtn} onClick={() => openPreview('/tennis-log')}>
                        <Eye size={14} /> 미리보기
                    </button>
                    <button type="button" style={primaryBtn} onClick={() => openRecording('/tennis-log')}>
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

            {/* 저장 허용 정책 TODO */}
            <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: '#9A3412' }}>
                    <AlertTriangle size={13} /> 저장 허용 정책 — 미해결 TODO
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 10.5, fontWeight: 600, color: '#9A3412', lineHeight: 1.55 }}>
                    TENNIS LOG는 현재 공통 쓰기 차단(guardWriteAction)을 적용하지 않아, 촬영 모드에서도 <b>대회/레슨 작성·삭제가 실제로 저장·삭제됩니다</b>.
                    이번 작업은 <b>가이드 연결까지만</b> 구현했습니다. 작성/삭제 촬영은 <b>촬영 전용 테스트 계정</b> 또는 <b>촬영 후 정리</b> 방식을 별도로 정한 뒤 진행하세요.
                    (임의 쓰기 허용 예외를 새로 만들지 않았습니다.)
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

                            {it.writeNeeded && (
                                <p style={{ margin: '9px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: '#9A3412', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '5px 8px' }}>
                                    <Database size={12} /> 실제 저장 발생 — 촬영 전용 데이터만 사용(저장 정책 TODO)
                                </p>
                            )}

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

                            {/* 예시 데이터 */}
                            {it.example && (
                                <>
                                    <p style={miniLabel}><Database size={12} /> 촬영용 예시 데이터</p>
                                    <div style={{ margin: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        {it.example.map((e) => (
                                            <div key={e.label} style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.5 }}>
                                                <span style={{ flexShrink: 0, minWidth: 62, fontWeight: 800, color: '#64748B' }}>{e.label}</span>
                                                <span style={{ fontWeight: 700, color: '#334155', wordBreak: 'keep-all' }}>{e.value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

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
                촬영 완료 표시는 이 브라우저에만 저장되는 체크리스트이며 실제 데이터·권한을 바꾸지 않습니다.
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
