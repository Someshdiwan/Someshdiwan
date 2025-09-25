// scripts/generate_streak.js
/**
 * Generates an animated SVG 'streak.svg' for your GitHub profile.
 * Uses GitHub GraphQL via the action-provided GITHUB_TOKEN.
 *
 * Logic left intact — only the SVG UI (makeStreakSVG) changed to match the
 * sticky-note style and alignment used for the WakaTime card.
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
    // prefer Cosmic/Comic like rounded handwritten font if available, fallback to system sans
    return `"Comic Sans MS","Cosmic Sans MS","Segoe UI",Roboto,Arial,sans-serif`;
}

/**
 * makeStreakSVG(streak)
 * Produces a 420x300 "sticky note" streak card visually matched to the
 * WakaTime sticky-note style. This is strictly a UI change only.
 */
function makeStreakSVG(streak) {
    const width = 420;
    const height = 300;
    const daysText = String(streak);

    // tuned positions, gradients, subtle drop shadows and flame placement
    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub streak ${escapeXml(daysText)} days">
  <defs>
    <filter id="sdrop" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="6" dy="18" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/>
    </filter>

    <linearGradient id="cardGrad" x1="0" x2="1">
      <stop offset="0%" stop-color="#fff7d1"/>
      <stop offset="100%" stop-color="#fff3be"/>
    </linearGradient>

    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd86b"/>
      <stop offset="100%" stop-color="#f39a2e"/>
    </linearGradient>

    <style>
      .card-font { font-family: ${safeFontFamily()}; -webkit-font-smoothing:antialiased; }
      .title { fill:#6b5a1f; font-weight:700; font-size:20px; }
      .big { fill:url(#numGrad); font-weight:800; font-size:108px; text-anchor:middle; filter: drop-shadow(0 6px 0 rgba(0,0,0,0.12)); }
      .sub { fill:#6b6b6b; font-size:18px; text-anchor:middle; }
      .egg-shadow { fill: rgba(0,0,0,0.18); }
      .flame { animation: floatUp 2400ms ease-in-out infinite; transform-origin: 120px 70px; }
      @keyframes floatUp { 0% { transform: translateY(0); } 50% { transform: translateY(-6px); } 100% { transform: translateY(0); } }
    </style>
  </defs>

  <!-- sticky card body with notch on bottom -->
  <g filter="url(#sdrop)">
    <path d="M24 20 h300 a26 26 0 0 1 26 26 v128 a26 26 0 0 1 -26 26 h-146 q-12 8 -24 8 t-24 -8 h-180 z"
          fill="url(#cardGrad)" stroke="#f0e0a8" stroke-width="1.3" />
    <!-- corner shine -->
    <path d="M330 64 q-6 18 -22 26" stroke="#f5e0a0" stroke-width="1.2" fill="none" opacity="0.65"/>
    <ellipse cx="312" cy="50" rx="6" ry="3" fill="#fff8d8" opacity="0.75"/>
  </g>

  <!-- shadowed egg / flame left -->
  <g class="flame" transform="translate(84,48)">
    <ellipse class="egg-shadow" cx="26" cy="86" rx="82" ry="20" opacity="0.12" />
    <g transform="translate(0,-18) scale(0.9)">
      <path d="M86 18 C66 -6 42 -6 28 18 C16 36 20 86 56 92 C92 98 106 58 86 18 Z" fill="#ffd86b"/>
      <path d="M75 48 C66 36 50 36 43 50 C40 58 48 68 62 66 C72 65 82 58 75 48 Z" fill="#fff3d8" opacity="0.9"/>
      <path d="M68 10 C62 4 50 6 46 14 C44 20 50 26 58 24 C64 22 70 16 68 10 Z" fill="#ffe08a" opacity="0.95"/>
    </g>
  </g>

  <!-- content -->
  <g class="card-font" transform="translate(0,0)">
    <text x="${width/2 + 6}" y="60" class="title">GitHub streak</text>

    <!-- big rounded number (handwritten style) -->
    <text x="${width/2}" y="148" class="big">${escapeXml(daysText)}</text>

    <text x="${width/2}" y="192" class="sub">day streak</text>

    <!-- decorative small flame drop on the right for balance -->
    <g transform="translate(${width - 90},40) scale(0.9)">
      <ellipse cx="0" cy="0" rx="8" ry="4" fill="#fff9d9" opacity="0.9"/>
      <path d="M6 -2 C2 -18 -10 -22 -20 -2 C-12 -6 0 2 6 -2 Z" fill="#fff2b0" opacity="0.6"/>
    </g>

    <!-- subtle underline notch shadow -->
    <g transform="translate(${width/2 - 20}, 234)">
      <path d="M0 14 q20 18 40 0" fill="#f7eed1" stroke="none" opacity="0.95"/>
      <path d="M0 14 q20 18 40 0" fill="#e9dcc3" opacity="0.08" transform="translate(0,6)"/>
    </g>

    <!-- flame icon (left) for animation and visual tie-in -->
    <g transform="translate(260,26)">
      <g style="transform-origin:30px 30px;" class="flame">
        <path d="M30 12 C22 0 10 -2 6 12 C2 26 6 46 26 46 C46 46 50 24 30 12 Z" fill="#ffd86b" opacity="0.98"/>
        <path d="M26 28 C22 22 16 24 14 30 C12 36 16 40 22 38 C26 36 28 32 26 28 Z" fill="#fff3d8" opacity="0.9"/>
        <path d="M22 8 C20 4 14 6 12 10 C10 14 14 16 18 14 C20 12 22 10 22 8 Z" fill="#ffe08a" opacity="0.95"/>
      </g>
    </g>

    <!-- clickable overlay to your profile (safe, may not be active in raw view) -->
    <a xlink:href="https://github.com/${encodeURIComponent(repoOwner)}" target="_blank" rel="noopener"></a>
  </g>
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
