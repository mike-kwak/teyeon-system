// TEYEON Admin Analytics — read model.
//   원칙: 가짜/추정 숫자 금지. app_logs(실제 기록 이벤트)와 members.age(실제 나이)만 집계한다.
//   현재 app_logs 에는 "페이지 방문" 로그가 없다(logAction 은 공지/댓글/권한변경 등 일부 행동만 기록).
//   → 방문 중심 지표(고유 방문자/총 방문/인기 조회 메뉴/재방문율)는 신뢰할 수 없어 "수집 필요"로 표시한다.
//   집계 단위는 "방문"이 아니라 "기록된 활동(이벤트)"임을 UI 라벨에서 명확히 한다.

import { supabase } from '@/lib/supabase';

// ── 기간 ─────────────────────────────────────────────────────────────────────
export type RangeKey = 'today' | '7d' | '30d' | 'month';

export interface AnalyticsRange {
    key: RangeKey;
    label: string;
    start: Date;
    end: Date; // exclusive
    days: number;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function buildRange(key: RangeKey, now: Date = new Date()): AnalyticsRange {
    const todayStart = startOfDay(now);
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    switch (key) {
        case 'today':
            return { key, label: '오늘', start: todayStart, end: tomorrow, days: 1 };
        case '7d': {
            const s = new Date(todayStart); s.setDate(s.getDate() - 6);
            return { key, label: '최근 7일', start: s, end: tomorrow, days: 7 };
        }
        case 'month': {
            const s = new Date(now.getFullYear(), now.getMonth(), 1);
            const days = Math.round((tomorrow.getTime() - s.getTime()) / 86400000);
            return { key, label: '이번 달', start: s, end: tomorrow, days };
        }
        case '30d':
        default: {
            const s = new Date(todayStart); s.setDate(s.getDate() - 29);
            return { key, label: '최근 30일', start: s, end: tomorrow, days: 30 };
        }
    }
}

const localDateKey = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── Asia/Seoul 기간 (방문 Analytics 전용) ─────────────────────────────────────
//   한국은 DST 가 없어 항상 UTC+9. 브라우저 TZ 와 무관하게 KST 날짜 경계로 집계한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** UTC instant → KST 날짜 키('YYYY-MM-DD'). */
export const kstDateKey = (iso: string | Date): string => {
    const t = (typeof iso === 'string' ? new Date(iso) : iso).getTime();
    const k = new Date(t + KST_OFFSET_MS); // UTC 필드가 KST 벽시계
    return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
};
/** KST 자정(날짜 d 00:00 KST)의 UTC instant. */
const kstMidnightUtc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m, d) - KST_OFFSET_MS);

/** Asia/Seoul 기준 기간. start/end 는 UTC instant(쿼리용), 일자 버킷은 KST 날짜. */
export function buildRangeKST(key: RangeKey, nowMs: number = Date.now()): AnalyticsRange {
    const kNow = new Date(nowMs + KST_OFFSET_MS); // UTC 필드 = KST 벽시계
    const y = kNow.getUTCFullYear(), m = kNow.getUTCMonth(), d = kNow.getUTCDate();
    const todayStart = kstMidnightUtc(y, m, d);
    const tomorrow = new Date(todayStart.getTime() + 86400000);
    switch (key) {
        case 'today':
            return { key, label: '오늘', start: todayStart, end: tomorrow, days: 1 };
        case '7d':
            return { key, label: '최근 7일', start: new Date(todayStart.getTime() - 6 * 86400000), end: tomorrow, days: 7 };
        case 'month': {
            const s = kstMidnightUtc(y, m, 1);
            return { key, label: '이번 달', start: s, end: tomorrow, days: Math.round((tomorrow.getTime() - s.getTime()) / 86400000) };
        }
        case '30d':
        default:
            return { key, label: '최근 30일', start: new Date(todayStart.getTime() - 29 * 86400000), end: tomorrow, days: 30 };
    }
}

