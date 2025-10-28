// scripts/generate_streak.js
const { graphql } = require('@octokit/graphql');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(process.cwd(), 'streak_state.json');

const token = process.env.GITHUB_TOKEN;
if (!token) {
    console.error('GITHUB_TOKEN is required in env');
    process.exit(1);
}

const repoOwner = (process.env.GITHUB_REPOSITORY || '').split('/')[0];
if (!repoOwner) {
    console.error('GITHUB_REPOSITORY not set or malformed');
    process.exit(1);
}

const graphqlWithAuth = graphql.defaults({
    headers: { authorization: `token ${token}` },
});

async function fetchContributionCalendar(login) {
    const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }`;
    const res = await graphqlWithAuth(query, { login });
    return res.user.contributionsCollection.contributionCalendar;
}

function flattenDays(calendar) {
    const days = [];
    for (const week of calendar.weeks) {
        for (const d of week.contributionDays) {
            days.push({ date: d.date, count: d.contributionCount });
        }
    }
    days.sort((a, b) => new Date(a.date) - new Date(b.date));
    return days;
}
function calendarStreakFromLastDay(days) {
    let i = days.length - 1;
    let streak = 0;
    for (; i >= 0; i--) {
        if (days[i].count > 0) streak++;
        else break;
    }
    return { streak, lastDayDate: days[days.length - 1]?.date };
}
function datesBetweenInclusive(startDateStr, endDateStr) {
    const res = [];
    let cur = new Date(startDateStr + 'T00:00:00Z');
    const end = new Date(endDateStr + 'T00:00:00Z');
    cur.setUTCDate(cur.getUTCDate() + 1);
    while (cur <= end) {
        res.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return res;
}
function buildDayMap(days) {
    const map = new Map();
    for (const d of days) map.set(d.date, d.count);
    return map;
}
function readState() {
    try {
        if (!fs.existsSync(STATE_FILE)) return null;
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (err) {
        console.warn('Could not read state file:', err.message);
        return null;
    }
}
function writeState(obj) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2), 'utf8');
}
function escapeXml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c]));
}

/**
 * makeStreakSVG v2 — safer, themeable, accessible, responsive
 *
 * Notable upgrades:
 * - Unique IDs per instance to avoid gradient/filter collisions
 * - Built-in escapeXml + number formatting + auto-fit text
 * - Optional background (transparent | warm | dark) with border toggle
 * - prefers-reduced-motion support
 * - Proper <title>/<desc> for screen readers + aria-labelledby
 * - Responsive (viewBox only; width/height optional)
 */
function makeStreakSVG(streak, {
    width = 420,
    height = 300,
    repoOwner = "your-github",
    theme = "auto",           // "light" | "dark" | "auto"
    bg = "transparent",       // "transparent" | "warm" | "dark" | "medium"
    showBorder = true,
    fontFamily = `'Permanent Marker','Comic Sans MS','Segoe UI',Roboto,Arial,sans-serif`,
    reduceMotion = false,     // force-reduce motion regardless of user setting
    title = "GitHub Streak",
    label = "Days",
} = {}) {
    const uid = `streak${Math.random().toString(36).slice(2, 8)}`;
    const esc = (s) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    const daysText = new Intl.NumberFormat("en-US").format(Number(streak ?? 0));
    const vbW = width, vbH = height;
    const innerW = vbW - 40, innerH = vbH - 40;

    // Theme colors (mild contrast tweaks for dark)
    const palette = {
        light: {
            stroke: "#e6d09a",
            cardGrad0: "#fff6c7",
            cardGrad1: "#ffe29a",
            textSub: "#444",
            shadowA: 0.28,
        },
        dark: {
            stroke: "#0b1a1a",
            cardGrad0: "#0f2527",
            cardGrad1: "#072021",
            textSub: "#cfd9d9",
            shadowA: 0.34,
        },
    };

    // Resolve theme at render (still pure SVG; no JS in the SVG)
    const pick = (lightVal, darkVal) => {
        if (theme === "light") return lightVal;
        if (theme === "dark") return darkVal;
        // "auto": we use CSS media queries inside SVG to swap vars
        return lightVal; // default; CSS below overrides in dark
    };

    // Background choice
    const bgRect = (() => {
        if (bg === "warm") {
            return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="url(#${uid}-cardGrad)" ${showBorder ? `stroke="${pick(palette.light.stroke, palette.dark.stroke)}" stroke-width="1.2"` : ""}/>`;
        }
        if (bg === "dark") {
            return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="${palette.dark.cardGrad0}" ${showBorder ? `stroke="${palette.dark.stroke}" stroke-width="1.2"` : ""}/>`;
        }
        if (bg === "medium") {
            return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="${palette.dark.cardGrad1}" ${showBorder ? `stroke="${palette.dark.stroke}" stroke-width="1.0"` : ""}/>`;
        }
        // transparent
        return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="none" ${showBorder ? `stroke="${pick(palette.light.stroke, palette.dark.stroke)}" stroke-width="1.2"` : ""}/>`;
    })();

    // Auto-fit the big number a little if it gets long
    const baseFont = 80;
    const digits = String(streak ?? 0).length;
    const scale = digits <= 3 ? 1 : digits === 4 ? 0.9 : digits === 5 ? 0.8 : 0.72;
    const bigDY = digits >= 6 ? -4 : 0;

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 ${vbW} ${vbH}"
     role="img"
     aria-labelledby="${uid}-title ${uid}-desc">
  <title id="${uid}-title">${esc(title)}</title>
  <desc id="${uid}-desc">${esc(`GitHub streak counter for ${repoOwner}: ${daysText} ${label}.`)}</desc>

  <defs>
    <clipPath id="${uid}-cardClip">
      <rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22"/>
    </clipPath>

    <filter id="${uid}-cardShadow" x="-50%" y="-50%" width="220%" height="220%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="4" dy="12" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="${pick(palette.light.shadowA, palette.dark.shadowA)}"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- Light warm gradient OR used for warm bg -->
    <linearGradient id="${uid}-cardGrad" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${palette.light.cardGrad0}"/>
      <stop offset="100%" stop-color="${palette.light.cardGrad1}"/>
    </linearGradient>

    <linearGradient id="${uid}-numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#fff8df"/>
      <stop offset="55%" stop-color="#ffd26a"/>
      <stop offset="100%" stop-color="#e66a00"/>
    </linearGradient>

    <style>
      :root { --sub:#444; --stroke:${palette.light.stroke}; }
      @media (prefers-color-scheme: dark) {
        :root { --sub:${palette.dark.textSub}; --stroke:${palette.dark.stroke}; }
      }
      /* If user forces reduced motion OR you pass reduceMotion=true, we pause keyframes */
      ${reduceMotion ? `
      .floaty, .flicker { animation: none !important; }
      ` : `
      @media (prefers-reduced-motion: reduce) {
        .floaty, .flicker { animation: none !important; }
      }`}

      .card-font { font-family: ${fontFamily}; -webkit-font-smoothing:antialiased; }
      .title { fill:url(#${uid}-numGrad); font-weight:700; font-size:20px; text-anchor:middle; }
      .big   { fill:url(#${uid}-numGrad); font-weight:900; font-size:${baseFont}px; text-anchor:middle;
               filter: drop-shadow(0 4px 6px rgba(0,0,0,0.14)); }
      .sub   { fill: var(--sub); font-size:16px; text-anchor:middle; }
      .egg-shadow { fill: rgba(0,0,0,0.12); }
      .floaty { animation: ${uid}-floaty 7000ms ease-in-out infinite; transform-origin: center; }
      .flicker { animation: ${uid}-flicker 5200ms linear infinite; transform-origin: center; }
      @keyframes ${uid}-floaty { 0%{transform:translateY(0)} 50%{transform:translateY(-6px)} 100%{transform:translateY(0)} }
      @keyframes ${uid}-flicker {
        0% { transform:scale(1); opacity:1; filter:brightness(1); }
        40%{ transform:scale(.992); opacity:.92; filter:brightness(.96); }
        80%{ transform:scale(1.01); opacity:1; filter:brightness(1.05); }
        100%{transform:scale(1); opacity:1; filter:brightness(1); }
      }
      a, a:link, a:visited { cursor: pointer; }
    </style>
  </defs>

  <!-- Card body -->
  <g filter="url(#${uid}-cardShadow)">
    ${bgRect}
  </g>

  <g clip-path="url(#${uid}-cardClip)">
    <!-- Left flame shadow -->
    <g transform="translate(58,76)">
      <ellipse class="egg-shadow" cx="30" cy="86" rx="46" ry="14" opacity="0.10"/>
    </g>

    <!-- Left flame -->
    <g transform="translate(60,70)">
      <g class="floaty">
        <g class="flicker" transform="translate(0,0) scale(0.92)">
          <path d="M70 18 C50 -6 36 -6 22 18 C10 36 14 78 40 84 C66 90 80 56 70 18 Z" fill="#ffb44a"/>
          <path d="M56 40 C50 28 42 30 36 42 C34 48 42 66 54 62 C62 58 68 50 56 40 Z" fill="#ff6a24" opacity="0.98"/>
          <path d="M52 14 C46 8 44 10 40 16 C38 22 44 28 52 26 C58 24 64 18 52 14 Z" fill="#fff5d8" opacity="0.55"/>
        </g>
      </g>
    </g>

    <!-- Text -->
    <g class="card-font">
      <text x="${vbW/2}" y="70" class="title">${esc(title)}</text>
      <g transform="translate(${vbW/2}, ${150 + bigDY}) scale(${scale})">
        <text x="0" y="0" class="big">${esc(daysText)}</text>
      </g>
      <text x="${vbW/2}" y="190" class="sub">${esc(label)}</text>
    </g>

    <!-- Big center flame -->
    <g transform="translate(${vbW/2}, 240) scale(0.98)" class="floaty" aria-hidden="true">
      <ellipse cx="0" cy="18" rx="36" ry="10" fill="rgba(0,0,0,0.10)" />
      <g class="flicker">
        <path d="M36 -8 C26 -24 -8 -28 -18 -8 C-26 6 -18 34 12 36 C36 38 44 16 36 -8 Z" fill="#ff9a2a" opacity="0.96"/>
        <path d="M24 8 C18 2 6 2 2 8 C0 12 4 18 12 18 C18 18 26 14 24 8 Z" fill="#ff4b00" opacity="0.92"/>
        <path d="M8 -2 C6 -8 0 -10 -4 -2 C-4 0 -1 4 6 4 C9 4 12 2 8 -2 Z" fill="#fff7de" opacity="0.28"/>
      </g>
    </g>

    <!-- Small flicker -->
    <g transform="translate(${vbW/2 + 28}, 218) scale(0.52)" class="floaty" aria-hidden="true">
      <g class="flicker">
        <path d="M14 -4 C10 -12 -4 -14 -8 -4 C-10 2 -6 18 4 18 C12 18 18 8 14 -4 Z" fill="#ffb95a" />
        <path d="M8 6 C6 2 0 2 -1 6 C-1 9 2 12 6 12 C9 12 12 10 8 6 Z" fill="#fff6d8" opacity="0.55"/>
      </g>
    </g>
  </g>

  <!-- Click-through overlay (kept outside clip so the whole card is clickable) -->
  <a xlink:href="https://github.com/${encodeURIComponent(repoOwner)}" target="_blank" rel="noopener">
    <rect x="0" y="0" width="${vbW}" height="${vbH}" fill="none" pointer-events="all"/>
  </a>
</svg>`;
}



