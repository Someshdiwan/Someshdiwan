#!/usr/bin/env node
/**
 * generate_monthly_line.js
 * Fetches GitHub contributions for a year, aggregates per month,
 * and renders a smooth area/line SVG (12 months).
 *
 * Usage:
 *   PH_TOKEN=... node scripts/generate_monthly_line.js --user Someshdiwan --year 2025 --out Assets/contrib-monthly-line.svg
 *
 * Dependencies:
 *   npm i @octokit/graphql date-fns
 */

const { graphql } = require('@octokit/graphql');
const {
    parseISO,
    startOfYear,
    endOfYear,
    eachDayOfInterval,
    getMonth,
    format,
} = require('date-fns');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { user: undefined, out: './Assets/contrib-monthly-line.svg', year: new Date().getFullYear() };
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if ((a === '-u' || a === '--user') && argv[i + 1]) { args.user = argv[i + 1]; i += 2; continue; }
        if ((a === '-o' || a === '--out') && argv[i + 1]) { args.out = argv[i + 1]; i += 2; continue; }
        if ((a === '-y' || a === '--year') && argv[i + 1]) { args.year = Number(argv[i + 1]); i += 2; continue; }
        if (a.startsWith('--') && a.includes('=')) {
            const [k, v] = a.replace(/^--/, '').split('=');
            if (k === 'user') args.user = v;
            if (k === 'out') args.out = v;
            if (k === 'year') args.year = Number(v);
        }
        i++;
    }
    return args;
}

async function fetchContributions(client, login, from, to) {
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
    return client(query, { login, from, to });
}

