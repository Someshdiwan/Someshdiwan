// scripts/render_waka_png.js
/**
 * Robust renderer: fetch WakaTime all_time stats, cache JSON, render PNG via Puppeteer.
 * - Retries fetch with exponential backoff
 * - Uses timeout for fetch
 * - Falls back to cached JSON (.github/waka-template/waka_data.json) if fetch fails
 * - Writes wakatime.png using Puppeteer
 *
 * Requires:
 *   - WAKATIME_API_KEY in env (repo secret)
 *   - .github/waka-template/waka.html template present
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE_DIR = path.join(process.cwd(), '.github', 'waka-template');
const TEMPLATE_FILE = path.join(TEMPLATE_DIR, 'waka.html');
const CACHE_FILE = path.join(TEMPLATE_DIR, 'waka_data.json');
const OUT_FILE = path.join(process.cwd(), 'wakatime.png');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) {
    console.error('WAKATIME_API_KEY not set');
    process.exit(1);
}

// simple fetch with timeout & retry (node 18+ global fetch)
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

async function fetchWakaAllTime(retries = 3, timeoutMs = 10000) {
    const url = 'https://wakatime.com/api/v1/users/current/stats/all_time';
    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`WakaTime fetch attempt ${attempt}/${retries} (timeout=${timeoutMs}ms)`);
            const res = await fetchWithTimeout(url, { headers: { Authorization: authHeader } }, timeoutMs);
            // Network-level success; check HTTP status
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${res.statusText} ${body ? '| Body:' + body.slice(0,200) : ''}`);
            }
            const json = await res.json();
            return json;
        } catch (err) {
            console.warn(`Waka fetch attempt ${attempt} failed: ${err.message}`);
            if (attempt < retries) {
                // exponential backoff with jitter
                const backoff = Math.round((Math.pow(2, attempt) * 500) + (Math.random() * 400));
                console.log(`Waiting ${backoff}ms before retry...`);
                await new Promise(r => setTimeout(r, backoff));
            } else {
                console.error('All WakaTime fetch attempts failed.');
                throw err;
            }
        }
    }
}

function languageColor(name) {
    const colors = ["#f39a2e","#ffd86b","#29a3a3","#f67280","#6a5acd","#20b2aa","#ff6f61","#87ceeb"];
    let h=0; for (let i=0;i<name.length;i++) h = name.charCodeAt(i) + ((h<<5)-h);
    return colors[Math.abs(h) % colors.length];
}

function normalizeWakaData(raw) {
    // We expect raw.data to hold the useful fields per current API. Normalize to safe shape.
    const d = raw && raw.data ? raw.data : {};
    const totalSec = d.total_seconds || d.total_seconds_all || 0;
    const totalHours = (totalSec / 3600) || 0;
    const languages = (d.languages || []).map(l => ({
        name: l.name,
        percent: l.percent || (l.total_seconds ? (l.total_seconds / totalSec) * 100 : 0),
        total_seconds: l.total_seconds || 0,
        color: languageColor(l.name || '')
    }));
    return {
        hours: totalHours.toFixed(1),
        projects: (d.projects || []).length || 0,
        languages
    };
}

async function renderPngFromData(data) {
    if (!fs.existsSync(TEMPLATE_FILE)) {
        throw new Error(`Template missing: ${TEMPLATE_FILE}`);
    }
    const htmlTemplate = fs.readFileSync(TEMPLATE_FILE, 'utf8');

    // We inject JSON by replacing a marker script; the template should use window.__WAKA_DATA__ or similar.
    // Inject as a global assignment to avoid CORS/network.
    const injectedHtml = htmlTemplate.replace('window.__WAKA_DATA__ || { hours: \'0.0\', projects:0, languages: [] }',
        JSON.stringify(data));

    const tmpHtml = path.join(TEMPLATE_DIR, '_waka_render.html');
    fs.writeFileSync(tmpHtml, injectedHtml, 'utf8');

    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 360, deviceScaleFactor: 2 });
        await page.goto('file://' + tmpHtml, { waitUntil: 'networkidle0' });
        await page.screenshot({ path: OUT_FILE, omitBackground: false });
        console.log('Rendered wakatime.png ->', OUT_FILE);
    } finally {
        await browser.close();
    }
}

(async () => {
    let raw = null;
    try {
        raw = await fetchWakaAllTime(4, 12000); // 4 attempts, 12s timeout
        // Cache raw JSON for fallback
        try {
            if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
            fs.writeFileSync(CACHE_FILE, JSON.stringify(raw, null, 2), 'utf8');
            console.log('Cached WakaTime JSON to', CACHE_FILE);
        } catch (err) {
            console.warn('Could not write cache file:', err.message);
        }
    } catch (fetchErr) {
        console.error('Fetch failed — will attempt to use cached data if available:', fetchErr.message);
        if (fs.existsSync(CACHE_FILE)) {
            try {
                raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                console.log('Loaded cached WakaTime JSON from', CACHE_FILE);
            } catch (err) {
                console.error('Cached file exists but could not be parsed:', err.message);
                raw = null;
            }
        }
    }

    // If still no data, prepare a fallback placeholder
    if (!raw) {
        console.warn('No WakaTime data available; using placeholder dataset.');
        raw = { data: { total_seconds: 0, languages: [], projects: [] } };
    }

    const normalized = normalizeWakaData(raw);
    console.log('Using data: hours=', normalized.hours, 'projects=', normalized.projects, 'languages=', normalized.languages.length);

    try {
        await renderPngFromData(normalized);
        process.exit(0);
    } catch (err) {
        console.error('Rendering failed:', err.message);
        process.exit(1);
    }
})();
