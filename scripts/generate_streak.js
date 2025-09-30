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


function escapeXml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * Returns an SVG string for a Duolingo-like streak card.
 * @param {number|string} streak - number of days (e.g., 139)
 * @param {object} opts - optional tweaks
 *   { width=420, height=360, title="day streak" }
 */
function makeStreakSVG(streak, opts = {}) {
    const width  = opts.width  ?? 420;
    const height = opts.height ?? 360;
    const title  = opts.title  ?? "day streak";
    const daysText = escapeXml(String(streak));

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     role="img" aria-label="${daysText} ${escapeXml(title)}">
  <defs>
    <!-- shadows -->
    <filter id="cardShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="12"/>
      <feOffset dx="0" dy="10" result="off"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.22"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
      <feOffset dx="0" dy="3"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- gradients -->
    <linearGradient id="numGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#FFE9B0"/>
      <stop offset="55%" stop-color="#FFB12E"/>
      <stop offset="100%" stop-color="#F36A00"/>
    </linearGradient>

    <radialGradient id="glow" cx="50%" cy="40%" r="65%">
      <stop offset="0%"  stop-color="#ffdf86" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#ff9a2a" stop-opacity="0"/>
    </radialGradient>

    <style>
      .font { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; }
      .num { fill: url(#numGrad); font-weight: 900; text-anchor: middle; filter: url(#textShadow); }
      .sub { fill: #ffb54a; opacity: 0.95; font-weight: 700; text-anchor: middle; letter-spacing: 0.6px; }

      .floaty { animation: bob 6s ease-in-out infinite; transform-origin: center; }
      .flicker { animation: flicker 2.8s ease-in-out infinite; transform-origin: center; }
      .pulse { animation: pulse 3.2s ease-in-out infinite; }

      @keyframes bob {
        0%   { transform: translateY(0px); }
        50%  { transform: translateY(-6px); }
        100% { transform: translateY(0px); }
      }
      @keyframes flicker {
        0%   { filter: brightness(1);   opacity: 1;   transform: scale(1); }
        25%  { filter: brightness(0.95);opacity: 0.94;transform: scale(0.995); }
        50%  { filter: brightness(1.06);opacity: 1;   transform: scale(1.01); }
        75%  { filter: brightness(0.98);opacity: 0.97;transform: scale(0.997); }
        100% { filter: brightness(1);   opacity: 1;   transform: scale(1); }
      }
      @keyframes pulse {
        0%   { opacity: 0.18; }
        50%  { opacity: 0.42; }
        100% { opacity: 0.18; }
      }
    </style>
  </defs>

  <!-- dark rounded card -->
  <g filter="url(#cardShadow)">
    <rect x="14" y="14" width="${width-28}" height="${height-28}" rx="28" ry="28" fill="#0f1720" stroke="#0b1118" stroke-width="1.5"/>
  </g>

  <!-- subtle flame glow -->
  <ellipse class="pulse" cx="${width/2}" cy="96" rx="120" ry="70" fill="url(#glow)"/>

  <!-- flame group -->
  <g class="floaty" transform="translate(${width/2}, 92)">
    <ellipse cx="0" cy="42" rx="40" ry="12" fill="rgba(0,0,0,0.22)"/>
    <g class="flicker">
      <!-- outer flame -->
      <path d="M24 -6 C16 -22 -10 -26 -18 -8 C-24 4 -16 36 10 40 C34 44 42 18 24 -6 Z"
            fill="#ffb135"/>
      <!-- mid flame -->
      <path d="M10 4 C4 -2 -8 -2 -12 8 C-14 16 -4 28 8 28 C20 28 28 18 10 4 Z"
            fill="#ff7a12"/>
      <!-- inner drop -->
      <path d="M-1 -4 C-6 -10 -12 -4 -12 3 C-12 10 -6 14 0 12 C6 10 10 4 -1 -4 Z"
            fill="#fff5cf" opacity="0.82"/>
    </g>
  </g>

  <!-- number -->
  <g class="font">
    <text x="${width/2}" y="${height/2 + 25}"
          class="num"
          font-size="${Math.min(112, width * 0.26)}">${daysText}</text>
    <text x="${width/2}" y="${height/2 + 64}" class="sub" font-size="20">${escapeXml(title)}</text>
  </g>
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
