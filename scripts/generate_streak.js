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


function makeStreakSVG(streak) {
    const width = 420;
    const height = 300;
    const daysText = String(streak);

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub streak ${escapeXml(daysText)} days">
  <defs>
    <filter id="cardShadow" x="-50%" y="-50%" width="220%" height="220%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="4" dy="12" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- Softer, warmer card gradient (for optional filled mode) -->
    <linearGradient id="cardGrad" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%"   stop-color="#fff5c9"/>
      <stop offset="100%" stop-color="#ffe09a"/>
    </linearGradient>

    <!-- Number/Title gradient with a touch more contrast -->
    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%"   stop-color="#fff2c9"/>
      <stop offset="55%"  stop-color="#ffc960"/>
      <stop offset="100%" stop-color="#e36c07"/>
    </linearGradient>

    <!-- Subtle glow for text to read well on dark/light -->
    <filter id="textGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="rgba(0,0,0,0.25)"/>
    </filter>

    <style>
      .card-font { font-family: "Permanent Marker","Comic Sans MS","Segoe UI",Roboto,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
      .title { fill:url(#numGrad); font-weight:700; font-size:20px; text-anchor:middle; filter:url(#textGlow); }
      .big   { fill:url(#numGrad); font-weight:900; font-size:80px; text-anchor:middle; filter:url(#textGlow); }
      .sub   { fill:#444; font-size:16px; text-anchor:middle; }

      .floaty  { animation: floaty 7200ms ease-in-out infinite; transform-origin: center; }
      .flicker { animation: flicker 5600ms ease-in-out infinite; transform-origin: center; }

      @keyframes floaty {
        0%   { transform: translateY(0); }
        50%  { transform: translateY(-6px); }
        100% { transform: translateY(0); }
      }
      @keyframes flicker {
        0%   { transform: scale(1);     opacity:1;    filter:brightness(1); }
        35%  { transform: scale(0.992); opacity:0.94; filter:brightness(0.96); }
        70%  { transform: scale(1.01);  opacity:1;    filter:brightness(1.05); }
        100% { transform: scale(1);     opacity:1;    filter:brightness(1); }
      }
    </style>
  </defs>

  <!-- Transparent card outline (leave fill none). Uncomment ONE rect below to use filled background. -->
  <g filter="url(#cardShadow)">
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" ry="22"
          fill="none" stroke="#e6d09a" stroke-width="1.2"/>
    <!-- Optional fills:
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" fill="#0f2527"/>
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" fill="#072021"/>
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" fill="url(#cardGrad)"/>
    -->
  </g>

  <!-- Text -->
  <g class="card-font">
    <text x="${width/2}" y="70"  class="title">GitHub Streak</text>
    <text x="${width/2}" y="150" class="big">${escapeXml(daysText)}</text>
    <text x="${width/2}" y="190" class="sub">Days</text>
  </g>

  <!-- Small flame (inside, near the title; nudged inward a bit) -->
  <g transform="translate(${width/2 - 58}, 90) scale(0.50)" class="floaty">
    <g class="flicker">
      <path d="M18 -6 C12 -16 -4 -18 -10 -6 C-14 2 -10 22 6 24 C20 26 26 10 18 -6 Z" fill="#ffb45a"/>
      <path d="M10 6 C7 1 0 1 -2 6 C-3 9 0 14 6 14 C10 14 14 12 10 6 Z" fill="#fff3d6" opacity="0.55"/>
    </g>
  </g>

  <!-- BIG flame (bottom-center; drawn last; gentle orange core + red heart) -->
  <g transform="translate(${width/2}, 248) scale(0.94)" class="floaty">
    <ellipse cx="0" cy="18" rx="36" ry="10" fill="rgba(0,0,0,0.10)"/>
    <g class="flicker">
      <path d="M36 -8 C26 -24 -8 -28 -18 -8 C-26 6 -18 34 12 36 C36 38 44 16 36 -8 Z" fill="#ff9b2d" opacity="0.98"/>
      <path d="M24 8 C18 2 6 2 2 8 C0 12 4 18 12 18 C18 18 26 14 24 8 Z" fill="#ff4a00" opacity="0.92"/>
      <path d="M8 -2 C6 -8 0 -10 -4 -2 C-4 0 -1 4 6 4 C9 4 12 2 8 -2 Z" fill="#fff5dc" opacity="0.28"/>
    </g>
  </g>

  <a xlink:href="https://github.com/${encodeURIComponent(repoOwner)}" target="_blank" rel="noopener">
    <rect x="0" y="0" width="${width}" height="${height}" fill="none"/>
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
                    finalStreak = state.streak;
                    console.log('Using saved state (same day):', state);
                } else {
                    const range = datesBetweenInclusive(savedDate, lastDayDate);
                    const dayMap = buildDayMap(days);
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
