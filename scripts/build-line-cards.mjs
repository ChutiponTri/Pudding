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
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'public/cards';
const OUT = 'public/cards/line';
const WIDTH = 1040;

/**
 * Crop boxes (source pixels), just inside each card's outline, and its top
 * corner radius (0 = the mockup is full-bleed). A card whose mockup is not in
 * public/cards keeps its last built image.
 */
const CARDS = [
  { name: 'new-assignment', box: { left: 0, top: 0, width: 1086, height: 452 }, radius: 0 },
  { name: 'new-quiz', box: { left: 32, top: 24, width: 1192, height: 404 }, radius: 18 },
  { name: 'new-student', box: { left: 23, top: 24, width: 1110, height: 330 }, radius: 18 },
  { name: 'menu', box: { left: 26, top: 20, width: 1106, height: 282 }, radius: 18 },
  { name: 'open-class', box: { left: 30, top: 26, width: 1125, height: 876 }, radius: 18 },
  { name: 'join-class', box: { left: 27, top: 23, width: 1129, height: 724 }, radius: 18 },
  { name: 'first-conn', box: { left: 0, top: 0, width: 1691, height: 930 }, radius: 0 },
  { name: 'remind', box: { left: 0, top: 0, width: 1086, height: 418 }, radius: 0 },
  { name: 'score-announce', box: { left: 0, top: 0, width: 1086, height: 380 }, radius: 0 },
  { name: 'open-for-submission', box: { left: 0, top: 0, width: 1086, height: 428 }, radius: 0 },
  { name: 'submit-work', box: { left: 0, top: 0, width: 1087, height: 408 }, radius: 0 },
];

/**
 * Whole pictures sent as LINE image messages (not card headers): a full-size
 * JPEG and the small preview LINE shows in the chat.
 */
const PICTURES = [{ name: 'remind-teacher-send', width: 1280, preview: 480 }];

function topRoundedMask(width, height, r) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<path d="M0,${r} A${r},${r} 0 0 1 ${r},0 H${width - r} A${r},${r} 0 0 1 ${width},${r} V${height} H0 Z" fill="#fff"/></svg>`
  );
}

await mkdir(OUT, { recursive: true });
for (const card of CARDS) {
  const { width, height } = card.box;
  const source = path.join(SRC, `${card.name}.png`);
  if (!(await access(source).then(() => true, () => false))) {
    console.log(`${card.name}: no mockup in ${SRC}, keeping ${OUT}/${card.name}.jpg`);
    continue;
  }
  const cropped = await sharp(source).extract(card.box).png().toBuffer();
  const masked = card.radius
    ? await sharp(cropped)
        .ensureAlpha()
        .composite([{ input: topRoundedMask(width, height, card.radius), blend: 'dest-in' }])
        .png()
        .toBuffer()
    : cropped;
  const outHeight = Math.round((height * WIDTH) / width);
  const file = path.join(OUT, `${card.name}.jpg`);
  const info = await sharp(masked)
    .flatten({ background: '#ffffff' })
    .resize(WIDTH, outHeight)
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(file);
  console.log(`${file}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB  aspectRatio "${info.width}:${info.height}"`);
}

for (const picture of PICTURES) {
  const source = path.join(SRC, `${picture.name}.png`);
  if (!(await access(source).then(() => true, () => false))) {
    console.log(`${picture.name}: no picture in ${SRC}, keeping the built files`);
    continue;
  }
  for (const [suffix, width] of [['', picture.width], ['-preview', picture.preview]]) {
    const file = path.join(OUT, `${picture.name}${suffix}.jpg`);
    const info = await sharp(source).resize({ width }).jpeg({ quality: 84, mozjpeg: true }).toFile(file);
    console.log(`${file}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
  }
}
