import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = 'public/logos/teyeon-logo-transparent.png';
const BG = { r: 255, g: 253, b: 248, alpha: 1 };

const targets = [
  { out: 'public/icon-192.png', size: 192, ratio: 0.78 },
  { out: 'public/icon-512.png', size: 512, ratio: 0.78 },
  { out: 'public/apple-touch-icon.png', size: 180, ratio: 0.78 },
  { out: 'public/favicon.png', size: 96, ratio: 0.78 },
  { out: 'public/favicon-32x32.png', size: 32, ratio: 0.82 },
];

async function main() {
  const srcBuf = await fs.readFile(SRC);

  for (const t of targets) {
    const logoSize = Math.round(t.size * t.ratio);
    const offset = Math.round((t.size - logoSize) / 2);

    const logoResized = await sharp(srcBuf)
      .resize(logoSize, logoSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer();

    await sharp({
      create: {
        width: t.size,
        height: t.size,
        channels: 4,
        background: BG,
      },
    })
      .composite([{ input: logoResized, top: offset, left: offset }])
      .png({ compressionLevel: 9 })
      .toFile(t.out);

    const stat = await fs.stat(t.out);
    console.log(
      `OK ${t.out.padEnd(34)} ${t.size}x${t.size}  logo ${logoSize}px  ${stat.size}b`
    );
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
