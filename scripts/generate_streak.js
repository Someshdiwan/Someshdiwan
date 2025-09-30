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
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     role="img" aria-label="GitHub streak ${escapeXml(daysText)} days">

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
      <stop offset="0%"   stop-color="#fff8df"/>
      <stop offset="55%"  stop-color="#ffd26a"/>
      <stop offset="100%" stop-color="#e66a00"/>
    </linearGradient>

    <!-- Heat shimmer for flames -->
    <filter id="heat">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 0.15" numOctaves="1" seed="2" result="turb">
        <animate attributeName="baseFrequency" dur="6s"
                 values="0.9 0.15; 1.2 0.18; 0.9 0.15" repeatCount="indefinite"/>
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="turb" scale="2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>

    <!-- Slow camera drift -->
    <g id="camDrift">
      <animateTransform attributeName="transform" type="scale"
                        values="1;1.02;1" dur="18s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" additive="sum" type="translate"
                        values="0 0; -4 -2; 0 0" dur="18s" repeatCount="indefinite"/>
    </g>

    <style>
      .card-font { font-family: "Permanent Marker","Comic Sans MS","Segoe UI",Roboto,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
      .title { fill:url(#numGrad); font-weight:700; font-size:20px; text-anchor:middle; }
      .big   { fill:url(#numGrad); font-weight:900; font-size:80px; text-anchor:middle; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.14)); }
      .sub   { fill:#444; font-size:16px; text-anchor:middle; }
      .egg-shadow { fill: rgba(0,0,0,0.12); }

      /* Filmic, slower motion */
      .floaty  { animation: floaty 9s ease-in-out infinite; transform-origin: center; }
      .flicker { animation: flicker 7.2s ease-in-out infinite; transform-origin: center; }

      @keyframes floaty {
        0% { transform: translateY(0px) }
        50%{ transform: translateY(-6px) }
        100%{ transform: translateY(0px) }
      }
      @keyframes flicker {
        0%   { transform: scale(1);     opacity:1;   filter:brightness(1); }
        35%  { transform: scale(0.992); opacity:0.92;filter:brightness(0.96); }
        70%  { transform: scale(1.008); opacity:1;   filter:brightness(1.05); }
        100% { transform: scale(1);     opacity:1;   filter:brightness(1); }
      }
    </style>
  </defs>

  <!-- Card outline (transparent by default). Uncomment ONE fill variant inside if desired. -->
  <g filter="url(#cardShadow)">
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" ry="22"
          fill="none" stroke="#e6d09a" stroke-width="1.2"/>
    <!--
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" fill="#0f2527"/>
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" fill="#072021"/>
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="22" fill="url(#cardGrad)"/>
    -->
  </g>

  <!-- Everything inside the card + subtle camera drift -->
  <g clip-path="url(#cardClip)">
    <g id="scene" transform="translate(0,0)">
      <use xlink:href="#camDrift"/>

      <!-- Left desk-shadow where the side flame sits -->
      <g transform="translate(58,76)">
        <ellipse class="egg-shadow" cx="30" cy="86" rx="46" ry="14" opacity="0.10"/>
      </g>

      <!-- Left flame (compact, with heat shimmer) -->
      <g transform="translate(60,70)" filter="url(#heat)">
        <g class="floaty">
          <g class="flicker" transform="translate(0,0) scale(0.92)">
            <path d="M70 18 C50 -6 36 -6 22 18 C10 36 14 78 40 84 C66 90 80 56 70 18 Z" fill="#ffb44a"/>
            <path d="M56 40 C50 28 42 30 36 42 C34 48 42 66 54 62 C62 58 68 50 56 40 Z" fill="#ff6a24" opacity="0.98"/>
            <path d="M52 14 C46 8 44 10 40 16 C38 22 44 28 52 26 C58 24 64 18 52 14 Z" fill="#fff5d8" opacity="0.55"/>
          </g>
        </g>
      </g>

      <!-- Texts -->
      <g class="card-font">
        <text x="${width/2}" y="70" class="title">GitHub Streak</text>
        <text x="${width/2}" y="150" class="big">${escapeXml(daysText)}</text>
        <text x="${width/2}" y="190" class="sub">Days</text>
      </g>

      <!-- Big center flame BELOW the number -->
      <g transform="translate(${width/2}, 240) scale(0.98)" class="floaty" filter="url(#heat)">
        <ellipse cx="0" cy="18" rx="36" ry="10" fill="rgba(0,0,0,0.10)"/>
        <g class="flicker">
          <path d="M36 -8 C26 -24 -8 -28 -18 -8 C-26 6 -18 34 12 36 C36 38 44 16 36 -8 Z" fill="#ff9a2a" opacity="0.96"/>
          <path d="M24 8 C18 2 6 2 2 8 C0 12 4 18 12 18 C18 18 26 14 24 8 Z" fill="#ff4b00" opacity="0.92"/>
          <path d="M8 -2 C6 -8 0 -10 -4 -2 C-4 0 -1 4 6 4 C9 4 12 2 8 -2 Z" fill="#fff7de" opacity="0.28"/>
        </g>
      </g>

      <!-- Small flicker closer to big flame -->
      <g transform="translate(${width/2 + 28}, 218) scale(0.52)" class="floaty" filter="url(#heat)">
        <g class="flicker">
          <path d="M14 -4 C10 -12 -4 -14 -8 -4 C-10 2 -6 18 4 18 C12 18 18 8 14 -4 Z" fill="#ffb95a"/>
          <path d="M8 6 C6 2 0 2 -1 6 C-1 9 2 12 6 12 C9 12 12 10 8 6 Z" fill="#fff6d8" opacity="0.55"/>
        </g>
      </g>

      <!-- Tiny drifting embers (3 particles) -->
      <g opacity="0.8">
        <circle r="1.5" fill="#ffd26a">
          <animateMotion dur="6s" repeatCount="indefinite" path="M ${width/2-10} 250 q -8 -40 0 -80"/>
          <animate attributeName="opacity" dur="6s" values="0;1;0" repeatCount="indefinite"/>
        </circle>
        <circle r="1.2" fill="#ffb44a">
          <animateMotion dur="7s" repeatCount="indefinite" path="M ${width/2+6} 248 q 6 -44 -2 -86"/>
          <animate attributeName="opacity" dur="7s" values="0;1;0" repeatCount="indefinite"/>
        </circle>
        <circle r="1.8" fill="#fff0c2">
          <animateMotion dur="8s" repeatCount="indefinite" path="M ${width/2-22} 252 q -10 -50 4 -92"/>
          <animate attributeName="opacity" dur="8s" values="0;1;0" repeatCount="indefinite"/>
        </circle>
      </g>
    </g>
  </g>

  <!-- Click-through overlay -->
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
