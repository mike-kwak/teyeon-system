# TEYEON Claude Code 디자인 Polish Brief

이 문서는 Claude Code에게 TEYEON 앱 디자인 고도화를 맡길 때 사용하는 기준 문서입니다.

중요 원칙:

- 디자인 polish 작업은 **UI/레이아웃/스타일 정리**만 한다.
- Supabase 저장/조회, KDK 계산, Archive/Profile/Finance/Calendar 데이터 로직은 수정하지 않는다.
- commit/push 하지 않는다.

## 1. 전체 디자인 방향

TEYEON은 테니스 클럽 운영 앱이다.

- 클럽 정체성은 **블랙/골드 스포츠 클럽** 톤을 유지한다.
- 단, 모든 화면을 무조건 어둡게 만들지 않는다.
- 화면 목적에 따라 테마를 나눈다.

테마 구분:

- **Core Theme**: 스포츠 운영/기록/프로필 중심 화면
- **Utility Theme**: 정보 조회/관리/표/리포트 중심 화면

## 2. Core Theme

대상 화면:

- 메인
- KDK
- LIVE COURT
- 전광판
- Archive
- Profile

디자인 방향:

- 블랙/골드 유지
- 스포츠 앱 느낌 유지
- 카드 구분을 명확하게
- 버튼 스타일 통일
- 타이포그래피 정리
- 과한 네온, glow, text-shadow 금지
- 숫자와 선수명은 멀리서도 읽기 쉽게
- 모바일에서 터치 영역을 충분히 확보

주의:

- KDK 운영 화면은 실제 경기 중 빠르게 봐야 하므로 화려함보다 가독성과 터치감이 우선이다.
- LIVE COURT 카드 크기/spacing은 이미 안정화된 기준을 되도록 유지한다.

## 3. Utility Theme

대상 화면:

- 대회 캘린더
- 재무
- 관리자 설정
- 표/리포트 화면

디자인 방향:

- 라이트 배경 허용
- 문서형/대시보드형 UI
- 표 가독성 우선
- 기본 글자는 진한 검정/회색
- border는 연회색으로 명확하게
- 필요한 곳에만 골드 포인트 사용
- 표는 header, zebra stripe, grid line을 명확히
- 입력/선택/수정이 많은 화면은 업무 도구처럼 차분하게

주의:

- 캘린더와 재무는 정보형 화면이므로 블랙/골드 스포츠 톤을 과하게 강요하지 않는다.
- 정보 밀도가 높은 화면은 섹션 구분, 접기/펼치기, 표 구조를 우선한다.

## 4. 가장 중요한 디자인 QA: 첫 글자 잘림 방지

가장 우선적으로 확인해야 하는 문제:

> 둥근 카드 안에서 텍스트 앞부분이 잘리거나 삐져나오면 실패다.

반드시 해결할 것:

- rounded 카드 안에서 `KATO`, `KATA`, `KTA`, 선수 이름, 버튼 텍스트, badge 첫 글자가 잘리면 안 된다.
- `overflow-hidden`과 left accent line이 텍스트를 덮으면 안 된다.
- accent/icon 영역과 content 영역을 구조적으로 분리한다.
- content wrapper에 충분한 padding을 둔다.
- 단순히 `pl-*`만 계속 늘리지 말고 구조적으로 해결한다.
- badge에는 필요하면 `shrink-0`, `whitespace-nowrap`, `min-w-fit`을 적용한다.
- flex/grid 내부 텍스트 영역에는 `min-w-0`을 적용한다.
- 긴 텍스트는 필요한 곳에만 `truncate`, `line-clamp`, `text-ellipsis`를 적용한다.

모든 카드에서 확인:

- 메인 카드
- KDK 카드
- 캘린더 날짜 카드
- 대회 상세 카드
- 재무 카드
- Archive 카드
- Profile 카드
- 버튼형 pill
- badge

권장 구조 예:

```tsx
<div className="flex overflow-hidden rounded-2xl border">
  <div className="w-1.5 shrink-0 bg-amber-400" />
  <div className="min-w-0 flex-1 px-3 py-2">
    {/* badge / title / meta */}
  </div>
</div>
```

## 5. Claude Code에게 절대 금지할 것

아래는 디자인 polish 중 절대 수정하지 않는다.

- Supabase 저장/조회 로직 수정 금지
- KDK 점수/랭킹 계산 수정 금지
- KDK 생성/저장 payload 수정 금지
- Archive 공식 기록 계산 수정 금지
- Profile 통계 계산 수정 금지
- Finance 금액 계산/분류 로직 수정 금지
- Calendar DB/service 로직 수정 금지
- schema SQL 수정 금지
- RLS 정책 수정 금지
- commit/push 금지

