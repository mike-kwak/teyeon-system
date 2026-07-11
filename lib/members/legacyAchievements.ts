// 레거시 members.achievements(자유입력) → member_achievements 이관 후보 파서.
//   관리자 설정 '기존 입상 기록 가져오기' 도구 전용 — DB 를 직접 쓰지 않는다(파싱/중복판정만).
//   저장은 기존 createAchievement 경로 재사용, 원문(members.achievements)은 절대 수정/삭제하지 않음.
//
//   지원 형식(조사된 안전 규칙만, 자동 추정 금지):
//     "신인부 입상 | 23년 공주 무령왕배 준우승"
//     "신인부 우승 | 23년 임실치즈배 우승"
//     "신인부 입상 i 23년 비욘드배 공동3위"        ← '|' 오타 'i' 허용
//     "신인부 입상 | 무령왕배 공동3위, 25년 한산모시배 공동3위"  ← 쉼표 복수 기록(카테고리 상속)
//   자동 추정 금지: organization(원문 명시 시만) · 누락 연도 · 모호한 대회명 · 챌린저부 매핑.
import {
  ACHIEVEMENT_DIVISIONS,
  ACHIEVEMENT_ORGANIZATIONS,
  normalizeAchievementResult,
  type AchievementDivision,
  type AchievementOrganization,
  type AchievementResult,
  type MemberAchievement,
} from './achievements';

export interface LegacyAchievementCandidate {
  /** 멤버 원문 전체(무수정) */
  raw: string;
  /** 이 레코드에 해당하는 상세 문구 */
  detail: string;
  year: number | null;
  /** 원문에 KATO/KATA/KTA 가 명시된 경우만 — 그 외 null(추정 금지) */
  organization: AchievementOrganization | null;
  tournamentName: string;
  division: AchievementDivision | null;
  result: AchievementResult | null;
  /** 관리자 확인이 필요한 항목 안내(경고 배지) */
  warnings: string[];
}

const RESULT_WORDS = ['본선 진출', '본선진출', '공동 3위', '공동3위', '준우승', '16강', '4강', '8강', '우승', '입상'];
const normSpace = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

/** 자유입력 원문 → 이관 후보 목록. 파싱 실패 요소는 null + warnings 로 표시(임의 확정 금지). */
export function parseLegacyAchievements(raw: string): LegacyAchievementCandidate[] {
  const text = normSpace(raw);
  if (!text) return [];
  const baseWarnings: string[] = [];

  // organization — 원문 명시된 경우만 사용.
  const orgMatch = text.match(/\b(KATO|KATA|KTA)\b/i);
  const organization = orgMatch
    ? ((orgMatch[1].toUpperCase() as AchievementOrganization))
    : null;

  // "카테고리 | 상세" 분리. '|' 오타(' i ') 도 구분자로 허용.
  let categoryDivision: AchievementDivision | null = null;
  let detailPart = text;
  let m = text.match(/^(신인부|오픈부)\s*(?:우승|준우승|입상)\s*\|\s*(.+)$/);
  if (!m) {
    m = text.match(/^(신인부|오픈부)\s*(?:우승|준우승|입상)\s+i\s+(.+)$/i);
    if (m) baseWarnings.push("구분자 '|' 오타(' i ') — 원문 확인 권장");
  }
  if (m) {
    categoryDivision = m[1] as AchievementDivision;
    detailPart = m[2];
  } else {
    baseWarnings.push('카테고리(부서) 접두를 찾지 못했습니다 — 부서를 직접 선택해주세요.');
  }

  // 복수 기록: 쉼표/세미콜론/줄바꿈/불릿만 분리자('|' 는 레코드 분리자로 쓰지 않음). 카테고리 부서 상속.
  const parts = detailPart.split(/[,;\n•]+/).map(normSpace).filter(Boolean);

  return parts.map((part) => {
    const warnings = [...baseWarnings];
    let rest = part;

    // 연도: "23년" → 2023. 없으면 null(추정 금지) + 경고.
    let year: number | null = null;
    const ym = rest.match(/(?:^|\s)(\d{2})년\s*/);
    if (ym) {
      year = 2000 + parseInt(ym[1], 10);
      rest = normSpace(rest.replace(ym[0], ' '));
    } else {
      warnings.push('연도가 없습니다 — 연도를 선택해주세요.');
    }

    // 성적(꼬리 단어): 공동3위/4강/8강/16강/본선진출 → 입상 정규화.
    let result: AchievementResult | null = null;
    for (const w of RESULT_WORDS) {
      if (rest.endsWith(w)) {
        result = normalizeAchievementResult(w.replace(/\s+/g, ''));
        rest = normSpace(rest.slice(0, rest.length - w.length));
        break;
      }
    }
    if (!result) warnings.push('성적을 찾지 못했습니다 — 성적을 선택해주세요.');

    // 상세 내 부서 — 허용값(신인부/오픈부)이면 채택, 그 외(챌린저부 등)는 매핑 확정 금지.
    let division: AchievementDivision | null = categoryDivision;
    const dm = rest.match(/(신인부|오픈부|챌린저부|개나리부|국화부|베테랑부)\s*$/);
    if (dm) {
      rest = normSpace(rest.slice(0, rest.length - dm[0].length));
      if ((ACHIEVEMENT_DIVISIONS as readonly string[]).includes(dm[1])) {
        division = dm[1] as AchievementDivision;
      } else {
        division = null;
        warnings.push(`${dm[1]}를 신인부 또는 오픈부로 선택해주세요.`);
      }
    }

    // 대회명 = 잔여 문구(원문 명시 org 토큰 제거).
    const tournamentName = normSpace(rest.replace(/\b(KATO|KATA|KTA)\b/gi, ''));
    if (!tournamentName) warnings.push('대회명을 찾지 못했습니다 — 직접 입력해주세요.');
    else if (tournamentName.length <= 2) warnings.push(`대회명 '${tournamentName}' — 축약된 표기로 보입니다. 정식 대회명으로 수정해주세요.`);

    return { raw: text, detail: part, year, organization, tournamentName, division, result, warnings };
  });
}

/**
 * 중복(이미 이관됨) 판정 — 기존 member_achievements 와 정규화 키 비교.
 *   키: year + organization(대문자) + 대회명(공백 압축·소문자) + 부서 + 표준 성적.
 *   member_id 는 호출측이 해당 멤버의 목록만 전달하므로 키에 포함하지 않는다.
 */
export function isCandidateAlreadyImported(
  c: { year: number | null; organization: string | null; tournamentName: string; division: string | null; result: string | null },
  existing: Pick<MemberAchievement, 'year' | 'organization' | 'tournament_name' | 'division' | 'result'>[],
): boolean {
  if (c.year == null || !c.organization || !c.tournamentName || !c.division || !c.result) return false;
  const key = [
    c.year,
    c.organization.toUpperCase().trim(),
    normSpace(c.tournamentName).toLowerCase(),
    c.division.trim(),
    normalizeAchievementResult(c.result),
  ].join('|');
  return existing.some((a) =>
    [
      a.year ?? '',
      (a.organization || '').toUpperCase().trim(),
      normSpace(a.tournament_name).toLowerCase(),
      (a.division || '').trim(),
      normalizeAchievementResult(a.result),
    ].join('|') === key,
  );
}

/** UI 노출용 선택지 재노출(도구 화면에서 achievements.ts 와 동일 출처 사용 보장). */
export { ACHIEVEMENT_ORGANIZATIONS, ACHIEVEMENT_DIVISIONS };
