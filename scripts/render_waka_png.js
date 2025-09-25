// scripts/render_waka_png.js
/**
 * Robust renderer: fetch WakaTime stats, cache JSON, render PNG via Puppeteer.
 * - Tries all_time first, falls back to last_7_days if all_time is empty
 * - Retries network calls with backoff
 * - Caches last-good JSON to .github/waka-template/waka_data.json
 * - Renders .github/waka-template/waka.html -> wakatime.png via Puppeteer
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE_DIR = path.join(process.cwd(), '.github', 'waka-template');
const TEMPLATE_FILE = path.join(TEMPLATE_DIR, 'waka.html');
const CACHE_FILE = path.join(TEMPLATE_DIR, 'waka_data.json');
const TMP_HTML = path.join(TEMPLATE_DIR, '_waka_render.html');
const OUT_FILE = path.join(process.cwd(), 'wakatime.png');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
    console.error('WAKATIME_API_KEY not set');
    process.exit(1);
}

// fetch with timeout
async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

// fetch with retries
async function fetchJsonWithRetries(url, headers = {}, retries = 3, timeoutMs = 10000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetchWithTimeout(url, { headers }, timeoutMs);
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${res.statusText} ${txt ? `| ${txt.slice(0,200)}` : ''}`);
            }
            const json = await res.json();
            return json;
        } catch (err) {
            console.warn(`Fetch attempt ${attempt} failed: ${err.message}`);
            if (attempt < retries) {
                const backoff = Math.round((Math.pow(2, attempt) * 500) + Math.random() * 400);
                console.log(`Waiting ${backoff}ms before retry...`);
                await new Promise(r => setTimeout(r, backoff));
            } else {
                throw err;
            }
        }
    }
}

// deterministic color for languages
function languageColor(name) {
    const colors = ["#f39a2e","#ffd86b","#29a3a3","#f67280","#6a5acd","#20b2aa","#ff6f61","#87ceeb","#9bdeac","#a68cff"];
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
}

function normalizeRaw(raw) {
    const d = raw && raw.data ? raw.data : {};
    const totalSec = d.total_seconds || d.total_seconds_all || 0;
    const totalHours = totalSec ? (totalSec / 3600) : 0;
    const languages = (d.languages || []).map(l => {
        const percent = (l.percent != null)
            ? l.percent
            : (totalSec > 0 ? (l.total_seconds || 0) / totalSec * 100 : 0);
        return { name: l.name, percent: Math.round(percent * 10) / 10, total_seconds: l.total_seconds || 0, color: languageColor(l.name) };
    });
    return {
        hours: totalHours.toFixed(1),
        projects: (d.projects || []).length || 0,
        languages
    };
}

async function renderFromData(normalized) {
    if (!fs.existsSync(TEMPLATE_FILE)) throw new Error(`Template missing: ${TEMPLATE_FILE}`);
    const htmlTemplate = fs.readFileSync(TEMPLATE_FILE, 'utf8');

    // inject data: replace 'window.__WAKA_DATA__ || { ... }' marker in template
    const injected = htmlTemplate.replace('window.__WAKA_DATA__ || { hours: \'0.0\', projects:0, languages: [] }',
        JSON.stringify(normalized));

    fs.writeFileSync(TMP_HTML, injected, 'utf8');

    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 360, deviceScaleFactor: 2 });
        await page.goto('file://' + TMP_HTML, { waitUntil: 'networkidle0' });
        await page.screenshot({ path: OUT_FILE, omitBackground: false });
        console.log('Rendered wakatime.png ->', OUT_FILE);
    } finally {
        await browser.close();
    }
}

(async () => {
    let raw = null;

    try {
        // 1) try all_time
        const urlAll = 'https://wakatime.com/api/v1/users/current/stats/all_time';
        console.log('Fetching all_time...');
        raw = await fetchJsonWithRetries(urlAll, { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') }, 4, 12000);
        const totalSecAll = raw?.data?.total_seconds ?? raw?.data?.total_seconds_all ?? 0;
        if (!totalSecAll) {
            console.log('all_time returned 0; falling back to last_7_days');
            raw = null;
        } else {
            console.log(`all_time total_seconds=${totalSecAll}`);
        }
    } catch (err) {
        console.warn('all_time fetch failed:', err.message);
        raw = null;
    }

    // 2) fallback to last_7_days if needed
    if (!raw) {
        try {
            const url7 = 'https://wakatime.com/api/v1/users/current/stats/last_7_days';
            console.log('Fetching last_7_days...');
            raw = await fetchJsonWithRetries(url7, { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') }, 4, 12000);
            console.log('last_7_days fetched');
        } catch (err) {
            console.warn('last_7_days fetch failed:', err.message);
            raw = null;
        }
    }

    // 3) try cache if live fetchs failed
    if (!raw) {
        if (fs.existsSync(CACHE_FILE)) {
            try {
                raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                console.log('Loaded cached WakaTime JSON from', CACHE_FILE);
            } catch (err) {
                console.warn('Cache exists but could not parse:', err.message);
                raw = null;
            }
        }
    }

    // 4) if still no raw, use placeholder
    if (!raw) {
        console.warn('No WakaTime data available; using placeholder.');
        raw = { data: { total_seconds: 0, languages: [], projects: [] } };
    } else {
        // save cache for future fallback
        try {
            if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
            fs.writeFileSync(CACHE_FILE, JSON.stringify(raw, null, 2), 'utf8');
            console.log('Cached WakaTime JSON to', CACHE_FILE);
        } catch (err) {
            console.warn('Failed to write cache:', err.message);
        }
    }

    // normalize and render
    const normalized = normalizeRaw(raw);
    console.log('Normalized data:', normalized.hours, 'hrs, languages:', normalized.languages.length);

    try {
        await renderFromData(normalized);
        process.exit(0);
    } catch (err) {
        console.error('Render failed:', err.message);
        process.exit(1);
    }
})();
