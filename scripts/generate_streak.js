// scripts/generate_streak.js
/**
 * Generates a robust animated 'streak.svg' for your GitHub profile.
 * - Uses GitHub GraphQL via action-provided GITHUB_TOKEN
 * - Computes canonical streak: consecutive days with contributions (>0)
 *   ending at the last available day in the contribution calendar.
 * - Produces an animated SVG with flame flicker, glow, particles and a big number.
 */

const { graphql } = require('@octokit/graphql');
const fs = require('fs');
const path = require('path');

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
    headers: { authorization: `token ${token}` }
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

function canonicalStreak(days) {
    // Count consecutive days with count > 0 from the last available day backward.
    let i = days.length - 1;
    let streak = 0;
    for (; i >= 0; i--) {
        if (days[i].count > 0) streak++;
        else break;
    }
    return { streak, lastDay: days[days.length - 1]?.date };
}

// Create a fancier animated SVG (burning flame + number)
function makeStreakSVG(streak) {
    const w = 1200;
    const h = 480;
    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${streak} day streak">
  <style>
    :root { --bg: #0f2527; --gold1:#ffd86b; --gold2:#f39a2e; --accent:#ffb347; --text:#f6a936; }
    .bg { fill: var(--bg); }
    .card { rx: 18; fill: var(--bg); }
    .num { font-family: 'Segoe UI', Roboto, Arial, sans-serif; font-weight: 900; font-size: 220px; text-anchor: middle; fill: url(#numGrad); filter: drop-shadow(0 14px 0 rgba(0,0,0,0.35)); }
    .label { font-family: 'Segoe UI', Roboto, Arial, sans-serif; font-size: 40px; text-anchor: middle; fill: var(--text); font-weight: 700; letter-spacing: 0.6px; }
    .flame { transform-origin: 360px 140px; animation: float 2.6s ease-in-out infinite; }
    .particle { opacity: 0.85; animation: rise 2.2s linear infinite; }
    .glow { filter: drop-shadow(0 0 14px rgba(255,180,71,0.6)); animation: glow 1.6s ease-in-out infinite alternate; }
    .flicker { animation: flicker 0.18s steps(2) infinite; }
    @keyframes float { 0%{transform:translateY(0);}50%{transform:translateY(-10px);}100%{transform:translateY(0);} }
    @keyframes rise { 0%{ transform: translateY(0) scale(0.9); opacity:0.9 } 100%{ transform: translateY(-36px) scale(1); opacity:0 } }
    @keyframes glow { from { filter: drop-shadow(0 0 8px rgba(255,140,0,0.35)); } to { filter: drop-shadow(0 0 22px rgba(255,90,0,0.55)); } }
    @keyframes flicker {
      0% { fill: var(--gold1); }
      40% { fill: #ffd56a; }
      60% { fill: #ffb94a; }
      100% { fill: var(--gold2); }
    }

    /* small responsive tweaks if displayed narrow */
    @media (max-width:900px) {
      .num { font-size: 120px; }
      .label { font-size: 22px; }
    }
  </style>

  <rect width="100%" height="100%" class="bg"/>
  <g transform="translate(80,36)">
    <rect class="card" width="${w - 160}" height="${h - 72}" rx="18"/>

    <!-- flame group -->
    <g class="flame" transform="translate(120,18) scale(1)">
      <!-- shadow -->
      <ellipse cx="140" cy="220" rx="120" ry="26" fill="rgba(0,0,0,0.36)"/>
      <!-- particles -->
      <g transform="translate(110,26)">
        <circle class="particle" cx="10" cy="0" r="6" fill="#ffb347" style="animation-delay:0s"/>
        <circle class="particle" cx="36" cy="0" r="4" fill="#ffd86b" style="animation-delay:0.4s"/>
        <circle class="particle" cx="58" cy="0" r="5" fill="#ffcf6a" style="animation-delay:0.8s"/>
      </g>

      <!-- outer flame shape (glow + flicker) -->
      <g class="glow">
        <path class="flicker" d="M220 60 C190 0 120 -10 90 40 C60 95 70 160 120 160 C170 160 240 120 220 60 Z" fill="#ffd86b"/>
        <path d="M190 98 C174 82 150 90 142 110 C138 120 152 132 170 126 C182 122 192 114 190 98 Z" fill="#fff3d8"/>
      </g>
    </g>

    <!-- big number -->
    <defs>
      <linearGradient id="numGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#ffd86b"/>
        <stop offset="100%" stop-color="#f39a2e"/>
      </linearGradient>
    </defs>

    <text x="${(w - 160) / 2 + 20}" y="240" class="num">${streak}</text>
    <text x="${(w - 160) / 2 + 20}" y="320" class="label">day streak</text>
  </g>
</svg>`;
}

(async () => {
    try {
        const calendar = await fetchContributionCalendar(repoOwner);
        const days = flattenDays(calendar);
        if (!days.length) throw new Error('No contribution data found from GraphQL calendar.');

        // debug (action logs)
        console.log('last 14 days:', days.slice(-14).map(d => `${d.date}:${d.count}`).join(', '));

        const { streak, lastDay } = canonicalStreak(days);
        // final canonical streak: if the last day had zero, streak will be 0 by definition.
        const svg = makeStreakSVG(streak);
        fs.writeFileSync(path.join(process.cwd(), 'streak.svg'), svg, 'utf8');
        console.log(`Wrote streak.svg (streak=${streak}, lastDay=${lastDay})`);
    } catch (err) {
        console.error('Error generating streak.svg:', err);
        process.exit(1);
    }
})();
