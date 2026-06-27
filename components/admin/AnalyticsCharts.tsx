'use client';

// Admin Analytics 전용 경량 차트 — 외부 라이브러리 없이 SVG/CSS 로 구현(번들 영향 0).
//   원칙: 색상만으로 정보를 구분하지 않고 항상 라벨과 수치를 함께 표시한다.

import React from 'react';

const NAVY = '#0F1B33';
const BLUE = '#2563EB';
const TEAL = '#0E7C76';
const MUTED = '#94A3B8';

// ── 일별 추이 (Area + Line) ────────────────────────────────────────────────────
export function TrendChart({ data }: { data: { date: string; total: number; identified: number }[] }) {
    const W = 720, H = 200, padL = 34, padR = 12, padT = 14, padB = 26;
    const max = Math.max(1, ...data.map((d) => d.total));
    const n = data.length;
    const x = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
    const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);

    const linePath = (sel: (d: { total: number; identified: number }) => number) =>
        data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(sel(d)).toFixed(1)}`).join(' ');
    const areaPath = `${linePath((d) => d.total)} L ${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

    const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
    const labelEvery = Math.ceil(n / 8);

    return (
        <div style={{ width: '100%', overflow: 'hidden' }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="일별 활동 추이">
                {ticks.map((t, i) => {
                    const gy = y(t);
                    return (
                        <g key={i}>
                            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#EEF2F6" strokeWidth={1} />
                            <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={9} fill={MUTED}>{t}</text>
                        </g>
                    );
                })}
                <defs>
                    <linearGradient id="aTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BLUE} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#aTrend)" />
                <path d={linePath((d) => d.total)} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <path d={linePath((d) => d.identified)} fill="none" stroke={TEAL} strokeWidth={1.6} strokeDasharray="4 3" strokeLinejoin="round" />
                {data.map((d, i) => (i % labelEvery === 0 || i === n - 1) ? (
                    <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={MUTED}>{d.date.slice(5)}</text>
                ) : null)}
            </svg>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, paddingLeft: 6 }}>
                <Legend color={BLUE} label="총 활동" />
                <Legend color={TEAL} label="식별 사용자 활동" dashed />
            </div>
        </div>
    );
}

// ── 방문 추이 (3계열: 고유 방문자 / 페이지 조회 / 세션) ──────────────────────────
export function VisitorTrendChart({ data }: { data: { date: string; visitors: number; pageViews: number; sessions: number }[] }) {
    const W = 720, H = 210, padL = 34, padR = 12, padT = 14, padB = 26;
    const max = Math.max(1, ...data.map((d) => Math.max(d.visitors, d.pageViews, d.sessions)));
    const n = data.length;
    const x = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
    const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
    const line = (sel: (d: { visitors: number; pageViews: number; sessions: number }) => number) =>
        data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(sel(d)).toFixed(1)}`).join(' ');
    const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
    const labelEvery = Math.ceil(n / 8);
    return (
        <div style={{ width: '100%', overflow: 'hidden' }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="일별 방문 추이">
                {ticks.map((t, i) => {
                    const gy = y(t);
                    return (<g key={i}><line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#EEF2F6" /><text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={9} fill={MUTED}>{t}</text></g>);
                })}
                <path d={line((d) => d.pageViews)} fill="none" stroke="#94A3B8" strokeWidth={1.6} strokeLinejoin="round" />
                <path d={line((d) => d.sessions)} fill="none" stroke={TEAL} strokeWidth={1.6} strokeDasharray="4 3" strokeLinejoin="round" />
                <path d={line((d) => d.visitors)} fill="none" stroke={BLUE} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                {data.map((d, i) => (i % labelEvery === 0 || i === n - 1) ? (
                    <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={MUTED}>{d.date.slice(5)}</text>
                ) : null)}
            </svg>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, paddingLeft: 6, flexWrap: 'wrap' }}>
                <Legend color={BLUE} label="고유 방문자" />
                <Legend color="#94A3B8" label="페이지 조회" />
                <Legend color={TEAL} label="세션" dashed />
            </div>
        </div>
    );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#64748B' }}>
            <span style={{ width: 16, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
            {label}
        </span>
    );
}

// ── 가로 막대 (인기 메뉴 등) ────────────────────────────────────────────────────
export function HBarList({ rows, accent = BLUE }: { rows: { label: string; count: number }[]; accent?: string }) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 110, flexShrink: 0, fontSize: 12, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                    <div style={{ flex: 1, height: 18, borderRadius: 5, backgroundColor: '#F1F5FA', overflow: 'hidden' }}>
                        <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: accent, minWidth: r.count > 0 ? 4 : 0 }} />
                    </div>
                    <span style={{ width: 40, flexShrink: 0, textAlign: 'right', fontSize: 12, fontWeight: 800, color: NAVY }}>{r.count}</span>
                </div>
            ))}
        </div>
    );
}

// ── 세로 막대 (연령대) ─────────────────────────────────────────────────────────
export function VBars({ rows }: { rows: { label: string; count: number }[] }) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    const COLORS = [BLUE, '#3B82F6', TEAL, '#0EA5A0', '#CBD5E1'];
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150, paddingTop: 8 }}>
            {rows.map((r, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: NAVY }}>{r.count}</span>
                    <div style={{ width: '100%', maxWidth: 48, height: `${(r.count / max) * 100}%`, minHeight: r.count > 0 ? 6 : 2, borderRadius: '6px 6px 0 0', backgroundColor: COLORS[i % COLORS.length] }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textAlign: 'center', wordBreak: 'keep-all' }}>{r.label}</span>
                </div>
            ))}
        </div>
    );
}

// ── 도넛 (사용자 구성) ─────────────────────────────────────────────────────────
export function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const R = 52, C = 2 * Math.PI * R;
    let offset = 0;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <svg viewBox="0 0 140 140" width={130} height={130} role="img" aria-label="사용자 구성">
                <circle cx={70} cy={70} r={R} fill="none" stroke="#F1F5FA" strokeWidth={18} />
                {total > 0 && segments.map((s, i) => {
                    const len = (s.value / total) * C;
                    const el = (
                        <circle key={i} cx={70} cy={70} r={R} fill="none" stroke={s.color} strokeWidth={18}
                            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
                            transform="rotate(-90 70 70)" strokeLinecap="butt" />
                    );
                    offset += len;
                    return el;
                })}
                <text x={70} y={66} textAnchor="middle" fontSize={20} fontWeight={800} fill={NAVY}>{total}</text>
                <text x={70} y={84} textAnchor="middle" fontSize={10} fill={MUTED}>총 이벤트</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 130 }}>
                {segments.map((s, i) => {
                    const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
                    return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color, flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: NAVY }}>{s.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: NAVY }}>{s.value}</span>
                            <span style={{ width: 38, textAlign: 'right', fontSize: 11, fontWeight: 700, color: MUTED }}>{pct}%</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
