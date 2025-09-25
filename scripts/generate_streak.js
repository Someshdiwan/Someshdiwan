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

function makeStreakSVG(streak) {
    const width = 900;
    const height = 420;
    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .bg { fill: #0f2527; }
    .flame { transform-origin: 450px 90px; animation: float 2.4s infinite ease-in-out; }
    .drop { transform-origin: 450px 32px; animation: drip 2.6s infinite ease-in-out; }
    .num { font-family: 'Segoe UI', Roboto, Arial, sans-serif; font-weight: 700; font-size: 200px; text-anchor: middle; fill: url(#numGrad); filter: drop-shadow(0 12px 0 rgba(0,0,0,0.25)); }
    .label { font-family: 'Segoe UI', Roboto, Arial, sans-serif; font-size: 36px; text-anchor: middle; fill: #f6a936; font-weight: 700; }
    @keyframes float { 0%{transform:translateY(0);} 50%{transform:translateY(-10px);} 100%{transform:translateY(0);} }
    @keyframes drip { 0%{transform:translateY(0) scale(1);opacity:1;} 80%{transform:translateY(22px) scale(0.9);opacity:0.6;} 100%{transform:translateY(0) scale(1);opacity:1;} }
  </style>

  <rect width="100%" height="100%" rx="12" class="bg"/>

  <defs>
    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd86b"/>
      <stop offset="100%" stop-color="#f39a2e"/>
    </linearGradient>
  </defs>

  <g class="flame" transform="translate(300,8) scale(1.0)">
    <ellipse cx="150" cy="160" rx="110" ry="24" fill="rgba(0,0,0,0.35)"/>
    <path d="M250 60 C220 10 170 -10 130 40 C95 85 100 160 150 160 C210 160 270 120 250 60 Z" fill="#ffd86b"/>
    <path d="M210 88 C192 68 165 74 154 96 C150 106 166 122 190 116 C202 112 214 104 210 88 Z" fill="#fff3d8"/>
    <path d="M198 40 C188 30 170 32 164 46 C160 56 172 64 184 58 C192 54 200 48 198 40 Z" fill="#ffe08a" opacity="0.9"/>
  </g>

  <g class="drop" transform="translate(430,12)">
    <ellipse cx="0" cy="0" rx="9" ry="12" fill="#f39a2e"/>
  </g>

  <text x="${width/2}" y="300" class="num">${streak}</text>
  <text x="${width/2}" y="352" class="label">day streak</text>
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
