#!/usr/bin/env node
// Generates public/og-card.png — run once when the card design changes.
// Requires: rsvg-convert (librsvg2-bin)

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dir, '..', 'public', 'og-card.png');

// Fetch the Twemoji SVG for 💸 (U+1F4B8, money with wings)
const twemojiUrl = 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f4b8.svg';
const res = await fetch(twemojiUrl);
if (!res.ok) throw new Error(`Failed to fetch Twemoji: ${res.status}`);
const emojiSvg = await res.text();

// Encode emoji SVG as a data URI for embedding in the outer SVG
const emojiDataUri = `data:image/svg+xml;base64,${Buffer.from(emojiSvg).toString('base64')}`;

// Card dimensions
const W = 1200;
const H = 630;

// Vertical rhythm for the left text block
const titleY1 = 185;   // "Retirement"
const titleY2 = 295;   // "Calculator"
const subtitleY = 375; // "Plan your retirement"
const urlY = 455;      // "retire.burns.sh →"

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="#0f172a"/>

  <!-- Subtle gradient overlay for depth -->
  <defs>
    <linearGradient id="bg-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg-grad)"/>

  <!-- Left text block -->
  <text x="80" y="${titleY1}"
        font-family="DejaVu Sans, sans-serif" font-weight="bold"
        font-size="96" fill="#f1f5f9" letter-spacing="-1">Retirement</text>

  <text x="80" y="${titleY2}"
        font-family="DejaVu Sans, sans-serif" font-weight="bold"
        font-size="96" fill="#f1f5f9" letter-spacing="-1">Calculator</text>

  <text x="80" y="${subtitleY}"
        font-family="DejaVu Sans, sans-serif"
        font-size="36" fill="#94a3b8">Plan your retirement</text>

  <text x="80" y="${urlY}"
        font-family="DejaVu Sans, sans-serif"
        font-size="28" fill="#60a5fa">retire.burns.sh \u2192</text>

  <!-- 💸 emoji, right side, vertically centered -->
  <image href="${emojiDataUri}"
         x="700" y="115"
         width="400" height="400"/>

</svg>`;

// Convert SVG → PNG via rsvg-convert
const tmpSvg = join(__dir, '_og-card-tmp.svg');
writeFileSync(tmpSvg, svg, 'utf8');

try {
  execSync(`rsvg-convert -w ${W} -h ${H} "${tmpSvg}" -o "${outPath}"`);
  console.log(`Written: ${outPath}`);
} finally {
  import('fs').then(fs => fs.unlinkSync(tmpSvg));
}
