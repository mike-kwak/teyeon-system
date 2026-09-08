// TEYEON 공식 로고 마스터 빌드 — 원본 1장 → 공통 asset 2종 + favicon.ico 2종.
//
//   실행:  node scripts/build-logo-assets.mjs
//   이후:  node scripts/generate-icons.mjs   ← PWA/apple-touch/favicon PNG 5종 재생성
//
// 왜 스크립트인가:
//   · 로고 교체는 "원본 PNG 1장 교체 → 이 스크립트 → generate-icons" 로 끝나야 한다.
//     화면마다 복사본을 두지 않기 위한 단일 asset 경로 관리의 실행 수단.
//   · 새 원본은 흰 배경 불투명 PNG 라 그대로 쓰면 어두운 표면(/club 히어로, Guest Pass 카드)에
//     흰 사각형이 생긴다. 배경 제거가 반드시 선행돼야 한다.
//
// 배경 제거 방식(중요):
//   흰색 "색상 키잉"이 아니라 테두리에서 시작하는 flood fill(배경 연결성분)이다.
//   방패 안쪽의 흰 글자("Team"/"TEYEON"/"2024")와 흰 테두리는 배경과 연결돼 있지 않으므로
//   그대로 보존된다. 색상 키잉을 쓰면 글자에 구멍이 뚫린다.
//   경계 안티에일리어싱 픽셀은 흰색 혼합분을 역산해 alpha 로 복원(흰 테두리 잔상 방지).
//
// 기하 정규화(중요):
//   Splash(SignatureServe) / Guest Pass Intro 는 날아온 테니스공을 "로고 속 노란 공" 위치에
//   착지시킨다(--ball-dx-ratio / --ball-dy-ratio, 손으로 튜닝된 값).
//   따라서 새 로고를 교체 전 asset 과 **동일한 픽셀 기하**(캔버스 크기 · 방패 높이 · 공 중심 좌표)로
//   맞춰 출력한다. 그래야 CSS/JS 좌표를 한 줄도 건드리지 않고 교체가 끝난다.
//   TARGET 값은 교체 직전 레거시 asset 을 실측한 값이다(아래 주석 참조).
//
// 로고 자체는 변형하지 않는다 — 균등 배율만 적용(비율 왜곡 없음), 색/텍스트/형태 무변경.

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 공식 로고 원본(단일 소스, git 추적 대상).
 *   로고를 바꾸려면 이 파일만 교체하고 스크립트를 재실행한다.
 *   ⚠️ 임시 파일명(예: 루트의 'new logo.png')에 의존하지 말 것 — 빌드 재현이 깨진다.
 *   이 경로는 public/ 아래라 정적 서빙은 되지만 앱 어디에서도 참조하지 않는다
 *   (화면이 쓰는 것은 아래 TARGETS 가 생성하는 transparent / current 두 파일뿐).
 */
const SRC = 'public/logos/source/teyeon-logo-source.png';

/**
 * 원본 바깥 테두리의 회색 아티팩트(1~6px)를 잘라낸다.
 * 방패는 x 75~940 / y 31~963 에 있으므로 6px inset 은 항상 안전.
 */
const SRC_INSET = 6;

/** 배경으로 간주할 밝기 하한(RGB 각 채널). 방패 네이비/노랑과 충분히 떨어져 있다. */
const BG_MIN = { r: 235, g: 235, b: 232 };

/** 안티에일리어싱 alpha 역산에 쓰는 배경 흰색 기준값(원본 실측 ≈ 254). */
const WHITE_REF = 254;

/**
 * 출력 대상 — 교체 직전 레거시 asset 실측 기하.
 *   teyeon-logo-transparent.png : 1254x1254, 방패 bbox y 16~1121(h=1106), 공 중심 (626.5, 728.2)
 *   teyeon-logo-current.png     :  147x142,  방패 bbox y  6~138 (h= 133), 공 중심 ( 71.9,  90.8)
 * shieldH 로 균등 배율을 정하고, ballX/ballY 로 위치를 맞춘다.
 */