// Catmull-Rom to Bezier conversion for smooth path
// Returns array of cubic Bezier segments given points [{x,y}, ...]
function catmullRom2bezier(points, alpha = 0.5) {
    // if few points, return straight lines
    if (points.length < 2) return [];

    const beziers = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;

        // tension (can change alpha)
        const t1x = (p2.x - p0.x) * alpha;
        const t1y = (p2.y - p0.y) * alpha;
        const t2x = (p3.x - p1.x) * alpha;
        const t2y = (p3.y - p1.y) * alpha;

        const cp1x = p1.x + t1x / 3;
        const cp1y = p1.y + t1y / 3;
        const cp2x = p2.x - t2x / 3;
        const cp2y = p2.y - t2y / 3;

        beziers.push({ x1: cp1x, y1: cp1y, x2: cp2x, y2: cp2y, x: p2.x, y: p2.y });
    }
    return beziers;
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.user) {
        console.error('Usage: --user <github-username> [--year <yyyy>] [--out <path>]');
        process.exit(1);
    }

    const token = process.env.PH_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
        console.error('Error: PH_TOKEN or GH_TOKEN or GITHUB_TOKEN environment variable required.');
        process.exit(2);
    }

    const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });
    const year = Number(args.year) || new Date().getFullYear();
    const from = startOfYear(new Date(year, 0, 1)).toISOString();
    const to = endOfYear(new Date(year, 11, 31)).toISOString();

    let resp;
    try {
        resp = await fetchContributions(graphqlWithAuth, args.user, from, to);
    } catch (err) {
        console.error('GitHub GraphQL request failed:', err && err.message ? err.message : err);
        process.exit(10);
    }

    if (!resp || !resp.user || !resp.user.contributionsCollection || !resp.user.contributionsCollection.contributionCalendar) {
        console.error('Unexpected GraphQL response shape.');
        process.exit(11);
    }

    // Flatten contributionDays
    const weeks = resp.user.contributionsCollection.contributionCalendar.weeks || [];
    const counts = new Map();
    weeks.forEach(w => {
        (w.contributionDays || []).forEach(d => {
            if (d && d.date) counts.set(d.date, d.contributionCount || 0);
        });
    });

    // Ensure all days in year present with 0 default
    const allDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
    allDays.forEach(dt => {
        const key = format(dt, 'yyyy-MM-dd');
        if (!counts.has(key)) counts.set(key, 0);
    });

    // Aggregate per month 0..11
    const months = Array.from({ length: 12 }, () => 0);
    counts.forEach((v, k) => {
        const dt = parseISO(k);
        const m = getMonth(dt);
        months[m] += v;
    });

    // Prepare points for plotting
    // margins and canvas
    const width = 1200;
    const height = 320;
    const padding = { top: 36, right: 40, bottom: 48, left: 64 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...months, 1);
    const points = months.map((val, idx) => {
        const x = padding.left + (idx / 11) * plotW;
        // Invert y: larger values up
        const y = padding.top + plotH - (val / maxVal) * plotH;
        return { x, y, v: val, m: idx };
    });

    // build path: move to first point, then bezier segments
    const beziers = catmullRom2bezier(points);

    // Build SVG path for curve
    let pathD = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} `;
    for (let i = 0; i < beziers.length; i++) {
        const b = beziers[i];
        pathD += `C ${b.x1.toFixed(2)} ${b.y1.toFixed(2)}, ${b.x2.toFixed(2)} ${b.y2.toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)} `;
    }

    // Build area path (close to baseline)
    const baselineY = padding.top + plotH;
    const areaPath = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;

    // Month labels
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Theme
    const bg = '#1f2933';
    const grid = 'rgba(255,255,255,0.06)';
    const axis = 'rgba(255,255,255,0.16)';
    const stroke = '#7dd3fc'; // light cyan line
    const fill = 'rgba(125,211,252,0.12)';
    const dotFill = '#7be0ff';

    // Build SVG
    const svgParts = [];
    svgParts.push(`<?xml version="1.0" encoding="utf-8"?>`);
    svgParts.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monthly contributions ${year}">`);
    svgParts.push(`<rect width="100%" height="100%" rx="12" fill="${bg}" />`);

    // Title
    svgParts.push(`<text x="${width/2}" y="${padding.top/1.2}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="18" fill="#fff" font-weight="700">Contributions — ${year}</text>`);

    // Horizontal grid lines (5)
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const gy = padding.top + (i / gridLines) * plotH;
        svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${gy}" y2="${gy}" stroke="${grid}" stroke-width="1" stroke-dasharray="4 4" />`);
    }

    // Y-axis labels (0..max)
    for (let i = 0; i <= gridLines; i++) {
        const val = Math.round((1 - i / gridLines) * maxVal);
        const gy = padding.top + (i / gridLines) * plotH;
        svgParts.push(`<text x="${padding.left - 12}" y="${gy+4}" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="11" fill="#c7d2da">${val}</text>`);
    }

    // X-axis month labels
    points.forEach((p, idx) => {
        svgParts.push(`<text x="${p.x}" y="${height - 12}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" fill="#dbeafe">${monthNames[idx]}</text>`);
    });

    // Area
    svgParts.push(`<path d="${areaPath}" fill="${fill}" stroke="none" opacity="1" />`);

    // Stroke (slightly thicker, shadow)
    svgParts.push(`<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />`);
    // Glow (low-opacity thicker stroke for glow effect)
    svgParts.push(`<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="8" stroke-opacity="0.06" stroke-linejoin="round" stroke-linecap="round" />`);

    // Points (circles)
    points.forEach(p => {
        svgParts.push(`<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${dotFill}" stroke="#083344" stroke-width="1" />`);
        svgParts.push(`<title>${monthNames[p.m]} ${year}: ${p.v} contributions</title>`);
    });

    // X and Y axis lines
    svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${baselineY}" y2="${baselineY}" stroke="${axis}" stroke-width="1" />`);
    svgParts.push(`<line x1="${padding.left}" x2="${padding.left}" y1="${padding.top}" y2="${baselineY}" stroke="${axis}" stroke-width="1" />`);

    svgParts.push(`</svg>`);

    const svg = svgParts.join('\n');
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg, 'utf8');
    console.log('Wrote', outPath);
}

run().catch(err => {
    console.error('Unhandled error:', err && err.stack ? err.stack : err);
    process.exit(99);
});