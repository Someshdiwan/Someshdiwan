// scripts/generate_streak.js
/**
 * Generates an animated SVG 'streak.svg' for your GitHub profile.
 * Uses GitHub GraphQL via the action-provided GITHUB_TOKEN.
 *
 * Logic is unchanged. Only the SVG UI (makeStreakSVG) is replaced to
 * produce a sticky-note card that visually matches the WakaTime card:
 * - larger centered number
 * - properly aligned left flame (animated float + subtle flicker)
 * - improved gradients, notch, and drop-shadow
 * - Comic/rounded handwritten style fonts (fallbacks included)
 */

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
    headers: {
        authorization: `token ${token}`,
    },
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
    }
  `;
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
    // count consecutive >0 days starting from the last available day backwards
    let i = days.length - 1;
    let streak = 0;
    for (; i >= 0; i--) {
        if (days[i].count > 0) streak++;
        else break;
    }
    return { streak, lastDayDate: days[days.length - 1]?.date };
}

function datesBetweenInclusive(startDateStr, endDateStr) {
    // returns array of YYYY-MM-DD strings from startDate (exclusive) to endDate (inclusive)
    const res = [];
    let cur = new Date(startDateStr + 'T00:00:00Z');
    const end = new Date(endDateStr + 'T00:00:00Z');
    cur.setUTCDate(cur.getUTCDate() + 1); // start from next day after startDate
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
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        return JSON.parse(raw);
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
function safeFontFamily() {
    return `"Comic Sans MS","Cosmic Sans MS","Segoe UI",Roboto,Arial,sans-serif`;
}

/* UI only: produce sticky-note streak card that matches the WakaTime look.
   - width/height 420x300 to match WakaTime card
   - left flame aligned & animated (float + tiny flicker)
   - centered big rounded number, matching handwritten style
   - subtle notch & drop shadow under the card
*/

function makeStreakSVG(streak) {
    const width = 420;
    const height = 300;
    const daysText = String(streak);

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub streak ${escapeXml(daysText)} days">
  <defs>
    <filter id="cardShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="4" dy="12" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.3"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <linearGradient id="cardGrad" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#fff9e0"/>
      <stop offset="100%" stop-color="#ffe8a3"/>
    </linearGradient>

    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffca28"/>
      <stop offset="100%" stop-color="#f57c00"/>
    </linearGradient>

    <style>
      .card-font { font-family: "Permanent Marker","Comic Sans MS","Segoe UI",Roboto,Arial,sans-serif; font-smoothing:antialiased; }
      .title { fill:#5a4a20; font-weight:700; font-size:22px; text-anchor:middle; letter-spacing:1px; }
      .big { fill:url(#numGrad); font-weight:900; font-size:92px; text-anchor:middle; filter: drop-shadow(0 4px 4px rgba(0,0,0,0.2)); }
      .sub { fill:#666; font-size:18px; text-anchor:middle; letter-spacing:0.5px; }
      .egg-shadow { fill: rgba(0,0,0,0.15); }
      .flame-anim { animation: floaty 2800ms ease-in-out infinite; transform-origin: 100px 80px; }
      .flame-flicker { animation: flicker 1600ms ease-in-out infinite; transform-origin: 100px 80px; }
      @keyframes floaty { 0%{transform:translateY(0)} 50%{transform:translateY(-8px)} 100%{transform:translateY(0)} }
      @keyframes flicker { 0%{transform:scale(1)} 50%{transform:scale(0.98)} 100%{transform:scale(1)} }
    </style>
  </defs>

  <!-- sticky card body with subtle texture -->
  <g filter="url(#cardShadow)">
    <path d="M20 16 h320 a24 24 0 0 1 24 24 v140 a24 24 0 0 1 -24 24 h-160 q-10 6 -20 6 t-20 -6 h-160 a24 24 0 0 1 -24 -24 v-140 a24 24 0 0 1 24 -24 z"
          fill="url(#cardGrad)" stroke="#f0e0a0" stroke-width="1.5"/>
    <path d="M340 60 q-8 16 -24 24" stroke="#f5e0a0" stroke-width="1.5" fill="none" opacity="0.7"/>
    <ellipse cx="316" cy="40" rx="8" ry="4" fill="#fff9e0" opacity="0.8"/>
  </g>

  <!-- left flame -->
  <g transform="translate(60,36)">
    <ellipse class="egg-shadow" cx="30" cy="90" rx="80" ry="20" opacity="0.12"/>
    <g class="flame-anim" transform="translate(0,-8)">
      <g class="flame-flicker" transform="translate(0,0) scale(0.96)">
        <path d="M90 20 C70 -4 46 -4 32 20 C20 38 24 88 60 94 C96 100 110 60 90 20 Z" fill="#ffca28"/>
        <path d="M78 52 C70 40 56 40 48 52 C44 60 52 72 66 68 C76 66 86 60 78 52 Z" fill="#fff3d8" opacity="0.95"/>
        <path d="M72 14 C66 8 54 10 50 16 C48 22 54 28 62 26 C68 24 74 18 72 14 Z" fill="#ffe082" opacity="0.97"/>
      </g>
    </g>
  </g>

  <!-- top-right mini flame -->
  <g transform="translate(${width - 90}, 44) scale(0.6)" class="flame-anim">
    <ellipse cx="0" cy="26" rx="24" ry="8" fill="rgba(0,0,0,0.15)" />
    <path d="M22 -8 C14 -20 -6 -22 -14 -8 C-20 2 -14 28 8 30 C26 32 32 12 22 -8 Z" fill="#ffca28"/>
    <path d="M14 6 C10 0 0 0 -4 6 C-6 10 -2 16 6 16 C12 16 18 12 14 6 Z" fill="#fff3d8" opacity="0.92"/>
  </g>

  <!-- centered texts -->
  <g class="card-font">
    <text x="${width/2}" y="74" class="title">GitHub Streak</text>
    <text x="${width/2}" y="160" class="big">${escapeXml(daysText)}</text>
    <text x="${width/2}" y="192" class="sub">Days</text>
  </g>

  <!-- clickable link -->
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

        // debug: show last 12 days
        console.log('last12:', days.slice(-12).map(d => `${d.date}:${d.count}`).join(', '));

        const { streak: calendarStreak, lastDayDate } = calendarStreakFromLastDay(days);
        console.log('calendarStreak:', calendarStreak, 'lastDayDate:', lastDayDate);

        // attempt resume from saved state
        const state = readState();
        let finalStreak = calendarStreak;
        if (state && state.streak != null && state.date) {
            try {
                const savedDate = state.date;
                // If saved date is same as lastDayDate, use saved streak (no change)
                if (savedDate === lastDayDate) {
                    finalStreak = state.streak;
                    console.log('Using saved state (same day):', state);
                } else {
                    // Check each date between savedDate (exclusive) and lastDayDate (inclusive)
                    const range = datesBetweenInclusive(savedDate, lastDayDate);
                    const dayMap = buildDayMap(days);
                    // Are all days in range present and >0?
                    const allHaveContrib = range.length > 0 && range.every(d => (dayMap.get(d) || 0) > 0);
                    if (allHaveContrib) {
                        // continue streak
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

        // write svg and state
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