const TARGETS = [
  {
    out: 'public/logos/teyeon-logo-transparent.png',
    canvasW: 1254, canvasH: 1254, shieldH: 1106, ballX: 626.5, ballY: 728.2,
  },
  {
    // A안: 소형 variant 도 투명 배경으로 통일(레거시는 불투명 흰 배경이었다).
    out: 'public/logos/teyeon-logo-current.png',
    canvasW: 147, canvasH: 142, shieldH: 133, ballX: 71.9, ballY: 90.8,
  },
];

/** favicon.ico — sharp 는 ICO 를 못 쓰므로 PNG 엔트리를 직접 컨테이너에 담는다. */
const ICO_BG = { r: 255, g: 253, b: 248, alpha: 1 }; // generate-icons.mjs 와 동일한 크림 배경
const ICO_RATIO = 0.86;                              // 아이콘 폭 대비 로고 폭
const ICO_TARGETS = [
  { out: 'app/favicon.ico',    sizes: [16, 32, 48, 256] }, // Next app-router 가 /favicon.ico 로 서빙
  { out: 'public/favicon.ico', sizes: [32] },              // 레거시 fallback(기존 구조 유지)
];

// ── 1. 배경 제거 ────────────────────────────────────────────────────────────

async function makeTransparent(srcPath) {
  const meta = await sharp(srcPath).metadata();
  const { data, info } = await sharp(srcPath)
    .extract({
      left: SRC_INSET, top: SRC_INSET,
      width: meta.width - 2 * SRC_INSET, height: meta.height - 2 * SRC_INSET,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;
  const at = (x, y) => (y * w + x) * 4;
  const isBgish = (x, y) => {
    const i = at(x, y);
    return data[i] > BG_MIN.r && data[i + 1] > BG_MIN.g && data[i + 2] > BG_MIN.b;
  };

  // 테두리에서 시작하는 flood fill — 배경 연결성분만 마킹(내부 흰 글자는 도달 불가).
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const k = y * w + x;
    if (bg[k] || !isBgish(x, y)) continue;
    bg[k] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x, i = k * 4;
      if (bg[k]) { out[i + 3] = 0; continue; }

      // 배경과 인접한 전경 픽셀만 alpha 역산 대상(내부 픽셀은 완전 불투명 유지).
      let adjacent = false;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (bg[ny * w + nx]) { adjacent = true; break; }
      }
      if (!adjacent) continue;

      // observed = a*C + (1-a)*W  →  a ≈ (W - observed) / (W - C).
      // 외곽 경계는 항상 네이비(어두움)와 접하므로 최소 채널로 근사한다.
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const a = Math.max(0, Math.min(1, (WHITE_REF - Math.min(r, g)) / (WHITE_REF - 20)));
      if (a >= 0.98) continue;
      out[i + 3] = Math.round(a * 255);
      if (a > 0.02) {
        // 흰색 혼합분 제거(un-premultiply) — 남기면 밝은 테두리 잔상이 보인다.
        out[i]     = Math.round((r - (1 - a) * WHITE_REF) / a);
        out[i + 1] = Math.round((g - (1 - a) * WHITE_REF) / a);
        out[i + 2] = Math.round((b - (1 - a) * WHITE_REF) / a);
      }
    }
  }

  const transparentPct = (100 * bg.reduce((s, v) => s + v, 0)) / (w * h);
  return { buf: out, width: w, height: h, transparentPct };
}

// ── 2. 기하 측정 ────────────────────────────────────────────────────────────

/** 불투명 영역 bbox(= 방패)와 노란 공 중심을 잰다. */
function measure({ buf, width: w, height: h }) {
  const at = (x, y) => (y * w + x) * 4;
  const shield = { x0: w, y0: h, x1: 0, y1: 0 };
  let bx = 0, by = 0, ballPx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (buf[i + 3] < 128) continue;
      if (x < shield.x0) shield.x0 = x;
      if (x > shield.x1) shield.x1 = x;
      if (y < shield.y0) shield.y0 = y;
      if (y > shield.y1) shield.y1 = y;
      // 노란 테니스공 — 방패 안에서 유일한 고채도 노랑.
      if (buf[i] > 200 && buf[i + 1] > 200 && buf[i + 2] < 120) { bx += x; by += y; ballPx++; }
    }
  }
  if (!ballPx) throw new Error('노란 공을 찾지 못했습니다 — 원본 색상을 확인하세요.');
  return {
    shieldH: shield.y1 - shield.y0 + 1,
    shieldW: shield.x1 - shield.x0 + 1,
    ballX: bx / ballPx,
    ballY: by / ballPx,
  };
}

