// 공개 본선 대진 기능 스위치 (Batch 4D-2).
//
//   ⚠ 예선 DRAW 스위치(NEXT_PUBLIC_PUBLIC_DRAW_ENABLED)와 역할을 섞지 않는다.
//     예선 공개와 본선 공개는 서로 다른 시점에 켜고 끈다.
//   ⚠ add_hosted_tournament_public_knockout.sql 이 운영 DB 에 적용되기 전에는 꺼 둔다.
//     꺼져 있으면 공개 RPC(get_public_knockout_bracket)를 **호출하지 않는다** —
//     공개 화면은 기존 '준비 중' 그대로, Admin 에는 공개 패널이 보이지 않는다.
//   ⚠ 4D-2 단계에서는 공개 렌더러가 아직 없다. Production 에서 켜지 않는다.
export const PUBLIC_KNOCKOUT_ENABLED = process.env.NEXT_PUBLIC_PUBLIC_KNOCKOUT_ENABLED === '1';
