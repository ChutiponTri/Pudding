#!/usr/bin/env node
/**
 * Builds the LINE Flex card hero images from the mockups in public/cards/.
 * Each mockup is a whole card (art header + text + buttons); the bot draws the
 * text and buttons itself, so only the art header is kept: cropped inside the
 * card's purple outline, its rounded top corners masked to white (the bubble's
 * own background), resized to 1040 px wide and saved as a small JPEG.
 *
 *   node scripts/build-line-cards.mjs
 *
 * After changing an image, bump CARD_IMAGE_VERSION in src/lib/line/flex.ts
 * (LINE caches images by URL).
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'public/cards';
const OUT = 'public/cards/line';
const WIDTH = 1040;

/** Crop boxes (source pixels), just inside each card's outline, and its top corner radius. */
const CARDS = [
  { name: 'new-assignment', box: { left: 24, top: 54, width: 667, height: 272 }, radius: 70 },
  { name: 'new-quiz', box: { left: 53, top: 65, width: 1080, height: 385 }, radius: 85 },
  { name: 'new-student', box: { left: 47, top: 45, width: 961, height: 312 }, radius: 80 },
  { name: 'first-conn', box: { left: 56, top: 57, width: 1119, height: 615 }, radius: 95 },
  { name: 'menu', box: { left: 33, top: 36, width: 959, height: 292 }, radius: 75 },
];

function topRoundedMask(width, height, r) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<path d="M0,${r} A${r},${r} 0 0 1 ${r},0 H${width - r} A${r},${r} 0 0 1 ${width},${r} V${height} H0 Z" fill="#fff"/></svg>`
  );
}

await mkdir(OUT, { recursive: true });
for (const card of CARDS) {
  const { width, height } = card.box;
  const cropped = await sharp(path.join(SRC, `${card.name}.png`)).extract(card.box).png().toBuffer();
  const masked = await sharp(cropped)
    .ensureAlpha()
    .composite([{ input: topRoundedMask(width, height, card.radius), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const outHeight = Math.round((height * WIDTH) / width);
  const file = path.join(OUT, `${card.name}.jpg`);
  const info = await sharp(masked)
    .flatten({ background: '#ffffff' })
    .resize(WIDTH, outHeight)
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(file);
  console.log(`${file}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB  aspectRatio "${info.width}:${info.height}"`);
}
