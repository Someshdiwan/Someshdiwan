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

/* ---------------------- UI only: makeStreakSVG ----------------------
   This function was changed to produce a sticky-note style card
   that visually matches the WakaTime sticky card:
   - pale yellow gradient card
   - rounded corners, soft drop shadow
   - large centered number with gradient fill
   - flame illustration at top-left
   - NO donuts / contrib / commit visuals
   Logic outside this function is unchanged.
----------------------------------------------------------------------*/
function makeStreakSVG(streak) {
    const width = 420;
    const height = 300;
    const txt = String(streak);
    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub streak ${escapeXml(txt)} days">
  <defs>
    <filter id="sdrop" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="6" dy="14" stdDeviation="12" flood-color="#000" flood-opacity="0.32"/>
    </filter>

    <linearGradient id="cardGrad" x1="0" x2="1">
      <stop offset="0%" stop-color="#fff7d0"/>
      <stop offset="100%" stop-color="#fff1b8"/>
    </linearGradient>

    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd86b"/>
      <stop offset="100%" stop-color="#f39a2e"/>
    </linearGradient>

    <style>
      .font-play { font-family: "Comic Sans MS", "Segoe UI", Roboto, Arial, sans-serif; -webkit-font-smoothing:antialiased; }
      .title { fill:#6b5a1f; font-size:18px; font-weight:700; }
      .big { font-size:96px; font-weight:800; text-anchor:middle; fill:url(#numGrad); filter: drop-shadow(0 6px 0 rgba(0,0,0,0.12)); }
      .label { font-size:14px; fill:#6b6b6b; text-anchor:middle; }
    </style>
  </defs>

  <!-- sticky note base with shadow -->
  <g filter="url(#sdrop)">
    <path d="M18 18 h320 a24 24 0 0 1 24 24 v160 a24 24 0 0 1 -24 24 h-148 q-12 10 -24 10 t-24 -10 h-144 z"
          fill="url(#cardGrad)" stroke="#f0dfa0" stroke-width="1.2" />
    <!-- peeled corner highlight -->
    <path d="M338 56 q-6 18 -22 26" stroke="#f5e0a0" stroke-width="1.2" fill="none" opacity="0.6"/>
    <ellipse cx="312" cy="44" rx="6" ry="3" fill="#fff8d8" opacity="0.7"/>
  </g>

  <!-- flame element (top-left) -->
  <g transform="translate(88,32) scale(0.9)" opacity="0.98">
    <g transform="translate(0,0)">
      <ellipse cx="30" cy="96" rx="60" ry="12" fill="rgba(0,0,0,0.16)"/>
      <path d="M98 32 C86 6 60 -6 42 24 C28 48 32 88 60 92 C92 96 116 70 98 32 Z" fill="#ffd86b"/>
      <path d="M78 56 C70 44 54 48 48 62 C46 70 54 80 68 76 C76 74 84 68 78 56 Z" fill="#fff3d8"/>
      <path d="M74 22 C68 14 56 16 52 26 C50 34 58 40 66 36 C72 33 76 28 74 22 Z" fill="#ffe08a" opacity="0.95"/>
    </g>
  </g>

  <!-- content -->
  <g transform="translate(0,0)" class="font-play">
    <text x="${width/2}" y="62" class="title">GitHub streak</text>
    <text x="${width/2}" y="150" class="big">${escapeXml(txt)}</text>
    <text x="${width/2}" y="178" class="label">day streak</text>

    <!-- subtle flame drip (decorative) -->
    <g transform="translate(280,18)">
      <ellipse cx="0" cy="0" rx="8" ry="10" fill="#f39a2e" opacity="0.95"/>
      <animateTransform attributeName="transform" type="translate" values="0,0;0,6;0,0" dur="2.6s" repeatCount="indefinite" />
    </g>

    <!-- clickable anchor (safe to include) -->
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
