#!/usr/bin/env node

const { graphql } = require("@octokit/graphql");
const {
    parseISO,
    format,
    startOfYear,
    endOfYear,
    eachDayOfInterval,
    getMonth,
    getDay,
} = require("date-fns");
const fs = require("fs");
const path = require("path");

/* tiny arg parser (no external deps) */
function parseArgs(argv) {
    const args = { user: undefined, out: "./assets/contrib-monthly.svg", year: new Date().getFullYear() };
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if ((a === "-u" || a === "--user") && argv[i + 1]) { args.user = argv[i + 1]; i += 2; continue; }
        if ((a === "-o" || a === "--out") && argv[i + 1]) { args.out = argv[i + 1]; i += 2; continue; }
        if ((a === "-y" || a === "--year") && argv[i + 1]) { args.year = Number(argv[i + 1]); i += 2; continue; }
        if (a.startsWith("--") && a.includes("=")) {
            const [k, v] = a.replace(/^--/, "").split("=");
            if (k === "user") args.user = v;
            if (k === "out") args.out = v;
            if (k === "year") args.year = Number(v);
        }
        i++;
    }
    return args;
}

async function graphqlRetry(client, query, vars, opts = {}) {
    const retries = opts.retries ?? 3;
    const delayMs = opts.delayMs ?? 800;
    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try { return await client(query, vars); }
        catch (err) {
            lastErr = err;
            const shouldRetry = attempt < retries && (err.status >= 500 || (err.errors && err.errors.some(e => /rate limit|timeout/i.test(e.message))));
            if (!shouldRetry) break;
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            await sleep(delayMs * attempt);
        }
    }
    throw lastErr;
}

