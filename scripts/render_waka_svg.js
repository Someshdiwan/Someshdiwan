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

/**
 * WakaTime Stats Card SVG
 */
function makeWakaSVG(data, username) {
    const width = 420;
    const height = 220;

    const langs = data.languages.slice(0, 5) // top 5 languages
        .map((l, i) => `
        <g transform="translate(20, ${70 + i * 28})">
            <rect width="14" height="14" fill="${l.color}" rx="3" ry="3"/>
            <text x="22" y="12" font-size="14" fill="#333">${escapeXml(l.name)} — ${l.percent}%</text>
        </g>
    `).join("");

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .title { font: bold 16px sans-serif; fill: #444; }
    .subtitle { font: 14px sans-serif; fill: #666; }
  </style>

  <rect width="100%" height="100%" fill="#fffbea" stroke="#f0e0a0" stroke-width="1.5" rx="12"/>
  <text x="20" y="30" class="title">WakaTime Stats for ${escapeXml(username)}</text>
  <text x="20" y="50" class="subtitle">Total Hours: ${escapeXml(data.hours)}h • Projects: ${escapeXml(data.projects)}</text>

  ${langs}
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