// ── 3. 캔버스 배치 ──────────────────────────────────────────────────────────

/**
 * 균등 배율 + 오프셋으로 target 캔버스에 배치한다.
 * 음수 오프셋(로고가 캔버스보다 큰 경우)을 허용하려고 넉넉한 패드 위에 올린 뒤 잘라낸다.
 */
async function place(srcPng, srcGeom, target) {
  const scale = target.shieldH / srcGeom.shieldH;
  const offsetLeft = target.ballX - srcGeom.ballX * scale;
  const offsetTop  = target.ballY - srcGeom.ballY * scale;

  const meta = await sharp(srcPng).metadata();
  const resized = await sharp(srcPng)
    .resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { kernel: 'lanczos3' })
    .toBuffer();

  const PAD = Math.max(target.canvasW, target.canvasH);
  const padded = await sharp({
    create: { width: target.canvasW + 2 * PAD, height: target.canvasH + 2 * PAD, channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, left: Math.round(offsetLeft) + PAD, top: Math.round(offsetTop) + PAD }])
    .png()
    .toBuffer();

  await fs.mkdir(path.dirname(target.out), { recursive: true });
  await sharp(padded)
    .extract({ left: PAD, top: PAD, width: target.canvasW, height: target.canvasH })
    .png({ compressionLevel: 9 })
    .toFile(target.out);

  return { scale, offsetLeft, offsetTop, shieldW: srcGeom.shieldW * scale };
}

// ── 4. favicon.ico ──────────────────────────────────────────────────────────

/** PNG 엔트리를 담은 ICO 컨테이너. 모든 현행 브라우저·Windows 가 PNG-in-ICO 를 지원한다. */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type = icon
  header.writeUInt16LE(pngs.length, 4);

  const dir = Buffer.alloc(16 * pngs.length);
  let offset = header.length + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir[o]     = size >= 256 ? 0 : size;  // 256 은 0 으로 표기하는 것이 규격
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;                       // palette count
    dir[o + 3] = 0;                       // reserved
    dir.writeUInt16LE(1, o + 4);          // color planes
    dir.writeUInt16LE(32, o + 6);         // bits per pixel
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });

  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

async function renderIconPng(masterPath, size) {
  const logoSize = Math.round(size * ICO_RATIO);
  const pad = Math.round((size - logoSize) / 2);
  const logo = await sharp(masterPath)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: ICO_BG } })
    .composite([{ input: logo, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`source: ${SRC}`);
  const transparent = await makeTransparent(SRC);
  console.log(`  배경 제거 완료 — 투명 ${transparent.transparentPct.toFixed(1)}% (${transparent.width}x${transparent.height})`);

  const geom = measure(transparent);
  console.log(`  실측 — 방패 ${geom.shieldW}x${geom.shieldH}, 공 중심 (${geom.ballX.toFixed(1)}, ${geom.ballY.toFixed(1)})`);

  const masterPng = await sharp(transparent.buf, {
    raw: { width: transparent.width, height: transparent.height, channels: 4 },
  }).png().toBuffer();

  for (const target of TARGETS) {
    const r = await place(masterPng, geom, target);
    const stat = await fs.stat(target.out);
    console.log(
      `OK ${target.out.padEnd(42)} ${target.canvasW}x${target.canvasH}  ` +
      `scale ${r.scale.toFixed(5)}  방패폭 ${r.shieldW.toFixed(0)}px  ${(stat.size / 1024).toFixed(1)}KB`
    );
  }

  const master = TARGETS[0].out;
  for (const ico of ICO_TARGETS) {
    const pngs = [];
    for (const size of ico.sizes) pngs.push({ size, buf: await renderIconPng(master, size) });
    await fs.writeFile(ico.out, buildIco(pngs));
    const stat = await fs.stat(ico.out);
    console.log(`OK ${ico.out.padEnd(42)} [${ico.sizes.join(', ')}]  ${(stat.size / 1024).toFixed(1)}KB`);
  }

  console.log('\n다음 단계: node scripts/generate-icons.mjs  (PWA/apple-touch/favicon PNG 재생성)');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