// ── 경로 정규화 (instruction §6) ──────────────────────────────────────────────
//   동적 ID 포함 경로는 같은 메뉴로 묶고, /admin 은 일반 사용자 분석에서 제외(null 반환).
export function normalizeMenu(path: string | null | undefined): string | null {
    if (!path) return '메인';
    const p = path.split('?')[0].split('#')[0];
    if (p === '/') return '메인';
    if (p.startsWith('/admin')) return null; // 관리자 페이지 제외
    if (p.startsWith('/kdk/live') || p.startsWith('/kdk/display')) return 'LIVE COURT';
    if (p.startsWith('/kdk')) return 'KDK';
    if (p.startsWith('/club-schedule')) return '정모 상세';
    if (p.startsWith('/calendar')) return 'TEYEON Calendar';
    if (p.startsWith('/archive')) return 'Archive';
    if (p.startsWith('/members')) return '멤버 프로필';
    if (p.startsWith('/guest')) return 'Guest Pass';
    if (p.startsWith('/notice')) return '공지사항';
    if (p.startsWith('/finance')) return 'Finance';
    if (p.startsWith('/club')) return '공개 TEYEON';
    const seg = p.split('/').filter(Boolean)[0];
    return seg ? `/${seg}` : '메인';
}

// ── action 라벨/분류 ──────────────────────────────────────────────────────────
const AUDIT_ACTIONS = new Set(['role_changed', 'profile_role_changed']);
const ACTION_LABELS: Record<string, string> = {
    role_changed: '회원 권한 변경',
    profile_role_changed: '계정 권한 변경',
    notice_created: '공지 작성',
    notice_updated: '공지 수정',
    comment_posted: '댓글 작성',
    menu_click: '메뉴 이동(레거시)',
};
export const actionLabel = (a: string): string => ACTION_LABELS[a] || a || '기타';
export const isAuditAction = (a: string): boolean => AUDIT_ACTIONS.has(a);

// ── 주요 기능 사용량 후보 (instruction §7) ────────────────────────────────────
//   tracked=true 인 항목만 app_logs 로 실제 집계 가능. 나머지는 조회 로깅이 없어 "수집 필요".
export interface FeatureUsageRow {
    key: string;
    label: string;
    count: number | null; // null = 수집 필요
    tracked: boolean;
}

// ── 결과 타입 ─────────────────────────────────────────────────────────────────
export interface AnalyticsResult {
    ok: boolean;       // 쿼리 성공
    blocked: boolean;  // RLS 등으로 조회 차단
    totalEvents: number;
    identifiedUsers: number;   // user_id 가 있는 고유 사용자 수
    identifiedEvents: number;
    anonymousEvents: number;   // user_id 없음(공개/미식별)
    avgMenusPerUser: number | null; // 식별 사용자당 평균 활동 메뉴 수
    daily: { date: string; total: number; identified: number }[];
    topMenus: { menu: string; count: number }[];
    featureUsage: FeatureUsageRow[];
    eventTypes: { action: string; label: string; count: number; audit: boolean }[];
    auditEvents: number;       // 관리자 감사 이벤트 수(일반 사용 분석과 분리)
    lastEventAt: string | null;
    hasPageViewLogging: boolean; // page-view 로깅 존재 여부(현재 false 추정)
}

interface RawLog {
    user_id: string | null;
    path: string | null;
    action: string | null;
    created_at: string;
}

const FEATURE_TEMPLATE: { key: string; label: string; action?: string }[] = [
    { key: 'notice_created', label: '공지 작성', action: 'notice_created' },
    { key: 'notice_updated', label: '공지 수정', action: 'notice_updated' },
    { key: 'comment_posted', label: '댓글 작성', action: 'comment_posted' },
    { key: 'calendar_view', label: 'Calendar 조회' },
    { key: 'schedule_view', label: '정모 상세 조회' },
    { key: 'attendance_done', label: '참석 체크 완료' },
    { key: 'kdk_view', label: 'KDK 조회' },
    { key: 'live_view', label: 'LIVE COURT 조회' },
    { key: 'archive_view', label: 'Archive 조회' },
    { key: 'guest_view', label: 'Guest Pass 조회' },
];

