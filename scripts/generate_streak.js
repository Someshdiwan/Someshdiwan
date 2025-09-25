// scripts/generate_streak.js
/**
 * Generates an animated SVG 'streak.svg' for your GitHub profile.
 * Uses GitHub GraphQL via the action-provided GITHUB_TOKEN.
 *
 * This version supports "resume" mode: if a streak_state.json exists with a
 * previously recorded streak and date, the script will attempt to continue
 * that streak if there were no contribution gaps between the saved date and
 * the latest calendar day. Otherwise it falls back to the calendar-computed
 * streak.
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

/**
 * makeStreakSVG: replaced UI only.
 * Produces a 420x300 "sticky note" card visually matching the WakaTime card.
 * No logic changes elsewhere.
 */
function makeStreakSVG(streak) {
    const width = 420;
    const height = 300;
    const hoursText = String(streak);
    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub streak ${hoursText} days">
  <defs>
    <filter id="sdrop" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="6" dy="18" stdDeviation="14" flood-color="#000" flood-opacity="0.32"/>
    </filter>
    <linearGradient id="cardGrad" x1="0" x2="1">
      <stop offset="0%" stop-color="#fff6c7"/>
      <stop offset="100%" stop-color="#fff1b8"/>
    </linearGradient>
    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd86b"/>
      <stop offset="100%" stop-color="#f39a2e"/>
    </linearGradient>
    <style>
      .card-font { font-family: "Comic Sans MS", "Segoe UI", Roboto, Arial, sans-serif; -webkit-font-smoothing:antialiased; }
      .title { fill:#6b5a1f; font-weight:700; font-size:18px; }
      .big { fill:url(#numGrad); font-weight:800; font-size:96px; text-anchor:middle; filter: drop-shadow(0 6px 0 rgba(0,0,0,0.12)); }
      .sub { fill:#6b6b6b; font-size:14px; text-anchor:middle; }
      .donut-label { fill:#2b2b2b; font-weight:700; font-size:12px; text-anchor:middle; }
      .donut-pct { fill:#806015; font-size:12px; text-anchor:middle; }
    </style>
  </defs>

  <!-- sticky card body -->
  <g filter="url(#sdrop)">
    <path d="M20 20 h300 a20 20 0 0 1 20 20 v160 a20 20 0 0 1 -20 20 h-134 q-12 8 -24 8 t-24 -8 h-144 z"
          fill="url(#cardGrad)" stroke="#f0dfa0" stroke-width="1.2" />
    <!-- peeled corner highlight -->
    <path d="M322 62 q-6 18 -22 26" stroke="#f5e0a0" stroke-width="1.2" fill="none" opacity="0.6"/>
    <ellipse cx="305" cy="46" rx="6" ry="3" fill="#fff8d8" opacity="0.7"/>
  </g>

  <!-- content -->
  <g class="card-font" transform="translate(0,0)">
    <text x="${width/2}" y="64" class="title">GitHub streak</text>

    <text x="${width/2}" y="150" class="big">${escapeXml(hoursText)}</text>

    <text x="${width/2}" y="178" class="sub">day streak</text>

    <!-- three small decorative donuts (visual symmetry only) -->
    <g transform="translate(70,220)">
      <circle cx="0" cy="0" r="30" fill="none" stroke="#efe0bd" stroke-width="12"></circle>
      <circle cx="0" cy="0" r="30" fill="none" stroke="#6a5acd" stroke-width="12"
              stroke-linecap="round"
              stroke-dasharray="188.49555921538757 188.49555921538757"
              stroke-dashoffset="75"
              transform="rotate(-90)"></circle>
      <circle cx="0" cy="0" r="14.4" fill="#fff4cf"></circle>
      <text x="0" y="-2" class="donut-label">Contrib</text>
      <text x="0" y="14" class="donut-pct">—</text>
    </g>

    <g transform="translate(210,220)">
      <circle cx="0" cy="0" r="30" fill="none" stroke="#efe0bd" stroke-width="12"></circle>
      <circle cx="0" cy="0" r="30" fill="none" stroke="#ff6f61" stroke-width="12"
              stroke-linecap="round"
              stroke-dasharray="188.49555921538757 188.49555921538757"
              stroke-dashoffset="120"
              transform="rotate(-90)"></circle>
      <circle cx="0" cy="0" r="14.4" fill="#fff4cf"></circle>
      <text x="0" y="-2" class="donut-label">Commit</text>
      <text x="0" y="14" class="donut-pct">—</text>
    </g>

    <g transform="translate(350,220)">
      <circle cx="0" cy="0" r="30" fill="none" stroke="#efe0bd" stroke-width="12"></circle>
      <circle cx="0" cy="0" r="30" fill="none" stroke="#ffd86b" stroke-width="12"
              stroke-linecap="round"
              stroke-dasharray="188.49555921538757 188.49555921538757"
              stroke-dashoffset="150"
              transform="rotate(-90)"></circle>
      <circle cx="0" cy="0" r="14.4" fill="#fff4cf"></circle>
      <text x="0" y="-2" class="donut-label">Days</text>
      <text x="0" y="14" class="donut-pct">—</text>
    </g>

    <!-- clickable overlay anchor (won't be active in raw preview but safe) -->
    <a xlink:href="https://github.com/${encodeURIComponent(repoOwner)}" target="_blank" rel="noopener"></a>
  </g>
</svg>`;
}

function escapeXml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c]));
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
