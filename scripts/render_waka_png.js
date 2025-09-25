// scripts/render_waka_png.js
const fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer');

const apiKey = process.env.WAKATIME_API_KEY;
if (!apiKey) { console.error('WAKATIME_API_KEY not set'); process.exit(1); }

async function fetchWaka(url) {
    const res = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') }});
    if (!res.ok) throw new Error('WakaTime API error ' + res.status);
    return res.json();
}

function languageColor(name) {
    const colors = ["#f39a2e","#ffd86b","#29a3a3","#f67280","#6a5acd","#20b2aa","#ff6f61","#87ceeb"];
    let h=0; for(let i=0;i<name.length;i++) h = name.charCodeAt(i) + ((h<<5)-h);
    return colors[Math.abs(h) % colors.length];
}

(async () => {
    const url = 'https://wakatime.com/api/v1/users/current/stats/all_time';
    const data = await fetchWaka(url);
    const totalSec = (data.data.total_seconds || 0);
    const hours = (totalSec/3600).toFixed(1);

    const languages = (data.data.languages || []).map(l => ({
        name: l.name,
        percent: l.percent || (l.total_seconds ? (l.total_seconds / totalSec)*100 : 0),
        color: languageColor(l.name)
    }));

    const htmlTemplate = fs.readFileSync(path.join(process.cwd(), '.github/waka-template/waka.html'), 'utf8');
    // inject data as window.__WAKA_DATA__
    const injected = htmlTemplate.replace('window.__WAKA_DATA__ || { hours: \'0.0\', projects:0, languages: [] }',
        JSON.stringify({ hours, projects: (data.data.projects||[]).length, languages }));
    const tmpHtml = path.join(process.cwd(), '.github/waka-template/_waka_render.html');
    fs.writeFileSync(tmpHtml, injected, 'utf8');

    // launch puppeteer
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 360, deviceScaleFactor: 2 });
    await page.goto('file://' + tmpHtml, { waitUntil: 'networkidle0' });
    const out = path.join(process.cwd(), 'wakatime.png');
    await page.screenshot({ path: out, omitBackground: false });
    await browser.close();
    console.log('wakatime.png written:', out);
})();