위 항목이 필요해 보이면 직접 수정하지 말고 별도 이슈로 제안한다.

## 6. Claude Code에게 허용할 것

허용 범위:

- JSX 레이아웃 조정
- `className` / Tailwind 스타일 조정
- spacing 정리
- padding 정리
- radius 정리
- font-size 정리
- line-height 정리
- 카드 디자인 통일
- 버튼 디자인 통일
- badge 디자인 통일
- 섹션 구분 강화
- 모바일/PC 반응형 UI 개선
- safe-area padding 보강
- 빈 공간 정리
- 텍스트 overflow 방지

단, 기능 버튼은 사라지면 안 된다.

## 7. 우선 작업 순서

1. 메인 화면 리디자인
2. 모바일 대회 캘린더 UX 개선
3. Profile / Archive polish
4. Finance / Admin 업무형 UI 정리
5. 전광판 v2 디자인

## 8. 화면별 핵심 메모

### 메인

- 앱의 첫인상을 결정한다.
- 기능 카드 수를 과하게 늘리지 않는다.
- TEYEON MINI BOARD는 3줄 요약 중심으로 유지한다.
- AI 시드 예측 등 후순위 기능은 메인에서 과하게 강조하지 않는다.

### KDK / LIVE COURT

- 실제 운영자가 경기 중 사용한다.
- 버튼은 작아지면 안 된다.
- NOW PLAYING / WAITING 구분이 명확해야 한다.
- A조/GOLD, B조/BLUE 구분 유지.
- 카드 크기와 spacing을 무리하게 compact하게 만들지 않는다.

### 전광판

- 16:9 TV 전체화면 기준.
- 선수명, 점수, 랭킹이 넘치지 않아야 한다.
- 전체화면 버튼은 유지한다.
- 과한 glow 금지.

### Archive / Profile

- 공식 기록과 비공식 기록이 헷갈리지 않아야 한다.
- Profile은 공식 Archive 기반 KDK 기록을 읽기 쉽게 보여준다.
- 모바일에서 하단 nav에 마지막 카드가 가리지 않아야 한다.

### 대회 캘린더

- PC는 월간 캘린더 + 오른쪽 상세 패널 구조 유지.
- 모바일은 리스트 중심.
- 모바일 월간 보기는 보조 옵션.
- 라이트 테마 유지.
- 대회 카드 첫 글자 잘림을 반드시 확인.

### Finance

- 일반 회원용 복잡한 대시보드보다 관리자/재무 담당자 업무 도구가 핵심.
- 미납자 파악, 회원별 납부 현황, 확인 필요 거래 처리가 우선.
- 다크 화면에 검정 텍스트가 남으면 안 된다.
- 표와 입력폼 가독성이 중요하다.

### Admin

- members.role은 클럽 직책.
- profiles.role은 앱 권한.
- 이 둘이 UI에서 헷갈리지 않아야 한다.
- 앞으로 운영 대시보드가 될 수 있으므로 섹션 구조를 명확히 한다.

## 9. 확인 체크리스트

모바일:

- [ ] 하단 탭에 마지막 카드가 가리지 않는다.
- [ ] 상단 헤더 아래에서 콘텐츠가 자연스럽게 시작한다.
- [ ] 버튼이 너무 작지 않다.
- [ ] 긴 이름과 badge가 카드 밖으로 나가지 않는다.
- [ ] 폰 화면에서 한 화면 정보량이 과하지 않다.

PC:

- [ ] 캘린더가 화면 중앙에 자연스럽게 배치된다.
- [ ] 오른쪽 패널이 캘린더와 균형 있게 보인다.
- [ ] 표가 너무 좁거나 찌그러지지 않는다.
- [ ] 큰 화면에서 하단 모바일 nav가 어색하게 보이지 않는다.

텍스트:

- [ ] 카드 첫 글자가 잘리지 않는다.
- [ ] `KATO`, `KATA`, `KTA`, `LOCAL`, `NON-RANK` badge가 온전히 보인다.
- [ ] 선수 이름과 게스트 `(G)`가 잘리지 않는다.
- [ ] 버튼 텍스트가 줄바꿈되거나 사라지지 않는다.
- [ ] 다크 배경 위 검정 텍스트가 없다.

기능 보호:

- [ ] 기능 버튼이 사라지지 않았다.
- [ ] 등록/수정/삭제 버튼의 권한 조건이 유지된다.
- [ ] KDK 점수 입력/완료 버튼이 유지된다.
- [ ] Archive 공식 확정/해제 버튼이 유지된다.
- [ ] Finance 저장/확정/미수금 관리 버튼이 유지된다.

검증:

- [ ] `git diff --check`
- [ ] `npx.cmd tsc --noEmit`
- [ ] 가능하면 `npm.cmd run build`

