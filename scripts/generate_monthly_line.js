#!/usr/bin/env node

const { graphql } = require('@octokit/graphql');
const pathProps = require('svg-path-properties');
const {
    parseISO,
    startOfYear,
    endOfYear,
    eachDayOfInterval,
    format,
} = require('date-fns');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { user: undefined, out: './Assets/contrib-daily-line.svg', year: new Date().getFullYear() };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if ((a === '-u' || a === '--user') && argv[i + 1]) { args.user = argv[i + 1]; i++; continue; }
        if ((a === '-o' || a === '--out') && argv[i + 1]) { args.out = argv[i + 1]; i++; continue; }
        if ((a === '-y' || a === '--year') && argv[i + 1]) { args.year = Number(argv[i + 1]); i++; continue; }
        if (a.startsWith('--') && a.includes('=')) {
            const [k, v] = a.replace(/^--/, '').split('=');
            if (k === 'user') args.user = v;
            if (k === 'out') args.out = v;
            if (k === 'year') args.year = Number(v);
        }
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
        console.error('GitHub GraphQL request failed:', err?.message || err);
        process.exit(10);
    }

    const weeks = resp?.user?.contributionsCollection?.contributionCalendar?.weeks || [];
    if (!weeks.length) {
        console.error('No contribution data found for the specified user/year.');
        process.exit(11);
    }

    const counts = new Map();
    weeks.forEach(w => (w.contributionDays || []).forEach(d => d?.date && counts.set(d.date, d.contributionCount || 0)));

    const allDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
    allDays.forEach(dt => {
        const key = format(dt, 'yyyy-MM-dd');
        if (!counts.has(key)) counts.set(key, 0);
    });

    const width = 1400, height = 340;
    const padding = { top: 44, right: 48, bottom: 60, left: 72 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const dailyCounts = Array.from(counts.values());
    const maxVal = Math.max(...dailyCounts, 1);

    const points = allDays.map((dt, idx) => ({
        x: padding.left + (idx / (allDays.length - 1)) * plotW,
        y: padding.top + plotH - ((counts.get(format(dt, 'yyyy-MM-dd')) || 0) / maxVal) * plotH,
        v: counts.get(format(dt, 'yyyy-MM-dd')) || 0,
        dt
    }));

    const beziers = catmullRom2bezier(points);
    let pathD = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} `;
    for (const b of beziers) pathD += `C ${b.x1.toFixed(2)} ${b.y1.toFixed(2)}, ${b.x2.toFixed(2)} ${b.y2.toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)} `;

    const baselineY = padding.top + plotH;
    const areaPath = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;

    const pathProperties = new pathProps.svgPathProperties(pathD);
    const totalLength = Math.ceil(pathProperties.getTotalLength());

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthPoints = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

    const bg = '#0f1720', grid = 'rgba(255,255,255,0.04)', axis = 'rgba(255,255,255,0.1)';
    const stroke = '#1e40af', strokeShadow = '#1e40af', fill = 'url(#areaGradient)';
    const dotFill = '#9be7ff', textColor = '#e6eef6';
    const fontFamily = `'Comic Sans MS', 'Comic Sans', cursive`;
    const dur = '2.5s';

    const svgParts = [];
    svgParts.push(`<?xml version="1.0" encoding="utf-8"?>`);
    svgParts.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="svgTitle">`);
    svgParts.push(`<title id="svgTitle">Daily contributions for ${year} — ${args.user}</title>`);
    svgParts.push(`<defs>
    <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${stroke}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${stroke}" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      text, .label, .monthLabel { font-family: ${fontFamily}; }
      .title { font-family: ${fontFamily}; font-size:18px; fill:${textColor}; font-weight:700; }
      .label { font-size:10px; fill:#c7d2da; }
      .monthLabel { font-size:12px; fill:#cfe8ff; }
      .curve { fill:none; stroke:${stroke}; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; filter:url(#softGlow); }
      .curve-glow { fill:none; stroke:${strokeShadow}; stroke-width:10; stroke-opacity:0.06; stroke-linecap:round; stroke-linejoin:round; }
      .area { fill:${fill}; opacity:0; animation: fadeInArea 1.5s ease-in-out 0.5s forwards; }
      .dot { fill:${dotFill}; stroke:#063241; stroke-width:1; opacity:0; animation: fadeInDot 0.5s ease-in-out forwards; }
      @keyframes fadeInArea { to { opacity: 0.95; } }
      @keyframes fadeInDot { to { opacity: 1; } }
      .draw {
        stroke-dasharray: ${totalLength};
        stroke-dashoffset: ${totalLength};
        animation: drawLine ${dur} cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }
      @keyframes drawLine {
        to { stroke-dashoffset: 0; }
      }
      .particle {
        fill: ${dotFill};
        stroke: #063241;
        stroke-width: 1;
        r: 4;
        animation: moveParticle ${dur} cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }
      @keyframes moveParticle {
        0% { offset-distance: 0%; opacity: 0; }
        20% { opacity: 1; }
        100% { offset-distance: 100%; opacity: 1; }
      }
    </style>
  </defs>`);

    svgParts.push(`<rect width="100%" height="100%" rx="12" fill="${bg}" />`);
    svgParts.push(`<text x="${width / 2}" y="${padding.top / 1.2}" text-anchor="middle" class="title">Daily Contributions — ${year}</text>`);

    for (let i = 0; i <= 10; i++) {
        const gy = padding.top + (i / 10) * plotH;
        svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${gy}" y2="${gy}" stroke="${grid}" stroke-width="1" stroke-dasharray="4 4"/>`);
        const val = Math.round((1 - i / 10) * maxVal);
        svgParts.push(`<text x="${padding.left - 12}" y="${gy + 4}" text-anchor="end" class="label">${val}</text>`);
    }

    monthPoints.forEach((dayIdx, mIdx) => {
        if (dayIdx < points.length) {
            const p = points[dayIdx];
            svgParts.push(`<text x="${p.x.toFixed(2)}" y="${height - 18}" text-anchor="middle" class="monthLabel">${monthNames[mIdx]}</text>`);
        }
    });

    svgParts.push(`<path d="${areaPath}" class="area"/>`);
    svgParts.push(`<path d="${pathD}" class="curve-glow"/>`);
    svgParts.push(`<path d="${pathD}" class="curve draw" id="mainPath"/>`);

    svgParts.push(`<circle class="particle">
    <animateMotion dur="${dur}" begin="0s" fill="freeze">
      <mpath href="#mainPath"/>
    </animateMotion>
  </circle>`);

    points.forEach((p, i) => {
        if (p.v > 0) {
            svgParts.push(`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2" class="dot" style="animation-delay: ${0.5 + i * 0.002}s"/>`);
            svgParts.push(`<title>${format(p.dt, 'MMM dd, yyyy')}: ${p.v} contributions</title>`);
            if (p.v >= maxVal * 0.5) {
                svgParts.push(`<text x="${p.x.toFixed(2)}" y="${(p.y - 10).toFixed(2)}" text-anchor="middle" class="label">${p.v}</text>`);
            }
        }
    });

    svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${baselineY}" y2="${baselineY}" stroke="${axis}" stroke-width="1"/>`);
    svgParts.push(`<line x1="${padding.left}" x2="${padding.left}" y1="${padding.top}" y2="${baselineY}" stroke="${axis}" stroke-width="1"/>`);
    svgParts.push(`</svg>`);

    const svg = svgParts.join('\n');
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, svg, 'utf8');
    console.log('✅ Wrote', args.out);

    const monthlyTotals = Array.from({ length: 12 }, () => 0);
    counts.forEach((v, k) => monthlyTotals[getMonth(parseISO(k))] += v);
    const total = dailyCounts.reduce((s, v) => s + v, 0);
    console.log(`Monthly totals: ${monthlyTotals.join(', ')}`);
    console.log(`Total contributions in ${year}: ${total}`);
}

run().catch(err => { console.error('Unhandled error:', err); process.exit(99); });