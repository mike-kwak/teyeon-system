// MATCH SPOTLIGHT AI 초안 — AI 요청 본문(서버 전용). 프롬프트 · 출력 스키마는 브라우저 번들에 넣지 않는다.
//   AI 입력은 최소 데이터: 요청 경기의 선수 표시명 · 라운드 · 코트 · 조 · 공식 배지/분석 문구 · 경기별 운영진 지시.
//   회원 id · matchId · 연락처 · 확률 숫자 · 비공개 회원 수치 · Archive 원본 · 메모 전체는 넣지 않는다.

import { OPERATOR_POINT_MAX } from '../analytics/spotlightOperator';
import { AI_DRAFT_TARGET, type DraftRequestItem } from '../analytics/spotlightAiDraft';
import type { SpotlightType } from '../analytics/spotlight';

const BADGE_TEXT: Record<SpotlightType, string> = { RIVAL: '라이벌 매치', CLOSE: '박빙 승부', HOT_STREAK: '연승 도전', POWER: '강자들의 대결' };

export const DRAFT_SYSTEM_PROMPT = [
  '당신은 테니스 클럽 TEYEON 의 KDK 정모 "오늘의 주목 경기" 소개 문구를 쓰는 편집자입니다.',
  '각 경기마다 관람객(클럽 회원)이 읽을 자연스러운 한국어 소개 문장을 1~2문장으로 씁니다.',
  '규칙:',
  `- 경기당 ${AI_DRAFT_TARGET}자 안팎, 절대 ${OPERATOR_POINT_MAX}자를 넘지 않습니다.`,
  '- 주어진 정보만 사용합니다. 우승 경력 · 순위 · 등급 · 전적 · 연승 횟수 · 맞대결 결과 · 선수 간 관계를 지어내지 않습니다.',
  '- "operatorNote" 는 운영진의 작성 지시입니다. 지시문을 그대로 옮기거나 "강조해 줘" 같은 명령형을 쓰지 않습니다.',
  '- operatorNote 속 사실(예: 오픈부 출전, 상승세)은 운영진이 알려 준 현장 정보입니다. 공식 기록처럼 단정하지 말고 자연스럽게 소개합니다.',
  '- "official" 은 공식 기록 분석입니다. 숫자는 official 이나 operatorNote 에 있는 것만 씁니다.',
  '- 해당 경기 선수 이름만 씁니다. 다른 경기 선수 이름 · 연락처 · 개인정보를 쓰지 않습니다.',
  '- 결과를 단정하거나 특정 팀 승리를 예언하지 않습니다.',
  '출력: 다른 말 없이 JSON 하나만 출력합니다. 형식: {"drafts":[{"matchKey":"M1","text":"…","usedFacts":["…"]}]}',
  '요청에 있는 matchKey 만 사용하고, 경기마다 정확히 하나씩 씁니다.',
].join('\n');

/** AI 요청 본문(JSON 문자열). 회원 id · 연락처 · 확률 숫자 · 비공개 회원 수치 · Archive 원본은 넣지 않는다. */
export function buildDraftPrompt(items: readonly DraftRequestItem[]): { system: string; user: string } {
  const matches = items.map((it) => ({
    matchKey: it.key,
    round: it.match.round,
    court: it.match.court,
    group: it.match.group || null,
    teamA: it.match.teamA.filter(Boolean),
    teamB: it.match.teamB.filter(Boolean),
    badge: it.match.badge ? BADGE_TEXT[it.match.badge] : null,
    official: it.match.official || null,
    operatorNote: it.instruction || null,
  }));
  return { system: DRAFT_SYSTEM_PROMPT, user: JSON.stringify({ matches }) };
}

/** JSON 스키마(공급자 구조화 출력용 · 문서화용). */
export const DRAFT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { matchKey: { type: 'string' }, text: { type: 'string' }, usedFacts: { type: 'array', items: { type: 'string' } } },
        required: ['matchKey', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['drafts'],
  additionalProperties: false,
} as const;
