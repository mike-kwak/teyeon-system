// 공개 LIVE 탭 스위치(배포 환경 변수).
//   NEXT_PUBLIC_PUBLIC_LIVE_ENABLED=1 일 때만 Hub 의 LIVE 탭이 /tournaments/{slug}/live 로 열리고, 그 페이지가 영상을 보여 준다.
//   꺼져 있으면 LIVE 탭은 '대회 당일 공개'(기존 그대로)이고 /live 는 공개 전 안내만 한다.
//   ⚠ 예선 DRAW · 본선 스위치와 역할을 섞지 않는다. 운영진 화면(Admin LIVE 모니터)은 이 스위치와 무관하다.
export const PUBLIC_LIVE_ENABLED = process.env.NEXT_PUBLIC_PUBLIC_LIVE_ENABLED === '1';
