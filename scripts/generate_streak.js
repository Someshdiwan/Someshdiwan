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
    <clipPath id="cardClip">
      <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" ry="22"/>
    </clipPath>

    <filter id="cardShadow" x="-50%" y="-50%" width="220%" height="220%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="4" dy="12" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <linearGradient id="cardGrad" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#fff6c7"/>
      <stop offset="100%" stop-color="#ffe29a"/>
    </linearGradient>

    <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#fff6b8"/>
      <stop offset="60%" stop-color="#ffd07a"/>
      <stop offset="100%" stop-color="#ff9a3a"/>
    </linearGradient>

    <style type="text/css"><![CDATA[
      .card-font { font-family: "Permanent Marker","Comic Sans MS","Segoe UI",Roboto,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
      .title { fill:#3b2f14; font-weight:700; font-size:20px; text-anchor:middle; }
      .big { fill:url(#numGrad); font-weight:900; font-size:78px; text-anchor:middle; opacity:0.98;
             filter: drop-shadow(0 4px 6px rgba(0,0,0,0.12)); }
      .sub { fill:#444; font-size:16px; text-anchor:middle; }
      .egg-shadow { fill: rgba(0,0,0,0.12); }

      /* gentle vertical float */
      .floaty { animation: floaty 5200ms ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
      /* slow planet-like orbit: rotate the wrapper group */
      .orbit { animation: orbit 18s linear infinite; transform-box: fill-box; transform-origin: center; }
      /* tiny slow flicker for the small flame */
      .flicker-slow { animation: flicker-slow 7000ms ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
      .flicker-med { animation: flicker-med 4200ms ease-in-out infinite; transform-box: fill-box; transform-origin: center; }

      @keyframes floaty {
        0%{ transform: translateY(0); }
        50%{ transform: translateY(-6px); }
        100%{ transform: translateY(0); }
      }
      @keyframes orbit {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes flicker-slow {
        0%  { transform: scale(1); opacity:0.98; }
        40% { transform: scale(0.995); opacity:0.92; }
        80% { transform: scale(1.01); opacity:1; }
        100%{ transform: scale(1); opacity:0.98; }
      }
      @keyframes flicker-med {
        0%  { transform: scale(1); opacity:1; }
        35% { transform: scale(0.985); opacity:0.9; }
        65% { transform: scale(1.02); opacity:1; }
        100%{ transform: scale(1); opacity:1; }
      }
    ]]></style>
  </defs>

  <g filter="url(#cardShadow)">
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" ry="22"
          fill="url(#cardGrad)" stroke="#e6d09a" stroke-width="1.2"/>
    <ellipse cx="${width - 100}" cy="40" rx="6" ry="3" fill="#fff9e0" opacity="0.85"/>
  </g>

  <g clip-path="url(#cardClip)">

    <!-- Left flame (kept, inside the card) -->
    <g transform="translate(60,70)">
      <ellipse class="egg-shadow" cx="30" cy="90" rx="50" ry="16" opacity="0.12"/>
      <g class="floaty">
        <g class="flicker-med" transform="translate(0, -2) scale(0.96)">
          <path d="M70 20 C50 -4 36 -4 22 20 C10 38 14 88 40 94 C66 100 80 60 70 20 Z" fill="#ffc84a"/>
          <path d="M58 52 C50 40 46 40 38 52 C34 60 42 72 56 68 C66 66 76 60 58 52 Z" fill="#fff7df" opacity="0.92"/>
          <path d="M52 14 C46 8 44 10 40 16 C38 22 44 28 52 26 C58 24 64 18 52 14 Z" fill="#ff7a2e" opacity="0.98"/>
        </g>
      </g>
    </g>

    <!-- Small flame: placed fully inside, wrapped by an orbiting group for planet-like movement -->
    <g transform="translate(${width - 170}, 80)" class="orbit" aria-hidden="true">
      <!-- orbit radius is implemented by translating the flame inside the rotating group -->
      <g transform="translate(18,0) scale(0.36)" class="floaty">
        <ellipse cx="0" cy="12" rx="10" ry="3" fill="rgba(0,0,0,0.10)" />
        <g class="flicker-slow">
          <path d="M12 -4 C8 -10 -2 -12 -6 -4 C-8 2 -6 18 6 20 C12 22 16 10 12 -4 Z" fill="#ffbe5a" />
          <path d="M8 6 C6 2 0 2 -1 6 C-2 8 -1 10 4 10 C7 10 10 8 8 6 Z" fill="#fff6dc" opacity="0.96"/>
        </g>
      </g>
      <circle cx="0" cy="0" r="18" fill="none" stroke="rgba(0,0,0,0.03)" stroke-width="1"/>
    </g>

    <!-- Centered texts -->
    <g class="card-font">
      <text x="${width/2}" y="70" class="title">GitHub Streak</text>
      <text x="${width/2}" y="150" class="big">${escapeXml(daysText)}</text>
      <text x="${width/2}" y="190" class="sub">Days</text>
    </g>

    <!-- Medium flame below number -->
    <g transform="translate(${width/2}, 252) scale(0.92)" class="floaty">
      <ellipse cx="0" cy="18" rx="36" ry="10" fill="rgba(0,0,0,0.10)" />
      <g class="flicker-med">
        <path d="M36 -8 C26 -24 -8 -28 -18 -8 C-26 6 -18 34 12 36 C36 38 44 16 36 -8 Z" fill="#ffb43f" opacity="0.98"/>
        <path d="M24 8 C18 2 6 2 2 8 C0 12 4 18 12 18 C18 18 26 14 24 8 Z" fill="#fff8df" opacity="0.95"/>
        <path d="M12 -2 C8 -10 0 -12 -6 -2 C-6 0 -2 6 6 6 C10 6 14 4 12 -2 Z" fill="#ff6a2e" opacity="0.95"/>
      </g>
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
