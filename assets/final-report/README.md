# FINAL REPORT OG 이미지 자산

`app/club/report/[slug]/og/route.tsx` 가 서버에서만 읽는다(공개 정적 경로 아님).

| 파일 | 내용 |
|---|---|
| `teyeon-crest-og.png` | `public/logos/teyeon-logo-transparent.png` 를 여백 제거 후 높이 360px 로 줄인 것(OG 렌더 속도용). |
| `NotoSansKR-ExtraBold-subset.ttf` | Noto Sans KR(가변 폰트 2.004)을 wght=800 정적 인스턴스로 만든 뒤 ASCII · 한글 음절 11,172자 · 호환 자모 · 일부 문장부호(· — ‘’ “” … ×)만 남긴 부분 집합. |

## 폰트 라이선스

Noto Sans KR — © 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
SIL Open Font License, Version 1.1 (https://openfontlicense.org) 로 배포된다. 이 부분 집합도 같은 라이선스를 따르며,
예약 글꼴 이름 'Source' 를 쓰지 않는다. 라이선스 전문: [OFL.txt](./OFL.txt)

재생성(fontTools):
```
python -m fontTools.varLib.instancer NotoSansKR-VF.ttf wght=800 --static -o inst800.ttf
python -m fontTools.subset inst800.ttf --unicodes="U+0020-007E,U+00B7,U+2013-2014,U+2018-201D,U+2026,U+00D7,U+3131-318E,U+AC00-D7A3" \
  --layout-features=kern --no-hinting --desubroutinize --output-file=NotoSansKR-ExtraBold-subset.ttf
```
