import sharp from 'sharp';
import fs from 'node:fs/promises';

const SRC = 'public/logos/teyeon-logo-transparent.png';
const BG = { r: 255, g: 253, b: 248, alpha: 1 };

/**
 * Sizing presets.
 *   ratio  = logo width / icon width (how much of the icon the emblem occupies).
 *   yShift = portion of the icon height that the logo is nudged downward, to
 *            compensate for the visually top-heavy weight of the shield mark.
 *
 * Tweak SIZING to switch between conservative (1안) and bolder (2안) crops.
 */
const SIZING = {
  conservative: { ratio: 0.84, yShift: 0.015 }, // 1안 — balanced enlargement
  bold:         { ratio: 0.88, yShift: 0.020 }, // 2안 — fuller, more presence
};

const VARIANT = process.env.ICON_VARIANT === 'bold' ? 'bold' : 'conservative';
const { ratio: BASE_RATIO, yShift: BASE_Y_SHIFT } = SIZING[VARIANT];

// Per-target overrides keep the tiny favicon legible by using a higher ratio
// and no vertical shift.
const targets = [
  { out: 'public/icon-192.png',        size: 192 },
  { out: 'public/icon-512.png',        size: 512 },
  { out: 'public/apple-touch-icon.png', size: 180 },
  { out: 'public/favicon.png',          size:  96 },
  { out: 'public/favicon-32x32.png',    size:  32, ratio: 0.84, yShift: 0 },
];

async function generateOne(srcBuf, target) {
  const ratio  = target.ratio  ?? BASE_RATIO;
  const yShift = target.yShift ?? BASE_Y_SHIFT;

  const logoSize = Math.round(target.size * ratio);
  const padding  = (target.size - logoSize) / 2;
  const shiftPx  = Math.round(target.size * yShift);
  const top  = Math.round(padding + shiftPx);
  const left = Math.round(padding);

  const logoResized = await sharp(srcBuf)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp({
    create: {
      width: target.size,
      height: target.size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: logoResized, top, left }])
    .png({ compressionLevel: 9 })
    .toFile(target.out);

  const stat = await fs.stat(target.out);
  console.log(
    `OK ${target.out.padEnd(34)} ${target.size}x${target.size}  ` +
      `logo ${logoSize}px (ratio ${ratio.toFixed(2)})  ` +
      `top ${top}px (shift ${shiftPx}px)  ${stat.size}b`
  );
}

async function main() {
  const srcBuf = await fs.readFile(SRC);
  console.log(`Variant: ${VARIANT} (ratio ${BASE_RATIO}, yShift ${BASE_Y_SHIFT})`);
  for (const t of targets) {
    await generateOne(srcBuf, t);
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
