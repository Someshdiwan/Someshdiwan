// scripts/wakatime_to_svg.js
// Simple example: fetch last 7-day summary from WakaTime and render basic SVG.
// NOTE: WakaTime endpoints: https://wakatime.com/api/v1/users/current/stats/last_7_days
// You must store API key in WAKATIME_API_KEY secret.

const fs = require('fs');
const path = require('path');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
    console.error('WAKATIME_API_KEY not set');
    process.exit(1);
}

async function fetchWaka(url) {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
        throw new Error(`WakaTime API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

function makeWakaSVG(totalHours, languages) {
    // languages: [{name, percent, total_seconds}]
    const width = 900, height = 220;
    const topLangs = languages.slice(0, 4);
    const langLines = topLangs.map((l, i) => {
        const y = 80 + i * 30;
        const pct = Math.round(l.percent);
        return `<text x="230" y="${y}" font-size="18" fill="#ffffff">${l.name}</text>
            <text x="560" y="${y}" font-size="18" fill="#f6a936">${pct}%</text>`;
    }).join('\n');

    const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#0f2527" rx="8"/>
  <text x="40" y="50" font-size="20" fill="#ffd86b" font-weight="700">WakaTime (last 7 days)</text>
  <text x="40" y="95" font-size="48" fill="#ffffff" font-weight="700">${totalHours} hrs</text>
  ${langLines}
</svg>`;
    return svg;
}

(async () => {
    try {
        const url = 'https://wakatime.com/api/v1/users/current/stats/last_7_days';
        const data = await fetchWaka(url);
        // data has total_seconds and languages array
        const totalSec = data.data.total_seconds || 0;
        const totalHours = (totalSec / 3600).toFixed(1);

        // languages may be array with name, percent, total_seconds
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
