// Finance → KDK 벌금 관리: 공식 KDK 세션 목록(읽기 전용).
//
//   - 출처: 공식 기록 teyeon_archive_v1 (Archive 와 같은 테이블, 같은 stable id = 세션 id).
//   - 공식·비테스트·KDK 세션만: is_official = true (서버 필터) + is_test 아님 + archive_type 'kdk'(없으면 kdk 로 간주).
//   - Archive 화면처럼 경기 스냅샷(snapshot_data)까지 받지 않고, 목록에 필요한 필드만 JSON 경로로 선택한다.
//   - 벌금 수치는 공식 Archive settlement_data 스냅샷 기준(새로 계산하지 않음 — 정산 화면과 같은 기준).
//   - 조회 실패는 예외로 던진다(빈 배열로 삼켜 "0건"으로 오인하지 않게).

import { supabase } from '../supabase';

const ARCHIVE_TBL = 'teyeon_archive_v1';

export interface KdkSessionListItem {
    /** teyeon_archive_v1.id — /finance/kdk/[sessionId] 로 그대로 전달. */
    id: string;
    /** 'YYYY-MM-DD' (raw_data.date, 없으면 created_at 날짜). */
    date: string | null;
    title: string;
    /** 참가자 수(settlement_data, 없으면 ranking_data 길이). 둘 다 없으면 null. */
    participantCount: number | null;
    /** 벌금 대상 인원(penalty_amount < 0). settlement 스냅샷이 없으면 null. */
    penaltyTargetCount: number | null;
    /** 그중 게스트 인원. */
    guestPenaltyCount: number | null;
    /** 벌금 합계(원, 양수). */
    penaltyTotal: number | null;
}

function toDate(raw: unknown, createdAt: unknown): string | null {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const c = String(createdAt || '');
    return /^\d{4}-\d{2}-\d{2}/.test(c) ? c.slice(0, 10) : null;
}

export async function listOfficialKdkSessions(): Promise<KdkSessionListItem[]> {
    const { data, error } = await supabase
        .from(ARCHIVE_TBL)
        .select('id, created_at, is_official, is_test, archive_type, date:raw_data->>date, title:raw_data->>title, settlement:raw_data->settlement_data, ranking:raw_data->ranking_data')
        .eq('is_official', true)
        .order('created_at', { ascending: false });
    if (error) {
        console.warn('[Finance/kdkSessionList]', error?.message ?? error);
        throw new Error(error?.message || 'KDK 세션 목록을 불러오지 못했습니다.');
    }

    const items: KdkSessionListItem[] = [];
    for (const row of (data || []) as any[]) {
        if (row?.is_official !== true || row?.is_test === true) continue;
        const type = String(row?.archive_type || 'kdk').toLowerCase();
        if (type !== 'kdk') continue;
        const settlement = Array.isArray(row?.settlement) ? row.settlement : null;
        const ranking = Array.isArray(row?.ranking) ? row.ranking : null;
        const penalties = settlement ? settlement.filter((e: any) => Number(e?.penalty_amount || 0) < 0) : null;
        items.push({
            id: String(row.id),
            date: toDate(row?.date, row?.created_at),
            title: String(row?.title || '').trim() || 'KDK 세션',
            participantCount: settlement ? settlement.length : ranking ? ranking.length : null,
            penaltyTargetCount: penalties ? penalties.length : null,
            guestPenaltyCount: penalties ? penalties.filter((e: any) => e?.is_guest === true).length : null,
            penaltyTotal: penalties ? penalties.reduce((sum: number, e: any) => sum + Math.abs(Math.trunc(Number(e?.penalty_amount || 0))), 0) : null,
        });
    }
    // 최신 날짜순(같은 날짜는 서버 created_at 내림차순 유지 — 안정 정렬).
    return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
