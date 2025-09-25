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
    <filter id="cardShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="6" dy="20" stdDeviation="18" flood-color="#000" flood-opacity="0.30"/>
    </filter>

    <linearGradient id="cardGrad" x1="0" x2="1">
      <stop offset="0%" stop-color="#fff8d7"/>
      <stop offset="100%" stop-color="#fff3bf"/>
    </linearGradient>

    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd86b"/>
      <stop offset="100%" stop-color="#f39a2e"/>
    </linearGradient>

    <style>
      .card-font { font-family: ${safeFontFamily()}; -webkit-font-smoothing:antialiased; }
      .title { fill:#6b5a1f; font-weight:700; font-size:20px; }
      .big { fill:url(#numGrad); font-weight:900; font-size:112px; text-anchor:middle; filter: drop-shadow(0 8px 0 rgba(0,0,0,0.12)); }
      .sub { fill:#6b6b6b; font-size:18px; text-anchor:middle; }
      .egg-shadow { fill: rgba(0,0,0,0.12); }
      .flame-anim { animation: floaty 2400ms ease-in-out infinite; transform-origin: 120px 72px; }
      .flame-flicker { animation: flicker 1400ms linear infinite; transform-origin: 120px 72px; }
      @keyframes floaty { 0% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-6px) rotate(-1deg); } 100% { transform: translateY(0) rotate(0deg); } }
      @keyframes flicker { 0% { transform: scale(1); opacity:1 } 50% { transform: scale(0.995); opacity:0.95 } 100% { transform: scale(1); opacity:1 } }
    </style>
  </defs>

  <!-- card body with notch -->
  <g filter="url(#cardShadow)">
    <path d="M24 20 h300 a28 28 0 0 1 28 28 v128 a28 28 0 0 1 -28 28 h-146 q-12 8 -24 8 t-24 -8 h-180 z"
          fill="url(#cardGrad)" stroke="#f0e0a0" stroke-width="1.2" />
    <!-- corner shine -->
    <path d="M332 68 q-6 18 -22 26" stroke="#f5e0a0" stroke-width="1.2" fill="none" opacity="0.66"/>
    <ellipse cx="308" cy="46" rx="6" ry="3" fill="#fff9d8" opacity="0.78"/>
  </g>

  <!-- left flame / egg and its subtle shadow -->
  <g transform="translate(72,40)">
    <ellipse class="egg-shadow" cx="26" cy="86" rx="76" ry="18" opacity="0.10" />
    <g class="flame-anim" transform="translate(0,-6)">
      <g class="flame-flicker" transform="translate(0,0) scale(0.98)">
        <path d="M86 18 C66 -6 42 -6 28 18 C16 36 20 86 56 92 C92 98 106 58 86 18 Z" fill="#ffd86b"/>
        <path d="M74 50 C66 38 52 38 44 50 C40 58 48 70 62 66 C72 64 82 58 74 50 Z" fill="#fff3d8" opacity="0.96"/>
        <path d="M68 12 C62 6 50 8 46 14 C44 20 50 26 58 24 C64 22 70 16 68 12 Z" fill="#ffe08a" opacity="0.98"/>
      </g>
    </g>
  </g>

  <!-- main content -->
  <g class="card-font" transform="translate(0,0)">
    <text x="${width/2 + 6}" y="64" class="title">GitHub streak</text>

    <text x="${width/2}" y="160" class="big">${escapeXml(daysText)}</text>

    <text x="${width/2}" y="196" class="sub">day streak</text>

    <!-- small decorative notch echo -->
    <g transform="translate(${width/2 - 20}, 238)">
      <path d="M0 14 q20 18 40 0" fill="#f7eed1" stroke="none" opacity="0.96"/>
      <path d="M0 14 q20 18 40 0" fill="#e9dcc3" opacity="0.08" transform="translate(0,6)"/>
    </g>

    <!-- balancing little egg at top-right for composition -->
    <g transform="translate(${width - 80}, 32) scale(0.85)">
      <ellipse cx="0" cy="0" rx="14" ry="10" fill="#fff8d8" opacity="0.9"/>
      <path d="M8 -6 C4 -16 -6 -18 -12 -6 C-6 -10 0 -2 8 -6 Z" fill="#fff2b0" opacity="0.5"/>
    </g>

    <!-- link anchor (won't be clickable in raw preview) -->
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
