// MATCH SPOTLIGHT 표시용 선수 이름 — 길이 제한 시 끝의 게스트 표시 "(G)" 를 보존한다.
//   표시 전용. 선수 식별(회원·게스트 판정)에는 쓰지 않는다(엔진의 식별 입력은 기존 그대로).

export const PLAYER_NAME_MAX = 24;
const GUEST_MARK = /\s*\(G\)$/i;

export function clipPlayerName(v: unknown, max: number = PLAYER_NAME_MAX): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  if (!GUEST_MARK.test(s)) return s.slice(0, max);                 // 회원 등: 기존과 같은 단순 절단
  const base = s.replace(GUEST_MARK, '').trimEnd();
  return `${base.slice(0, Math.max(1, max - 4))}…(G)`;               // 예: 20자 + "…(G)" = 24자
}
