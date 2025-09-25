// scripts/generate_streak.js
/**
 * Generates an animated SVG 'streak.svg' for your GitHub profile.
 * Uses GitHub GraphQL via the action-provided GITHUB_TOKEN.
 *
 * Streak definition: consecutive days with contributionCount > 0 ending on TODAY (calendar day).
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

function computeStreakEndingToday(days) {
    const utcToday = new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate()
    ));
    const utcTodayStr = utcToday.toISOString().slice(0, 10);

    let i = days.findIndex(d => d.date === utcTodayStr);
    if (i < 0) i = days.length - 1;

    let streak = 0;
    for (; i >= 0; i--) {
        if (days[i].count > 0) streak++;
        else break;
    }
    return { streak, utcTodayStr, lastDayDate: days[days.length - 1]?.date };
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
        const { streak, utcTodayStr, lastDayDate } = computeStreakEndingToday(days);
        const svg = makeStreakSVG(streak);
        fs.writeFileSync(path.join(process.cwd(), 'streak.svg'), svg, 'utf8');
        console.log(`Wrote streak.svg — streak=${streak}, utcToday=${utcTodayStr}, lastDayInCalendar=${lastDayDate}`);
    } catch (err) {
        console.error('Error generating streak svg:', err);
        process.exit(1);
    }
})();
