const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE_DIR = path.join(process.cwd(), '.github', 'waka-template');
const TEMPLATE_FILE = path.join(TEMPLATE_DIR, 'waka.html');
const CACHE_FILE = path.join(TEMPLATE_DIR, 'waka_data.json');
const TMP_HTML = path.join(TEMPLATE_DIR, 'waka.html');
const OUT_FILE = path.join(process.cwd(), 'wakatime.png');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) process.exit(1);

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

async function fetchJsonWithRetries(url, headers = {}, retries = 3, timeoutMs = 10000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetchWithTimeout(url, { headers }, timeoutMs);
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${res.statusText} ${txt}`);
            }
            return await res.json();
        } catch (err) {
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, Math.round((Math.pow(2, attempt) * 500) + Math.random() * 400)));
            } else throw err;
        }
    }
}

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
        const percent = (l.percent != null) ? l.percent : (totalSec > 0 ? (l.total_seconds || 0) / totalSec * 100 : 0);
        return { name: l.name, percent: Math.round(percent * 10) / 10, color: languageColor(l.name) };
    });
    return { hours: totalHours.toFixed(1), projects: (d.projects || []).length || 0, languages };
}

async function renderFromData(normalized) {
    const htmlTemplate = fs.readFileSync(TEMPLATE_FILE, 'utf8');
    const injected = htmlTemplate.replace(/window\.__WAKA_DATA__\s*\|\|\s*{[^}]+}/,
        JSON.stringify(normalized));
    fs.writeFileSync(TMP_HTML, injected, 'utf8');
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 360, deviceScaleFactor: 2 });
        await page.goto('file://' + TMP_HTML, { waitUntil: 'networkidle0' });
        await page.screenshot({ path: OUT_FILE, omitBackground: false });
    } finally {
        await browser.close();
    }
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
    else fs.writeFileSync(CACHE_FILE, JSON.stringify(raw, null, 2), 'utf8');
    const normalized = normalizeRaw(raw);
    await renderFromData(normalized);
})();
