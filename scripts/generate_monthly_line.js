#!/usr/bin/env node

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
function catmullRom2bezier(points, alpha = 0.5) {
    if (points.length < 2) return [];
    const beziers = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;

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

    // Ensure all days in year present
    const allDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
    allDays.forEach(dt => {
        const key = format(dt, 'yyyy-MM-dd');
        if (!counts.has(key)) counts.set(key, 0);
    });

    // Aggregate per month
    const months = Array.from({ length: 12 }, () => 0);
    counts.forEach((v, k) => {
        const dt = parseISO(k);
        const m = getMonth(dt);
        months[m] += v;
    });

    // Canvas & layout
    const width = 1200;
    const height = 340;
    const padding = { top: 44, right: 48, bottom: 60, left: 72 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...months, 1);
    const points = months.map((val, idx) => {
        const x = padding.left + (idx / 11) * plotW;
        const y = padding.top + plotH - (val / maxVal) * plotH;
        return { x, y, v: val, m: idx };
    });

    const beziers = catmullRom2bezier(points);

    // Build path D
    let pathD = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} `;
    for (let i = 0; i < beziers.length; i++) {
        const b = beziers[i];
        pathD += `C ${b.x1.toFixed(2)} ${b.y1.toFixed(2)}, ${b.x2.toFixed(2)} ${b.y2.toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)} `;
    }

    const baselineY = padding.top + plotH;
    const areaPath = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Theme & colors
    const bg = '#0f1720'; // slightly darker
    const grid = 'rgba(255,255,255,0.04)';
    const axis = 'rgba(255,255,255,0.10)';
    const stroke = '#60a5fa';      // main line
    const strokeShadow = '#60a5fa';
    const fill = 'url(#areaGradient)';
    const dotFill = '#9be7ff';
    const textColor = '#e6eef6';

    // Build SVG with animation CSS
    const svgParts = [];
    svgParts.push(`<?xml version="1.0" encoding="utf-8"?>`);
    svgParts.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monthly contributions ${year}">`);
    svgParts.push(`<defs>
    <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#60a5fa" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      .title { font-family: Inter, Arial, sans-serif; font-size:18px; fill:${textColor}; font-weight:700; }
      .label { font-family: Inter, Arial, sans-serif; font-size:11px; fill:#c7d2da; }
      .monthLabel { font-family: Inter, Arial, sans-serif; font-size:12px; fill:#cfe8ff; }
      .axis { stroke:${axis}; stroke-width:1; }
      .grid { stroke:${grid}; stroke-width:1; stroke-dasharray:4 4; }
      .curve { fill:none; stroke:${stroke}; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
      .curve-glow { fill:none; stroke:${strokeShadow}; stroke-width:12; stroke-opacity:0.06; stroke-linecap:round; stroke-linejoin:round; filter:url(#softGlow); }
      .area { fill:${fill}; opacity:0.95; }
      /* draw animation */
      .draw {
        stroke-dasharray: 2000;
        stroke-dashoffset: 2000;
        animation: drawLine 1.6s ease-out forwards;
      }
      @keyframes drawLine {
        to { stroke-dashoffset: 0; }
      }
      .fadeIn {
        opacity: 0;
        animation: fadeInArea 1.2s ease-out 0.2s forwards;
      }
      @keyframes fadeInArea {
        to { opacity: 1; }
      }
    </style>
  </defs>`);

    svgParts.push(`<rect width="100%" height="100%" rx="12" fill="${bg}" />`);
    svgParts.push(`<text x="${width/2}" y="${padding.top/1.2}" text-anchor="middle" class="title">Contributions — ${year}</text>`);

    // vertical month grid lines (subtle)
    points.forEach((p, idx) => {
        svgParts.push(`<line x1="${p.x.toFixed(2)}" x2="${p.x.toFixed(2)}" y1="${padding.top}" y2="${baselineY}" class="grid" />`);
    });

    // Horizontal grid lines (5)
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const gy = padding.top + (i / gridLines) * plotH;
        svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${gy}" y2="${gy}" class="grid" />`);
    }

    // Y-axis labels (0..max)
    for (let i = 0; i <= gridLines; i++) {
        const val = Math.round((1 - i / gridLines) * maxVal);
        const gy = padding.top + (i / gridLines) * plotH;
        svgParts.push(`<text x="${padding.left - 12}" y="${gy+4}" text-anchor="end" class="label">${val}</text>`);
    }

    // Month labels
    points.forEach((p, idx) => {
        svgParts.push(`<text x="${p.x.toFixed(2)}" y="${height - 18}" text-anchor="middle" class="monthLabel">${monthNames[idx]}</text>`);
    });

    // Area (with fade-in)
    svgParts.push(`<path d="${areaPath}" class="area fadeIn" />`);

    // Glow stroke under the main line
    svgParts.push(`<path d="${pathD}" class="curve-glow" />`);

    // Main animated stroke (draw)
    svgParts.push(`<path d="${pathD}" class="curve draw" />`);

    // Points + numeric labels for months with contributions
    points.forEach(p => {
        svgParts.push(`<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${dotFill}" stroke="#063241" stroke-width="1" />`);
        svgParts.push(`<title>${monthNames[p.m]} ${year}: ${p.v} contributions</title>`);
        // render small value labels if non-zero (avoid clutter)
        if (p.v > 0) {
            const labelY = p.y - 12;
            svgParts.push(`<text x="${p.x}" y="${labelY}" text-anchor="middle" class="label">${p.v}</text>`);
        }
    });

    // Axis lines
    svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${baselineY}" y2="${baselineY}" class="axis" />`);
    svgParts.push(`<line x1="${padding.left}" x2="${padding.left}" y1="${padding.top}" y2="${baselineY}" class="axis" />`);

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