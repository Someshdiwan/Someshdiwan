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
function makeStreakSVG(streak) {
    const width = 420;
    const height = 300;
    const daysText = String(streak);

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub streak ${escapeXml(daysText)} days">
  <defs>
    <filter id="cardShadow" x="-70%" y="-70%" width="240%" height="240%">
      <feDropShadow dx="6" dy="20" stdDeviation="18" flood-color="#000" flood-opacity="0.28"/>
    </filter>

    <linearGradient id="cardGrad" x1="0" x2="1">
      <stop offset="0%" stop-color="#fff8d7"/>
      <stop offset="100%" stop-color="#fff3bf"/>
    </linearGradient>

    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd86b"/>
      <stop offset="100%" stop-color="#f39a2e"/>
    </linearGradient>

    <style>
      .card-font { font-family: "Comic Sans MS", "Segoe UI", Roboto, Arial, sans-serif; -webkit-font-smoothing:antialiased; }
      .title { fill:#6b5a1f; font-weight:700; font-size:18px; }
      .big { fill:url(#numGrad); font-weight:900; font-size:84px; text-anchor:middle; filter: drop-shadow(0 6px 0 rgba(0,0,0,0.12)); }
      .sub { fill:#6b6b6b; font-size:16px; text-anchor:middle; }
      .egg-shadow { fill: rgba(0,0,0,0.10); }
      .flame-anim { animation: floaty 2400ms ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
      .flame-flicker { animation: flicker 1400ms linear infinite; transform-box: fill-box; transform-origin: center; }
      @keyframes floaty { 0% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-6px) rotate(-1deg); } 100% { transform: translateY(0) rotate(0deg); } }
      @keyframes flicker { 0% { transform: scale(1); opacity:1 } 50% { transform: scale(0.996); opacity:0.96 } 100% { transform: scale(1); opacity:1 } }
    </style>
  </defs>

  <!-- main card with notch and soft shadow -->
  <g filter="url(#cardShadow)">
    <path d="M24 20 h300 a28 28 0 0 1 28 28 v128 a28 28 0 0 1 -28 28 h-146 q-12 8 -24 8 t-24 -8 h-180 z"
          fill="url(#cardGrad)" stroke="#f0e0a0" stroke-width="1.2"/>
    <!-- corner shine -->
    <path d="M332 68 q-6 18 -22 26" stroke="#f5e0a0" stroke-width="1.2" fill="none" opacity="0.66"/>
    <ellipse cx="308" cy="46" rx="6" ry="3" fill="#fff9d8" opacity="0.78"/>
  </g>

  <!-- left egg/flame + ground shadow (kept inside card) -->
  <g transform="translate(64,46)">
    <ellipse class="egg-shadow" cx="36" cy="86" rx="62" ry="14" opacity="0.10"/>
    <g class="flame-anim" transform="translate(0,-6)">
      <g class="flame-flicker" transform="translate(0,0) scale(0.98)">
        <path d="M86 18 C66 -6 42 -6 28 18 C16 36 20 86 56 92 C92 98 106 58 86 18 Z" fill="#ffd86b"/>
        <path d="M74 50 C66 38 52 38 44 50 C40 58 48 70 62 66 C72 64 82 58 74 50 Z" fill="#fff3d8" opacity="0.96"/>
        <path d="M68 12 C62 6 50 8 46 14 C44 20 50 26 58 24 C64 22 70 16 68 12 Z" fill="#ffe08a" opacity="0.98"/>
      </g>
    </g>
  </g>

  <!-- small balancing egg/flame top-right (inside card bounds) -->
  <g transform="translate(${width - 92}, 32) scale(0.68)">
    <g class="flame-anim" style="animation-delay:120ms;">
      <path d="M40 4 C33 -4 18 -6 12 4 C6 12 8 34 26 36 C44 38 56 22 40 4 Z" fill="#ffd86b" opacity="0.98"/>
      <path d="M36 18 C32 12 24 12 20 18 C18 22 22 26 28 24 C32 22 34 20 36 18 Z" fill="#fff3d8" opacity="0.9"/>
    </g>
  </g>

  <!-- content, centered and with adjusted number size so it feels like WakaTime card -->
  <g class="card-font" transform="translate(0,0)">
    <text x="${width/2}" y="56" class="title">GitHub streak</text>

    <text x="${width/2}" y="140" class="big">${escapeXml(daysText)}</text>

    <text x="${width/2}" y="176" class="sub">day streak</text>

    <!-- subtle decorative notch echo under center -->
    <g transform="translate(${width/2 - 20}, 238)">
      <path d="M0 14 q20 18 40 0" fill="#f7eed1" stroke="none" opacity="0.96"/>
      <path d="M0 14 q20 18 40 0" fill="#e9dcc3" opacity="0.08" transform="translate(0,6)"/>
    </g>

    <!-- anchor to repo -->
    <a xlink:href="https://github.com/${encodeURIComponent(repoOwner)}" target="_blank" rel="noopener"></a>
  </g>
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
