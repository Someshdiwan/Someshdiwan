// scripts/wakatime_to_svg.js
/**
 * Generates an advanced wakatime.svg showing ALL-TIME stats.
 * - Uses WAKATIME_API_KEY secret (Basic auth with key: blank_password)
 * - Outputs wide SVG card with total hours, progress bars, and details
 */

const fs = require('fs');
const path = require('path');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
    console.error('WAKATIME_API_KEY not set');
    process.exit(1);
}

async function fetchWaka(url) {
    const authHeader = Buffer.from(`${apiKey}:`).toString('base64');
    const res = await fetch(url, { headers: { Authorization: `Basic ${authHeader}` } });
    if (!res.ok) throw new Error(`WakaTime API error: ${res.status} ${res.statusText}`);
    return res.json();
}

function languageColor(name) {
    // Simple hash → deterministic color
    const colors = ["#f39a2e","#ffd86b","#29a3a3","#f67280","#6a5acd","#20b2aa","#ff6f61","#87ceeb"];
    let hash = 0;
    for (let i=0; i<name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function makeWakaSVG(totalHours, languages, username, projectsCount, totalLangs) {
    const w = 1200, h = 360;
    const leftPad = 60, topPad = 50;
    const maxBar = 600;
    const barHeight = 18;

    const topLangs = languages.slice(0, 8);

    const langRows = topLangs.map((l, i) => {
        const y = 140 + i * 32;
        const pct = Math.round(l.percent || 0);
        const barW = Math.max(6, Math.round((pct / 100) * maxBar));
        const color = languageColor(l.name);
        return `
      <text x="${leftPad}" y="${y}" font-size="18" fill="#ffffff" font-family="Segoe UI, Roboto, Arial">${l.name}</text>
      <rect x="${leftPad + 160}" y="${y - barHeight + 4}" width="${barW}" height="${barHeight}" rx="6" fill="${color}" />
      <text x="${leftPad + maxBar + 190}" y="${y}" font-size="16" fill="#ffd86b" font-family="Segoe UI, Roboto, Arial">${pct}%</text>
    `;
    }).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
  <style>
    .bg{fill:#0f2527}
    .title{font-family:'Segoe UI',Roboto,Arial; font-size:28px; fill:#ffd86b; font-weight:700}
    .hours{font-family:Georgia,serif; font-size:72px; fill:#ffffff; font-weight:700}
    .footer{font-family:'Segoe UI',Roboto,Arial; font-size:14px; fill:#9fb3b3}
  </style>
  <rect width="100%" height="100%" fill="#0f2527" rx="18"/>
  <g transform="translate(${leftPad},${topPad})">
    <text class="title" x="0" y="0">WakaTime (All-time coding stats)</text>
    <text class="hours" x="0" y="70">${totalHours} hrs</text>
    ${langRows}
    <text class="footer" x="0" y="${h - topPad - 10}">Tracking ${projectsCount} projects • ${totalLangs} languages • See more at wakatime.com/@${username}</text>
  </g>
</svg>`;
}

(async () => {
    try {
        const url = 'https://wakatime.com/api/v1/users/current/stats/all_time';
        const data = await fetchWaka(url);

        const totalSec = data.data.total_seconds || 0;
        const totalHours = ((totalSec / 3600) || 0).toFixed(1);

        const languages = (data.data.languages || []).map(l => ({
            name: l.name,
            percent: l.percent || (l.total_seconds ? (l.total_seconds / totalSec) * 100 : 0),
            total_seconds: l.total_seconds || 0
        }));

        const projectsCount = (data.data.projects || []).length;
        const totalLangs = (data.data.languages || []).length;
        const username = (data.data.username || '').replace('@','') || process.env.WAKATIME_USERNAME || 'SomeshDiwan';

        const svg = makeWakaSVG(totalHours, languages, username, projectsCount, totalLangs);
        fs.writeFileSync(path.join(process.cwd(), 'wakatime.svg'), svg, 'utf8');
        console.log('wakatime.svg written:', totalHours, 'hrs');
    } catch (err) {
        console.error('Error in wakatime_to_svg:', err);
        process.exit(1);
    }
})();
