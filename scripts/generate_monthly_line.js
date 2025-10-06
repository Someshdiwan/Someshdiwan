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

    // Build date -> count map (ensure correctness)
    const counts = new Map();
    weeks.forEach(w => (w.contributionDays || []).forEach(d => {
        if (d?.date) counts.set(d.date, d.contributionCount || 0);
    }));

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
        months[getMonth(dt)] += v;
    });

    // Layout
    const width = 1200, height = 340;
    const padding = { top: 44, right: 48, bottom: 60, left: 72 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const maxVal = Math.max(...months, 1);
    const points = months.map((v, i) => ({
        x: padding.left + (i / 11) * plotW,
        y: padding.top + plotH - (v / maxVal) * plotH,
        v, m: i
    }));

    const beziers = catmullRom2bezier(points);
    let pathD = `M ${points[0].x} ${points[0].y} `;
    for (const b of beziers) pathD += `C ${b.x1} ${b.y1}, ${b.x2} ${b.y2}, ${b.x} ${b.y} `;

    const baselineY = padding.top + plotH;
    const areaPath = `${pathD} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Theme & fonts
    const bg = '#0f1720', grid = 'rgba(255,255,255,0.04)', axis = 'rgba(255,255,255,0.1)';
    const stroke = '#60a5fa', strokeShadow = '#60a5fa', fill = 'url(#areaGradient)';
    const dotFill = '#9be7ff', textColor = '#e6eef6';
    const fontFamily = `'Comic Sans MS', 'Comic Sans', cursive`;

    // Animation durations (single source of truth for sync)
    const dur = '8s';

    // Build SVG
    const svgParts = [];
    svgParts.push(`<?xml version="1.0" encoding="utf-8"?>`);
    svgParts.push(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="svgTitle">`);
    svgParts.push(`<title id="svgTitle">Monthly contributions for ${year} — ${args.user}</title>`);
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
      /* fonts */
      text, .label, .monthLabel { font-family: ${fontFamily}; }
      .title { font-family: ${fontFamily}; font-size:18px; fill:${textColor}; font-weight:700; }
      .label { font-size:11px; fill:#c7d2da; }
      .monthLabel { font-size:12px; fill:#cfe8ff; }

      .curve { fill:none; stroke:${stroke}; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; filter:url(#softGlow); }
      .curve-glow { fill:none; stroke:${strokeShadow}; stroke-width:10; stroke-opacity:0.06; stroke-linecap:round; stroke-linejoin:round; }
      .area { fill:${fill}; opacity:0.95; }

      /* Slow looping draw animation with breathing effect */
      .draw {
        stroke-dasharray: 2200;
        stroke-dashoffset: 2200;
        animation: drawLine ${dur} cubic-bezier(0.65, 0, 0.35, 1) infinite;
      }
      @keyframes drawLine {
        0% { stroke-dashoffset: 2200; opacity: 0.3; }
        20% { opacity: 1; }
        70% { stroke-dashoffset: 0; opacity: 1; }
        85% { opacity: 0.8; }
        100% { stroke-dashoffset: 0; opacity: 0.3; }
      }

      /* Fading area reveal */
      .fadeIn { opacity: 0; animation: fadeInArea 2s ease-in-out 0.8s forwards; }
      @keyframes fadeInArea { to { opacity: 1; } }

      /* Glow pulse */
      @keyframes pulseGlow { 0%,100% { stroke-opacity: 0.05; } 50% { stroke-opacity: 0.15; } }
      .curve-glow { animation: pulseGlow ${dur} ease-in-out infinite; }

      /* Particle styling (the animated orb) */
      .particle { fill: #7dd3fc; stroke: #083344; stroke-width: 1.2; filter: url(#softGlow); }
    </style>
  </defs>`);

    svgParts.push(`<rect width="100%" height="100%" rx="12" fill="${bg}" />`);
    svgParts.push(`<text x="${width / 2}" y="${padding.top / 1.2}" text-anchor="middle" class="title">Contributions — ${year}</text>`);

    // Grid and Y-axis labels
    for (let i = 0; i <= 5; i++) {
        const gy = padding.top + (i / 5) * plotH;
        svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${gy}" y2="${gy}" stroke="${grid}" stroke-width="1" stroke-dasharray="4 4"/>`);
        const val = Math.round((1 - i / 5) * maxVal);
        svgParts.push(`<text x="${padding.left - 12}" y="${gy + 4}" text-anchor="end" class="label">${val}</text>`);
    }

    // Month labels
    points.forEach((p, i) => svgParts.push(`<text x="${p.x}" y="${height - 18}" text-anchor="middle" class="monthLabel">${monthNames[i]}</text>`));

    // Paths + animation
    svgParts.push(`<path d="${areaPath}" class="area fadeIn"/>`);
    svgParts.push(`<path d="${pathD}" class="curve-glow"/>`);
    svgParts.push(`<path d="${pathD}" class="curve draw" id="mainPath"/>`);

    // Particle: animateMotion + synchronized pulses (radius, fill-opacity, stroke-opacity)
    // Using SMIL animate elements: same dur as the main draw animation, repeatCount indefinite.
    svgParts.push(`
    <g>
      <circle id="particle" r="6" class="particle">
        <animate attributeName="r"
                 values="6;10;12;10;6"
                 keyTimes="0;0.2;0.55;0.85;1"
                 dur="${dur}"
                 repeatCount="indefinite" />
        <animate attributeName="fill-opacity"
                 values="0.2;0.9;1;0.9;0.2"
                 keyTimes="0;0.2;0.55;0.85;1"
                 dur="${dur}"
                 repeatCount="indefinite" />
        <animate attributeName="stroke-opacity"
                 values="0.2;0.9;1;0.9;0.2"
                 keyTimes="0;0.2;0.55;0.85;1"
                 dur="${dur}"
                 repeatCount="indefinite" />
        <animateMotion dur="${dur}" repeatCount="indefinite" rotate="auto">
          <mpath href="#mainPath" />
        </animateMotion>
      </circle>
    </g>
  `);

    // Dots + numeric labels
    points.forEach(p => {
        svgParts.push(`<circle cx="${p.x}" cy="${p.y}" r="4" fill="${dotFill}" stroke="#063241" stroke-width="1"/>`);
        if (p.v > 0) svgParts.push(`<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" class="label">${p.v}</text>`);
    });

    // Axes
    svgParts.push(`<line x1="${padding.left}" x2="${width - padding.right}" y1="${baselineY}" y2="${baselineY}" stroke="${axis}" stroke-width="1"/>`);
    svgParts.push(`<line x1="${padding.left}" x2="${padding.left}" y1="${padding.top}" y2="${baselineY}" stroke="${axis}" stroke-width="1"/>`);

    svgParts.push(`</svg>`);

    const svg = svgParts.join('\n');
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, svg, 'utf8');
    console.log('✅ Wrote', args.out);

    // CI-friendly totals log for quick verification
    const total = months.reduce((s, v) => s + v, 0);
    console.log(`Totals per month: ${months.join(', ')}`);
    console.log(`Total contributions in ${year}: ${total}`);
}

run().catch(err => { console.error('Unhandled error:', err); process.exit(99); });