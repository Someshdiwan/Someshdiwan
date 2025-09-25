// scripts/wakatime_to_svg.js
// Fetch last 7-day summary from WakaTime and render basic SVG.
// Requires WAKATIME_API_KEY in GitHub Secrets.

const fs = require('fs');
const path = require('path');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
    console.error('WAKATIME_API_KEY not set');
    process.exit(1);
}

async function fetchWaka(url) {
    const authHeader = Buffer.from(apiKey).toString('base64'); // base64 encode the raw API key
    const res = await fetch(url, {
        headers: { Authorization: `Basic ${authHeader}` },
    });
    if (!res.ok) throw new Error(`WakaTime API error: ${res.status} ${res.statusText}`);
    return res.json();
}

function makeWakaSVG(totalHours, languages) {
    const width = 900, height = 220;
    const topLangs = languages.slice(0, 4);
    const langLines = topLangs.map((l, i) => {
        const y = 80 + i * 30;
        const pct = Math.round(l.percent);
        return `<text x="230" y="${y}" font-size="18" fill="#ffffff">${l.name}</text>
            <text x="560" y="${y}" font-size="18" fill="#f6a936">${pct}%</text>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#0f2527" rx="8"/>
  <text x="40" y="50" font-size="20" fill="#ffd86b" font-weight="700">WakaTime (last 7 days)</text>
  <text x="40" y="95" font-size="48" fill="#ffffff" font-weight="700">${totalHours} hrs</text>
  ${langLines}
</svg>`;
}

(async () => {
    try {
        const url = 'https://wakatime.com/api/v1/users/current/stats/last_7_days';
        const data = await fetchWaka(url);
        const totalSec = data.data.total_seconds || 0;
        const totalHours = (totalSec / 3600).toFixed(1);

        const languages = (data.data.languages || []).map(l => ({
            name: l.name,
            percent: l.percent || (l.total_seconds ? (l.total_seconds / totalSec) * 100 : 0),
            total_seconds: l.total_seconds || 0
        }));

        const svg = makeWakaSVG(totalHours, languages);
        fs.writeFileSync(path.join(process.cwd(), 'wakatime.svg'), svg, 'utf8');
        console.log('wakatime.svg written:', totalHours, 'hrs');
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
})();
