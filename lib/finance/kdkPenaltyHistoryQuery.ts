// KDK 누적 벌금 현황 — URL query 직렬화(순수 함수). ?type=member&period=year&from=&to=&q=

import type { PeriodPreset } from './kdkPenaltyHistoryModel';
import { readStatsView, type StatsView } from './kdkPenaltyStatsModel';

export type HistoryTab = 'all' | 'member' | 'guest';
export const HISTORY_TABS: HistoryTab[] = ['all', 'member', 'guest'];
export const PERIOD_PRESETS: PeriodPreset[] = ['year', '3m', '6m', 'all', 'custom'];

export interface HistoryQuery {
    tab: HistoryTab;
    period: PeriodPreset;
    from: string;
    to: string;
    q: string;
    /** 게스트 탭 보기: 'name'(동일 이름 묶음, 기본) | 'records'(세션별 기록). */
    gview: 'name' | 'records';
    /** V6 표시 방식(종합 · 금액 · 참가 · 벌금 횟수). 기본 종합. */
    view: StatsView;
}

/** 알 수 없는 값은 기본값(전체 · 올해)으로. */
export function readHistoryQuery(sp: { get(key: string): string | null } | null): HistoryQuery {
    const tab = (sp?.get('type') || 'all') as HistoryTab;
    const period = (sp?.get('period') || 'year') as PeriodPreset;
    return {
        tab: HISTORY_TABS.includes(tab) ? tab : 'all',
        period: PERIOD_PRESETS.includes(period) ? period : 'year',
        from: (sp?.get('from') || '').slice(0, 10),
        to: (sp?.get('to') || '').slice(0, 10),
        q: (sp?.get('q') || '').slice(0, 40),
        gview: sp?.get('gv') === 'records' ? 'records' : 'name',
        view: readStatsView(sp?.get('view')),
    };
}

/** 기본값은 URL 에서 생략(짧은 URL). from/to 는 직접 선택일 때만. */
export function historyQueryString(q: Partial<HistoryQuery>): string {
    const p = new URLSearchParams();
    if (q.tab && q.tab !== 'all') p.set('type', q.tab);
    if (q.period && q.period !== 'year') p.set('period', q.period);
    if (q.period === 'custom') {
        if (q.from) p.set('from', q.from);
        if (q.to) p.set('to', q.to);
    }
    if (q.q) p.set('q', q.q);
    if (q.tab === 'guest' && q.gview === 'records') p.set('gv', 'records');
    if (q.view && q.view !== 'summary') p.set('view', q.view);
    const s = p.toString();
    return s ? `?${s}` : '';
}