export async function fetchAnalytics(range: AnalyticsRange): Promise<AnalyticsResult> {
    const empty = (blocked: boolean): AnalyticsResult => ({
        ok: !blocked, blocked,
        totalEvents: 0, identifiedUsers: 0, identifiedEvents: 0, anonymousEvents: 0,
        avgMenusPerUser: null, daily: [], topMenus: [], featureUsage: [], eventTypes: [],
        auditEvents: 0, lastEventAt: null, hasPageViewLogging: false,
    });

    let rows: RawLog[] = [];
    try {
        const { data, error } = await supabase
            .from('app_logs')
            .select('user_id, path, action, created_at')
            .gte('created_at', range.start.toISOString())
            .lt('created_at', range.end.toISOString())
            .order('created_at', { ascending: false })
            .limit(5000);
        if (error) return empty(true);
        rows = (data || []) as RawLog[];
    } catch {
        return empty(true);
    }

    // 일별 버킷(기간 전체를 0 으로 채운 시간축 — 조용한 날의 실제 0 이며 가짜값 아님).
    const dailyMap = new Map<string, { total: number; identified: number }>();
    for (let i = 0; i < range.days; i++) {
        const d = new Date(range.start); d.setDate(d.getDate() + i);
        dailyMap.set(localDateKey(d), { total: 0, identified: 0 });
    }

    const userIds = new Set<string>();
    const menuCount = new Map<string, number>();
    const actionCount = new Map<string, number>();
    const userMenus = new Map<string, Set<string>>();
    let identifiedEvents = 0;
    let anonymousEvents = 0;
    let auditEvents = 0;
    let lastEventAt: string | null = rows[0]?.created_at ?? null;

    for (const r of rows) {
        const bucket = dailyMap.get(localDateKey(new Date(r.created_at)));
        if (bucket) bucket.total++;
        const action = r.action || 'unknown';
        actionCount.set(action, (actionCount.get(action) || 0) + 1);
        if (isAuditAction(action)) auditEvents++;

        if (r.user_id) {
            identifiedEvents++;
            userIds.add(r.user_id);
            if (bucket) bucket.identified++;
            const menu = normalizeMenu(r.path);
            if (menu) {
                let set = userMenus.get(r.user_id);
                if (!set) { set = new Set(); userMenus.set(r.user_id, set); }
                set.add(menu);
            }
        } else {
            anonymousEvents++;
        }

        // 인기 "활동 경로" — /admin 제외, 동적 ID 묶음.
        const menu = normalizeMenu(r.path);
        if (menu) menuCount.set(menu, (menuCount.get(menu) || 0) + 1);
    }

    const topMenus = [...menuCount.entries()]
        .map(([menu, count]) => ({ menu, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const eventTypes = [...actionCount.entries()]
        .map(([action, count]) => ({ action, label: actionLabel(action), count, audit: isAuditAction(action) }))
        .sort((a, b) => b.count - a.count);

    const featureUsage: FeatureUsageRow[] = FEATURE_TEMPLATE.map((f) => ({
        key: f.key,
        label: f.label,
        tracked: Boolean(f.action),
        count: f.action ? (actionCount.get(f.action) || 0) : null,
    }));

    let totalDistinctMenus = 0;
    userMenus.forEach((s) => { totalDistinctMenus += s.size; });
    const avgMenusPerUser = userIds.size > 0 ? totalDistinctMenus / userIds.size : null;

    return {
        ok: true, blocked: false,
        totalEvents: rows.length,
        identifiedUsers: userIds.size,
        identifiedEvents,
        anonymousEvents,
        avgMenusPerUser,
        daily: [...dailyMap.entries()].map(([date, v]) => ({ date, total: v.total, identified: v.identified })),
        topMenus,
        featureUsage,
        eventTypes,
        auditEvents,
        lastEventAt,
        hasPageViewLogging: false,
    };
}

// ── 연령대 (instruction §8) — members.age(실제 INTEGER 나이)만 집계 ─────────────
export interface AgeResult {
    ok: boolean;
    buckets: { label: string; count: number }[];
    total: number;     // 전체 회원 수
    filled: number;    // age 입력된 회원 수
}

// ── analytics_events(2차 수집 기반) 방문 Analytics ──────────────────────────────
//   migration 적용 전: 'not_ready'. 적용+데이터: 'ok'. 적용+무데이터: 'empty'. 조회오류: 'error'.
//   INTERNAL(CEO/ADMIN) 은 일반 사용자 분석에서 제외. 고유 방문자 키 = auth_user_id || anonymous_id.

export type VisitorStatus = 'ok' | 'empty' | 'not_ready' | 'error';

export const MENU_LABELS: Record<string, string> = {
    home: '메인',
    calendar: 'TEYEON Calendar',
    club_schedule: '정모 상세',
    kdk: 'KDK',
    live_court: 'LIVE COURT',
    archive: 'Archive',
    member_profile: '멤버 프로필',
    guest_pass: 'Guest Pass',
    public_club: '공개 TEYEON',
    finance: 'Finance',
    notice: '공지사항',
};
export const menuLabel = (slug: string): string => MENU_LABELS[slug] || slug;

export interface VisitorAnalytics {
    status: VisitorStatus;
    uniqueVisitors: number;
    pageViews: number;
    sessions: number;
    avgPagesPerSession: number | null;
    returningRate: number | null;          // 0~1. null = 계산 불가
    returningLowConfidence: boolean;        // 수집 기간이 짧아 정확도 낮음
    userTypes: { type: string; count: number }[]; // MEMBER/GUEST/PUBLIC/UNKNOWN (INTERNAL 제외)
    topMenus: { slug: string; label: string; count: number }[];
    daily: { date: string; visitors: number; pageViews: number; sessions: number }[];
}

const VISITOR_TYPES = ['MEMBER', 'GUEST', 'PUBLIC', 'UNKNOWN'] as const;

/** analytics_events 가 조회 가능한지(테이블 존재 + RLS select 허용)만 빠르게 확인. */
export async function checkAnalyticsEventsReady(): Promise<boolean> {
    try {
        const { error } = await supabase.from('analytics_events').select('id', { count: 'exact', head: true }).limit(1);
        return !error;
    } catch {
        return false;
    }
}

interface RawEvent {
    event_name: string;
    normalized_path: string | null;
    auth_user_id: string | null;
    anonymous_id: string | null;
    session_id: string;
    user_type: string;
    created_at: string;
}

const isTableMissing = (err: { code?: string; message?: string } | null): boolean => {
    if (!err) return false;
    const code = err.code || '';
    const msg = (err.message || '').toLowerCase();
    return code === 'PGRST205' || code === '42P01' || msg.includes('does not exist') || (msg.includes('could not find the table') && msg.includes('analytics_events'));
};

/** 방문 KPI/추이/유형/인기메뉴. Asia/Seoul 날짜 버킷. INTERNAL 제외. */
export async function fetchVisitorAnalytics(range: AnalyticsRange): Promise<VisitorAnalytics> {
    const base: VisitorAnalytics = {
        status: 'not_ready', uniqueVisitors: 0, pageViews: 0, sessions: 0, avgPagesPerSession: null,
        returningRate: null, returningLowConfidence: false, userTypes: [], topMenus: [], daily: [],
    };

    let rows: RawEvent[];
    try {
        const { data, error } = await supabase
            .from('analytics_events')
            .select('event_name, normalized_path, auth_user_id, anonymous_id, session_id, user_type, created_at')
            .gte('created_at', range.start.toISOString())
            .lt('created_at', range.end.toISOString())
            .neq('user_type', 'INTERNAL')
            .limit(50000);
        if (error) return { ...base, status: isTableMissing(error) ? 'not_ready' : 'error' };
        rows = (data || []) as RawEvent[];
    } catch {
        return { ...base, status: 'error' };
    }

    if (rows.length === 0) return { ...base, status: 'empty' };

    // 일자 버킷(KST) 0 채움.
    const dayMap = new Map<string, { v: Set<string>; pv: number; s: Set<string> }>();
    for (let i = 0; i < range.days; i++) {
        const dk = kstDateKey(new Date(range.start.getTime() + i * 86400000));
        dayMap.set(dk, { v: new Set(), pv: 0, s: new Set() });
    }

    const visitors = new Set<string>();
    const sessions = new Set<string>();
    const typeCount = new Map<string, number>();
    const menuCount = new Map<string, number>();
    let pageViews = 0;

    for (const r of rows) {
        const vid = r.auth_user_id || r.anonymous_id || '';
        if (vid) visitors.add(vid);
        if (r.session_id) sessions.add(r.session_id);
        typeCount.set(r.user_type, (typeCount.get(r.user_type) || 0) + 1);

        const bucket = dayMap.get(kstDateKey(r.created_at));
        if (r.event_name === 'page_view') {
            pageViews++;
            if (r.normalized_path) menuCount.set(r.normalized_path, (menuCount.get(r.normalized_path) || 0) + 1);
            if (bucket) { bucket.pv++; if (vid) bucket.v.add(vid); if (r.session_id) bucket.s.add(r.session_id); }
        }
    }

    // 재방문율 — 기간 시작 이전에도 page_view 가 있던 방문자 비율.
    let returningRate: number | null = null;
    let returningLowConfidence = false;
    try {
        const { data: prior, error: priorErr } = await supabase
            .from('analytics_events')
            .select('auth_user_id, anonymous_id, created_at')
            .eq('event_name', 'page_view')
            .lt('created_at', range.start.toISOString())
            .neq('user_type', 'INTERNAL')
            .order('created_at', { ascending: true })
            .limit(50000);
        if (!priorErr && prior) {
            const priorSet = new Set<string>();
            let earliest: number | null = null;
            for (const p of prior as { auth_user_id: string | null; anonymous_id: string | null; created_at: string }[]) {
                const k = p.auth_user_id || p.anonymous_id;
                if (k) priorSet.add(k);
                const t = new Date(p.created_at).getTime();
                if (earliest === null || t < earliest) earliest = t;
            }
            if (visitors.size > 0) {
                let returningCount = 0;
                visitors.forEach((v) => { if (priorSet.has(v)) returningCount++; });
                returningRate = returningCount / visitors.size;
            }
            // 수집 시작이 기간 시작보다 7일 미만 앞이면 정확도 낮음으로 안내.
            if (earliest === null || range.start.getTime() - earliest < 7 * 86400000) returningLowConfidence = true;
        } else {
            returningLowConfidence = true; // 이전 데이터 없음/조회불가
        }
    } catch {
        returningLowConfidence = true;
    }

    const topMenus = [...menuCount.entries()]
        .map(([slug, count]) => ({ slug, label: menuLabel(slug), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

    const userTypes = VISITOR_TYPES
        .map((type) => ({ type, count: typeCount.get(type) || 0 }))
        .filter((t) => t.count > 0 || t.type === 'MEMBER' || t.type === 'PUBLIC'); // MEMBER/PUBLIC 은 0 도 표시

    return {
        status: 'ok',
        uniqueVisitors: visitors.size,
        pageViews,
        sessions: sessions.size,
        avgPagesPerSession: sessions.size > 0 ? pageViews / sessions.size : null,
        returningRate,
        returningLowConfidence,
        userTypes,
        topMenus,
        daily: [...dayMap.entries()].map(([date, v]) => ({ date, visitors: v.v.size, pageViews: v.pv, sessions: v.s.size })),
    };
}

export async function fetchAgeDistribution(): Promise<AgeResult> {
    try {
        // P0 개인정보 최소화: 연령(출생연도 '나이')은 관리자 전용 RPC 로 서버에서 버킷 집계만 받는다.
        //   (참고: 기존 select('age')는 존재하지 않는 컬럼이라 항상 실패해 ok:false 를 반환하고 있었음 —
        //    RPC 전환으로 '나이' 기반 집계가 정상 동작한다.)
        const { data, error } = await supabase.rpc('admin_age_distribution');
        if (!error && data && typeof data === 'object') {
            const d = data as { buckets?: { label: string; count: number }[]; total?: number; filled?: number };
            if (Array.isArray(d.buckets)) {
                return { ok: true, buckets: d.buckets, total: Number(d.total) || 0, filled: Number(d.filled) || 0 };
            }
        }
        // RPC 미적용/권한 없음 → 기존 동작과 동일하게 비표시(ok:false).
        return { ok: false, buckets: [], total: 0, filled: 0 };
    } catch {
        return { ok: false, buckets: [], total: 0, filled: 0 };
    }
}