async function run() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.user) {
        console.error("Usage: --user <github-username> [--year <yyyy>] [--out <path>]");
        process.exit(1);
    }

    // Prefer PH_TOKEN, fall back to GH_TOKEN, then GITHUB_TOKEN
    const token = process.env.PH_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
        console.error("Error: PH_TOKEN or GH_TOKEN or GITHUB_TOKEN environment variable required.");
        process.exit(2);
    }

    const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });

    const year = Number(args.year) || new Date().getFullYear();
    const from = startOfYear(new Date(year, 0, 1)).toISOString();
    const to = endOfYear(new Date(year, 11, 31)).toISOString();

    const query = `
    query($login:String!, $from:DateTime!, $to:DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

    let resp;
    try {
        resp = await graphqlRetry(graphqlWithAuth, query, { login: args.user, from, to }, { retries: 4, delayMs: 700 });
    } catch (err) {
        console.error("GitHub GraphQL request failed:", err && err.message ? err.message : err);
        process.exit(10);
    }

    if (!resp || !resp.user || !resp.user.contributionsCollection || !resp.user.contributionsCollection.contributionCalendar) {
        console.error("Unexpected GraphQL response shape; cannot find contributionCalendar. Response excerpt:");
        console.error(JSON.stringify(resp && resp.user ? { user: Object.keys(resp.user) } : resp, null, 2));
        process.exit(11);
    }

    const weeks = resp.user.contributionsCollection.contributionCalendar.weeks || [];

    // Flatten into map
    const counts = new Map();
    weeks.forEach(w => {
        (w.contributionDays || []).forEach(d => { if (d && d.date) counts.set(d.date, d.contributionCount || 0); });
    });

    // Ensure every day is present
    const allDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
    allDays.forEach(dt => { const key = format(dt, "yyyy-MM-dd"); if (!counts.has(key)) counts.set(key, 0); });

    // Group by month
    const months = Array.from({ length: 12 }, () => []);
    counts.forEach((value, key) => { const dt = parseISO(key); const m = getMonth(dt); months[m].push({ date: key, count: value, dt }); });

    const colorSteps = ["#ebedf0","#c6e48b","#7bc96f","#239a3b","#196127"];
    const allCounts = Array.from(counts.values());
    const max = Math.max(...allCounts, 1);
    const mapToColor = (n) => { if (!n || n <= 0) return colorSteps[0]; const idx = Math.min(colorSteps.length - 1, Math.ceil((n / max) * (colorSteps.length - 1))); return colorSteps[idx]; };

    const cell = 12, gap = 3, monthPadding = 24, monthsPerRow = 3;

    function renderMonth(monthIndex, monthDays) {
        const yearStart = new Date(year, monthIndex, 1);
        const firstWeekday = getDay(yearStart);
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const totalCells = firstWeekday + daysInMonth;
        const cols = Math.ceil(totalCells / 7);
        const squares = [];
        const map = new Map(monthDays.map(m => [format(m.dt, "yyyy-MM-dd"), m.count]));
        for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(year, monthIndex, d);
            const weekday = getDay(dt);
            const dayNumberOffset = d + firstWeekday - 1;
            const weekIndex = Math.floor(dayNumberOffset / 7);
            const x = weekIndex * (cell + gap);
            const y = weekday * (cell + gap);
            const key = format(dt, "yyyy-MM-dd");
            const count = map.get(key) || 0;
            const color = mapToColor(count);
            squares.push({ x, y, color, count, date: key });
        }
        return { cols, rows: 7, squares, colsPx: cols * (cell + gap) - gap, rowsPx: 7 * (cell + gap) - gap };
    }

    const monthRenders = months.map((m, i) => ({ i, monthName: format(new Date(year, i, 1), "LLLL"), ...renderMonth(i, m) }));
    const colWidth = Math.max(...monthRenders.map(mr => mr.colsPx)) + 8;
    const rowHeight = monthRenders[0].rowsPx + 28;
    const cols = monthsPerRow;
    const rows = Math.ceil(12 / monthsPerRow);
    const svgWidth = cols * colWidth + (cols + 1) * monthPadding;
    const svgHeight = rows * rowHeight + (rows + 1) * monthPadding;

    const header = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contributions (${year}) - month by month">
  <style>
    .label { font-family: Inter, Arial, sans-serif; font-size:12px; fill:#222; }
    .small { font-size:10px; fill:#666; }
    .month-name { font-family: Inter, Arial, sans-serif; font-size:13px; fill:#0b1220; font-weight:600; }
    .cell { rx: 2; ry: 2; }
  </style>
`;

    const parts = [header];
    monthRenders.forEach((mr, idx) => {
        const col = idx % monthsPerRow;
        const row = Math.floor(idx / monthsPerRow);
        const originX = monthPadding + col * (colWidth + monthPadding);
        const originY = monthPadding + row * (rowHeight + monthPadding);
        parts.push(`<g transform="translate(${originX}, ${originY})">`);
        parts.push(`<text class="month-name" x="0" y="12">${mr.monthName} ${year}</text>`);
        const offsetY = 18;
        const offsetX = 0;
        mr.squares.forEach(sq => {
            const sx = offsetX + sq.x;
            const sy = offsetY + sq.y;
            parts.push(`<rect class="cell" x="${sx}" y="${sy}" width="${cell}" height="${cell}" fill="${sq.color}" stroke="rgba(0,0,0,0.06)" stroke-width="0.5">`);
            parts.push(`<title>${sq.date} — ${sq.count} contributions</title>`);
            parts.push(`</rect>`);
        });
        parts.push(`<g transform="translate(${mr.colsPx + 8}, ${offsetY})">`);
        parts.push(`<text class="small" x="0" y="-6">Less</text>`);
        colorSteps.forEach((c, ci) => {
            const lx = ci * (cell + 2);
            const ly = -4;
            parts.push(`<rect x="${lx}" y="${ly}" width="${cell}" height="${cell}" fill="${c}" stroke="rgba(0,0,0,0.06)" stroke-width="0.4" />`);
        });
        parts.push(`<text class="small" x="${colorSteps.length * (cell + 2) + 6}" y="6">More</text>`);
        parts.push(`</g>`);
        parts.push("</g>");
    });

    parts.push("</svg>");
    const svg = parts.join("\n");
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg, "utf8");
    console.log("Wrote", outPath);
}

run().catch(err => {
    console.error("Unhandled error:", err && err.stack ? err.stack : err);
    process.exit(99);
});