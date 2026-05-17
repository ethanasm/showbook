#!/usr/bin/env node
/**
 * Generates non-1x1 placeholder PNG assets for the mobile app so the
 * Expo build pipeline doesn't choke on undersized inputs. The output
 * is a solid #0C0C0C field with the brand accent (#FFD166) painted as
 * a centered square that approximates an "S" mark — enough brand
 * presence to ship a TestFlight build, not the final design asset.
 *
 * Replace with hand-designed artwork from the design system before
 * App Store / Play Store submission. The legacy 1x1 placeholders are
 * overwritten in place at `apps/mobile/assets/`.
 *
 *   node scripts/generate-mobile-placeholder-assets.mjs
 */

import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'apps', 'mobile', 'assets');

const BG = [0x0c, 0x0c, 0x0c]; // showbook --bg
const ACCENT = [0xff, 0xd1, 0x66]; // showbook --accent

/**
 * Paint a centered gold mark on a solid-black field.
 *
 *  ████████   ← top bar
 *  █
 *  ████████   ← middle bar
 *         █
 *  ████████   ← bottom bar
 *
 * Approximation of the brand "S". Sized as a fraction of the canvas so
 * the same routine works for square icons (1:1) and portrait splashes
 * (1:1+ aspect). On non-square targets the mark stays centered.
 */
function paintMark(png, w, h) {
  // Background fill
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) << 2;
      png.data[idx] = BG[0];
      png.data[idx + 1] = BG[1];
      png.data[idx + 2] = BG[2];
      png.data[idx + 3] = 255;
    }
  }

  // Mark sized as 40% of the shorter side; bar thickness ~10%
  const short = Math.min(w, h);
  const markSize = Math.round(short * 0.4);
  const barThick = Math.round(markSize * 0.18);
  const x0 = Math.round((w - markSize) / 2);
  const y0 = Math.round((h - markSize) / 2);

  function paintRect(rx, ry, rw, rh) {
    const x1 = Math.max(0, rx);
    const y1 = Math.max(0, ry);
    const x2 = Math.min(w, rx + rw);
    const y2 = Math.min(h, ry + rh);
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const idx = (y * w + x) << 2;
        png.data[idx] = ACCENT[0];
        png.data[idx + 1] = ACCENT[1];
        png.data[idx + 2] = ACCENT[2];
        png.data[idx + 3] = 255;
      }
    }
  }

  // Top bar
  paintRect(x0, y0, markSize, barThick);
  // Middle bar
  paintRect(x0, y0 + Math.round(markSize / 2) - Math.round(barThick / 2), markSize, barThick);
  // Bottom bar
  paintRect(x0, y0 + markSize - barThick, markSize, barThick);
  // Top-left vertical (connects top bar to middle bar)
  paintRect(x0, y0, barThick, Math.round(markSize / 2));
  // Bottom-right vertical (connects middle bar to bottom bar)
  paintRect(x0 + markSize - barThick, y0 + Math.round(markSize / 2), barThick, Math.round(markSize / 2));
}

function generate(name, width, height) {
  const png = new PNG({ width, height });
  paintMark(png, width, height);
  const buf = PNG.sync.write(png);
  const out = join(ASSETS_DIR, name);
  writeFileSync(out, buf);
  console.log(`wrote ${name} (${width}x${height}, ${buf.length} bytes)`);
}

generate('icon.png', 1024, 1024);
generate('adaptive-icon.png', 1024, 1024);
generate('splash.png', 1284, 2778);
generate('favicon.png', 48, 48);
