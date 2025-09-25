// scripts/wakatime_to_svg.js
/**
 * Generates a polished wakatime.svg showing ALL-TIME total hours and top languages.
 * - Uses WAKATIME_API_KEY secret (Basic auth with key: blank_password)
 * - Creates clickable SVG linking to your WakaTime profile
 */

const fs = require('fs');
const path = require('path');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
    console.error('WAKATIME_API_KEY not set');
    process.exit(1);
}

async function fetchWaka(url) {
    // WakaTime expects Basic auth with key as username and blank password
    const authHeader = Buffer.from(`${apiKey}:`).toString('base64');
    const res = await fetch(url, {
        headers: { Authorization: `Basic ${authHeader}` }
    });
    if (!res.ok) {
        throw new Error(`WakaTime API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

function px(n) { return `${n}px`; }

function makeWakaSVG(totalHours, languages, username) {
    // Layout sizes
    const w = 1000;
    const h = 260;
    const leftPad = 40;
    const topPad = 30;

    const topLangs = languages.slice(0, 6);
    // language bars: max width scaled to 420
    const maxBar = 420;

    const langRows = topLangs.map((l, i) => {
        const y = 130 + i * 26;
        const pct = Math.round(l.percent || 0);
        const barW = Math.round((pct / 100) * maxBar);
        return `
      <text x="${leftPad + 8}" y="${y}" font-size="15" fill="#ffffff" font-family="Segoe UI, Roboto, Arial">${l.name}</text>
      <rect x="${leftPad + 120}" y="${y - 14}" width="${barW}" height="12" rx="6" fill="#f6a936" />
      <text x="${leftPad + 560}" y="${y}" font-size="15" fill="#ffd86b" font-family="Segoe UI, Roboto, Arial">${pct}%</text>
    `;
    }).join('\n');

    // clickable SVG wrapper using xlink:href
    const profileLink = `https://wakatime.com/@${username}`;

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="WakaTime all-time ${totalHours} hours">
  <style>
    .bg{fill:#0f2527}
    .card{rx:12; fill:#0f2527}
    .title{font-family: 'Segoe UI', Roboto, Arial; font-size:20px; fill:#ffd86b; font-weight:700}
    .hours{font-family: Georgia, 'Times New Roman', serif; font-size:60px; fill:#ffffff; font-weight:700}
    .lang{font-family: 'Segoe UI', Roboto, Arial; font-size:15px; fill:#ffffff}
    .pct{font-family: 'Segoe UI', Roboto, Arial; font-size:15px; fill:#ffd86b; font-weight:700}
  </style>

  <a xlink:href="${profileLink}" target="_blank">
    <rect width="100%" height="100%" fill="#0f2527" rx="12"/>
    <g transform="translate(${leftPad},${topPad})">
      <text class="title" x="0" y="26">WakaTime (All time)</text>
      <text class="hours" x="0" y="86">${totalHours} hrs</text>

      <!-- language bars -->
      ${langRows}

      <!-- small footer -->
      <text x="0" y="${h - 18}" font-size="12" fill="#9fb3b3" font-family="Segoe UI, Roboto, Arial">Click to view full WakaTime profile</text>
    </g>
  </a>
</svg>`;
}

(async () => {
    try {
        // ALL-TIME endpoint
        const url = 'https://wakatime.com/api/v1/users/current/stats/all_time';
        const data = await fetchWaka(url);

        // total_seconds: sometimes nested in data.data.total_seconds or data.data
        const totalSec = data.data.total_seconds || data.data.total_seconds_all || 0;
        const totalHours = ((totalSec / 3600) || 0).toFixed(1);

        // languages array: name, percent or total_seconds
        const languages = (data.data.languages || []).map(l => ({
            name: l.name,
            percent: l.percent || (l.total_seconds ? (l.total_seconds / totalSec) * 100 : 0),
            total_seconds: l.total_seconds || 0
        }));

        // determine username for link path from user object or environment fallback
        const username = (data.data.username || '').replace('@', '') || process.env.WAKATIME_USERNAME || 'SomeshDiwan';

        const svg = makeWakaSVG(totalHours, languages, username);
        fs.writeFileSync(path.join(process.cwd(), 'wakatime.svg'), svg, 'utf8');
        console.log('wakatime.svg written:', totalHours, 'hrs');
    } catch (err) {
        console.error('Error in wakatime_to_svg:', err);
        process.exit(1);
    }
})();