(async () => {
    try {
        const calendar = await fetchContributionCalendar(repoOwner);
        const days = flattenDays(calendar);
        if (!days.length) throw new Error('No contribution data found.');

        console.log('last12:', days.slice(-12).map(d => `${d.date}:${d.count}`).join(', '));

        const { streak: calendarStreak, lastDayDate } = calendarStreakFromLastDay(days);
        console.log('calendarStreak:', calendarStreak, 'lastDayDate:', lastDayDate);

        const state = readState();
        let finalStreak = calendarStreak;

        if (state && state.streak != null && state.date) {
            try {
                const savedDate = state.date;
                if (savedDate === lastDayDate) {
                    // If contributions increased today, use the larger of calendar vs saved
                    finalStreak = Math.max(calendarStreak, state.streak);
                    console.log('Same day — picking max(calendar, saved):', { calendarStreak, saved: state.streak, finalStreak });
                } else {
                    const range = datesBetweenInclusive(savedDate, lastDayDate);
                    const dayMap = buildDayMap(days);
                    writeState({ streak: finalStreak, date: lastDayDate, todayCount: dayMap.get(lastDayDate) || 0 });
                    const allHaveContrib = range.length > 0 && range.every(d => (dayMap.get(d) || 0) > 0);
                    if (allHaveContrib) {
                        finalStreak = state.streak + range.length;
                        console.log('Continuing saved streak. added days:', range.length, '->', finalStreak);
                    } else {
                        console.log('Cannot continue saved streak — gap found, falling back to calendar streak.');
                        finalStreak = calendarStreak;
                    }
                }
            } catch (err) {
                console.warn('Error while attempting to resume state:', err.message);
                finalStreak = calendarStreak;
            }
        } else {
            console.log('No saved state found — using calendar streak.');
        }

        const svg = makeStreakSVG(finalStreak);
        const outPath = path.join(process.cwd(), 'streak.svg');
        fs.writeFileSync(outPath, svg, 'utf8');
        writeState({ streak: finalStreak, date: lastDayDate });

        console.log(`Wrote streak.svg — finalStreak=${finalStreak}, lastDay=${lastDayDate}`);
    } catch (err) {
        console.error('Error generating streak svg:', err);
        process.exit(1);
    }
})();
