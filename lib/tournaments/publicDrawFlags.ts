// Public Preliminary DRAW 기능 스위치.
//
//   ⚠ add_hosted_tournament_public_draw.sql 이 운영 DB 에 적용되기 전에는 꺼 둔다.
//     꺼져 있으면 새 RPC(get_public_preliminary_draw · publish/unpublish · 공개 상태 조회)를
//     **호출하지 않는다** — 공개 Hub 의 DRAW 는 기존 '준비 중' 그대로, Admin 에는 공개 패널이 없다.
//   적용 · 검증이 끝나면 배포 환경 변수 NEXT_PUBLIC_PUBLIC_DRAW_ENABLED=1 로 켠다.
export const PUBLIC_DRAW_ENABLED = process.env.NEXT_PUBLIC_PUBLIC_DRAW_ENABLED === '1';
