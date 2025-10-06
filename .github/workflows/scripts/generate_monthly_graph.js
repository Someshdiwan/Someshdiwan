#!/usr/bin/env node
/**
 * generate_monthly_graph.js
 * Fetches GitHub contribution days for a year and renders a month-by-month SVG.
 *
 * Usage:
 *   GH_TOKEN=... node scripts/generate_monthly_graph.js --user Someshdiwan --year 2025 --out ./assets/contrib-monthly.svg
 *
 * Dependencies:
 *   npm i @octokit/graphql date-fns
 */

const { graphql } = require("@octokit/graphql");
const { parseISO, format, startOfYear, endOfYear, eachDayOfInterval, getMonth, getDay, getDate, getYear } = require("date-fns");
const fs = require("fs");
const path = require("path");

async function run() {
    const args = require("minimist")(process.argv.slice(2), {
        string: ["user", "out"],
        integer: ["year"],
        default: { year: new Date().getFullYear(), out: "./assets/contrib-monthly.svg" },
    });

    if (!args.user) {
        console.error("Usage: --user <github-username> [--year <yyyy>] [--out <path>]");
        process.exit(1);
    }

    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
        console.error("GH_TOKEN or GITHUB_TOKEN env required");
        process.exit(2);
    }

    const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${token}` } });

    const year = Number(args.year);
    const from = startOfYear(new Date(year, 0, 1)).toISOString();
    const to = endOfYear(new Date(year, 11, 31)).toISOString();

    // GraphQL query: contributionCalendar -> weeks -> contributionDays(date,count)
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

    const resp = await graphqlWithAuth(query, { login: args.user, from, to });
    const weeks = resp.user.contributionsCollection.contributionCalendar.weeks;

    // Flatten contributionDays
    const days = [];
    weeks.forEach((w) => {
        w.contributionDays.forEach((d) => days.push({ date: d.date, count: d.contributionCount }));
    });

    // Build map date -> count
    const counts = new Map();
    days.forEach((d) => counts.set(d.date, d.count));

    // For safety, ensure we have an entry for every day of the year
    const allDays = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
    allDays.forEach((dt) => {
        const key = format(dt, "yyyy-MM-dd");
        if (!counts.has(key)) counts.set(key, 0);
    });

    // Group by month (0-11)
    const months = Array.from({ length: 12 }, () => []); // months[0] => January entries
    counts.forEach((value, key) => {
        const dt = parseISO(key);
        const m = getMonth(dt); // 0..11
        months[m].push({ date: key, count: value, dt });
    });

    // Determine color scale — simple steps (adjust hex palette to taste)
    const colorSteps = [
        "#ebedf0", // 0
        "#c6e48b",
        "#7bc96f",
        "#239a3b",
        "#196127", // highest
    ];

    // Compute bucket thresholds (quantiles) to distribute counts across palette
    const allCounts = Array.from(counts.values());
    const max = Math.max(...allCounts);
    // Simple mapping function: 0 -> 0, >0 scaled into 1..4
    const mapToColor = (n) => {
        if (n <= 0) return colorSteps[0];
        const idx = Math.min(4, Math.ceil((n / (max || 1)) * 4));
        return colorSteps[idx];
    };

    // SVG layout parameters
    const cell = 12;       // square size (px)
    const gap = 3;         // gap between squares
    const monthPadding = 24; // space between month blocks
    const monthsPerRow = 3; // 3 columns x 4 rows => 12 months

    // function to render a month's mini-grid
    function renderMonth(monthIndex, monthDays) {
        // We'll build a calendar grid for that month: columns = number of weeks in that month
        // Determine first day of month and number of days
        const yearStart = new Date(year, monthIndex, 1);
        const firstWeekday = getDay(yearStart); // 0 (Sunday) .. 6
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const totalCells = firstWeekday + daysInMonth;
        const cols = Math.ceil(totalCells / 7);

        const squares = [];
        // create reverse mapping date->count quickly
        const map = new Map(monthDays.map((m) => [format(m.dt, "yyyy-MM-dd"), m.count]));

        // loop day numbers 1..daysInMonth, place at (week, weekday)
        for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(year, monthIndex, d);
            const weekday = getDay(dt); // 0..6
            // week index relative to month: floor((weekday + dayNumberOffset)/7)
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

    // render all months and compute overall SVG size
    const monthRenders = months.map((m, i) => ({ i, monthName: format(new Date(year, i, 1), "LLLL"), ...renderMonth(i, m) }));

    const colWidth = Math.max(...monthRenders.map((mr) => mr.colsPx)) + 8; // +8 padding
    const rowHeight = monthRenders[0].rowsPx + 28; // + label area

    const cols = monthsPerRow;
    const rows = Math.ceil(12 / monthsPerRow);

    const svgWidth = cols * colWidth + (cols + 1) * monthPadding;
    const svgHeight = rows * rowHeight + (rows + 1) * monthPadding;

    // Build SVG string
    const header = `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contributions (${year}) - month by month">
    <style>
      .label { font-family: Inter, Arial, sans-serif; font-size:12px; fill:#222; }
      .small { font-size:10px; fill:#666; }
      .month-name { font-family: Inter, Arial, sans-serif; font-size:13px; fill:#0b1220; font-weight:600; }
      .cell { rx: 2; ry: 2; }
      .tooltip { pointer-events: none;}
    </style>
  `;

    const bodyParts = [header];

    monthRenders.forEach((mr, idx) => {
        const col = idx % monthsPerRow;
        const row = Math.floor(idx / monthsPerRow);
        const originX = monthPadding + col * (colWidth + monthPadding);
        const originY = monthPadding + row * (rowHeight + monthPadding);

        // Month title
        bodyParts.push(`<g transform="translate(${originX}, ${originY})">`);
        bodyParts.push(`<text class="month-name" x="0" y="12">${mr.monthName} ${year}</text>`);

        // Render squares
        const offsetY = 18;
        const offsetX = 0;
        mr.squares.forEach((sq) => {
            const sx = offsetX + sq.x;
            const sy = offsetY + sq.y;
            bodyParts.push(`<rect class="cell" x="${sx}" y="${sy}" width="${cell}" height="${cell}" fill="${sq.color}" stroke="rgba(0,0,0,0.06)" stroke-width="0.5">
        <title>${sq.date} — ${sq.count} contributions</title>
      </rect>`);
        });

        // month legend (small)
        bodyParts.push(`<g transform="translate(${mr.colsPx + 8}, ${offsetY})">`);
        bodyParts.push(`<text class="small" x="0" y="-6">Less</text>`);
        colorSteps.forEach((c, ci) => {
            const lx = ci * (cell + 2);
            const ly = -4;
            bodyParts.push(`<rect x="${lx}" y="${ly}" width="${cell}" height="${cell}" fill="${c}" stroke="rgba(0,0,0,0.06)" stroke-width="0.4" />`);
        });
        bodyParts.push(`<text class="small" x="${colorSteps.length * (cell + 2) + 6}" y="6">More</text>`);
        bodyParts.push(`</g>`);

        bodyParts.push("</g>");
    });

    bodyParts.push("</svg>");
    const svg = bodyParts.join("\n");

    // Ensure output directory exists
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg, "utf8");
    console.log("Wrote", outPath);
}

run().catch((err) => {
    console.error(err);
    process.exit(99);
});