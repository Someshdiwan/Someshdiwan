// scripts/render_waka_svg.js
const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');

const TEMPLATE_DIR = path.join(process.cwd(), '.github', 'waka-template');
const CACHE_FILE = path.join(TEMPLATE_DIR, 'waka_data.json');
const OUT_FILE = path.join(process.cwd(), 'wakatime.svg');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
    console.error('WAKATIME_API_KEY not set');
    process.exit(1);
}

function languageColor(name) {
    const colors = ["#f39a2e","#ffd86b","#29a3a3","#f67280","#6a5acd","#20b2aa","#ff6f61","#87ceeb","#9bdeac","#a68cff"];
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
}

async function fetchJsonWithRetries(url, headers = {}, retries = 3, timeoutMs = 10000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(id);
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${res.statusText} ${txt ? `| ${txt.slice(0,200)}` : ''}`);
            }
            return await res.json();
        } catch (err) {
            if (attempt < retries) {
                const backoff = Math.round((Math.pow(2, attempt) * 500) + Math.random() * 400);
                await new Promise(r => setTimeout(r, backoff));
            } else throw err;
        }
    }
}

function normalizeRaw(raw) {
    const d = raw && raw.data ? raw.data : {};
    const totalSec = d.total_seconds || d.total_seconds_all || 0;
    const totalHours = totalSec ? (totalSec / 3600) : 0;
    const languages = (d.languages || []).map(l => {
        const percent = (l.percent != null)
            ? l.percent
            : (totalSec > 0 ? (l.total_seconds || 0) / totalSec * 100 : 0);
        return { name: l.name, percent: Math.round(percent * 10) / 10, color: languageColor(l.name) };
    });
    return { hours: totalHours.toFixed(1), projects: (d.projects || []).length || 0, languages };
}

function escapeXml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c]));
}

// build SVG string
// ---------- SVG builder (WakaTime) ----------
function makeWakaSVG(normalized, username = 'SomeshDiwan') {
    const w = 420, h = 300;
    const hours = normalized.hours || '0.0';
    const langs = (normalized.languages || []).slice(0, 3);

    // Fallback palette to match your UI (purple, coral, gold)
    const fallback = ['#6a5acd', '#ff6f61', '#ffd86b'];

    const donutGroups = langs.map((l, i) => {
        const pct = Math.max(0, Math.min(100, Number(l.percent || 0)));
        const color = l.color || fallback[i % fallback.length];

        // donut geometry
        const r = 30;
        const stroke = 12;
        const C = 2 * Math.PI * r;
        const dashOffset = C * (1 - pct / 100);

        // positions (left → right)
        const x = 120 + i * 100;
        const y = 190;

        return `
      <g transform="translate(${x}, ${y})">
        <circle cx="0" cy="0" r="${r}" fill="none" stroke="#efe0bd" stroke-width="${stroke}"/>
        <circle cx="0" cy="0" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
                stroke-linecap="round"
                stroke-dasharray="${C} ${C}"
                stroke-dashoffset="${dashOffset}"
                transform="rotate(-90)"/>
        <circle cx="0" cy="0" r="${r * 0.48}" fill="#fff4cf"/>
        <text x="0" y="-2" font-family="Comic Sans MS, cursive, sans-serif"
              font-size="11" font-weight="700" fill="#2b2b2b" text-anchor="middle">${escapeXml(l.name || '')}</text>
        <text x="0" y="14" font-family="Comic Sans MS, cursive, sans-serif"
              font-size="11" fill="#806015" text-anchor="middle">${Math.round(pct)}%</text>
      </g>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="WakaTime all time ${hours} hours">
  <defs>
    <filter id="sdrop" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="6" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <linearGradient id="cardGrad" x1="0" x2="1">
      <stop offset="0%" stop-color="#fff6c7"/>
      <stop offset="100%" stop-color="#fff1b8"/>
    </linearGradient>
  </defs>

  <!-- rounded card w/ soft shadow -->
  <g filter="url(#sdrop)">
    <path d="M18 18 h384 a16 16 0 0 1 16 16 v200 a16 16 0 0 1 -16 16 h-184 q-12 8 -24 8 t-24 -8 h-176 z"
          fill="url(#cardGrad)" stroke="#f0dfa0" stroke-width="1.2"/>
    <path d="M330 162 q0 10 -10 18 l-24 12 q-10 8 -18 6" fill="#ffee9e" opacity="0.95"/>
    <path d="M328 34 q-4 16 -18 24" stroke="#f5e0a0" stroke-width="1.2" fill="none" opacity="0.6"/>
    <ellipse cx="310" cy="36" rx="6" ry="3" fill="#fff8d8" opacity="0.7"/>
  </g>

  <!-- content -->
  <g font-family="Comic Sans MS, cursive, sans-serif" text-anchor="middle">
    <text x="${w/2}" y="70" font-size="16" font-weight="700" fill="#6b5a1f">WakaTime (All Time)</text>
    <text x="${w/2}" y="120" font-size="48" font-weight="800" fill="#2b2b2b">${escapeXml(hours)}</text>
    <text x="${w/2}" y="145" font-size="13" fill="#6b6b6b">hrs coding</text>
    ${donutGroups}
  </g>

  <!-- clickable overlay (safe for GitHub rendering) -->
  <a xlink:href="https://wakatime.com/@${encodeURIComponent(String(username).replace(/^@/, ''))}" target="_blank" rel="noopener">
    <rect x="0" y="0" width="${w}" height="${h}" fill="none"/>
  </a>
</svg>`;
}


(async () => {
    let raw = null;
    try {
        raw = await fetchJsonWithRetries('https://wakatime.com/api/v1/users/current/stats/all_time',
            { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') }, 4, 12000);
        if (!(raw?.data?.total_seconds || raw?.data?.total_seconds_all)) raw = null;
    } catch { raw = null; }

    if (!raw) {
        try {
            raw = await fetchJsonWithRetries('https://wakatime.com/api/v1/users/current/stats/last_7_days',
                { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') }, 4, 12000);
        } catch { raw = null; }
    }

    if (!raw && fs.existsSync(CACHE_FILE)) {
        try { raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { raw = null; }
    }

    if (!raw) raw = { data: { total_seconds: 0, languages: [], projects: [] } };
    else {
        try {
            if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
            fs.writeFileSync(CACHE_FILE, JSON.stringify(raw, null, 2), 'utf8');
        } catch {}
    }

    const normalized = normalizeRaw(raw);
    const username = raw?.data?.username ? String(raw.data.username).replace(/^@/, '') : process.env.WAKATIME_USERNAME || 'SomeshDiwan';
    const svg = makeWakaSVG(normalized, username);
    fs.writeFileSync(OUT_FILE, svg, 'utf8');
    console.log('wakatime.svg written:', OUT_FILE, 'hours=', normalized.hours);
})();
