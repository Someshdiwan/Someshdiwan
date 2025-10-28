const fs = require("fs");
const path = require("path");
const { graphql } = require("@octokit/graphql");

// ----------------------------
// Configuration
// ----------------------------
const TOKEN = process.env.GITHUB_TOKEN || "";
if (!TOKEN) {
    console.error("GITHUB_TOKEN is required in env");
    process.exit(1);
}

const REPO_OWNER =
    (process.env.REPO_OWNER ||
        process.env.GITHUB_REPOSITORY_OWNER ||
        (process.env.GITHUB_REPOSITORY || "").split("/")[0] ||
        "").trim();

if (!REPO_OWNER) {
    console.error("Cannot resolve repo owner: set REPO_OWNER or GITHUB_REPOSITORY_OWNER");
    process.exit(1);
}

const THEME = process.env.STREAK_THEME || "auto";
const BG = process.env.STREAK_BG || "warm";
const SIZE = process.env.STREAK_SIZE || "md";
const REDUCE_MOTION = (process.env.STREAK_REDUCE_MOTION || "false") === "true";

const STATE_PATH = path.resolve(process.cwd(), "streak_state.json");
const OUT_SVG = path.resolve(process.cwd(), "streak.svg");

// ----------------------------
// GraphQL client with basic retry
// ----------------------------
const gql = graphql.defaults({
    headers: {
        authorization: `token ${TOKEN}`,
        "user-agent": "streak-badge/1.0",
    },
});

async function gqlWithRetry(query, variables, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await gql(query, variables);
        } catch (e) {
            lastErr = e;
            const isRateLimit =
                String(e?.message || "").toLowerCase().includes("rate") ||
                e?.status === 403;
            const backoff = isRateLimit ? 4000 * (i + 1) : 1200 * (i + 1);
            console.warn(`GraphQL attempt ${i + 1}/${attempts} failed: ${e.message}. Retrying in ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
        }
    }
    throw lastErr;
}

// ----------------------------
// SVG generator (v2 with small niceties)
// ----------------------------
function makeStreakSVG(streak, {
    width = 420,
    height = 300,
    repoOwner = "your-github",
    theme = "auto",
    bg = "transparent",
    showBorder = true,
    fontFamily = `'Permanent Marker','Comic Sans MS','Segoe UI',Roboto,Arial,sans-serif`,
    reduceMotion = false,
    title = "GitHub Streak",
    label = "Days",
} = {}) {
    const uid = `streak${Math.random().toString(36).slice(2, 8)}`;
    const esc = (s) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    const safeOwner = String(repoOwner).replace(/[^\w.-]/g, "");
    const clamped = Number.isFinite(streak) ? Math.max(0, Math.min(streak, 99999)) : 0;
    const daysText = new Intl.NumberFormat("en-US").format(clamped);

    const vbW = width, vbH = height;
    const innerW = vbW - 40, innerH = vbH - 40;

    const palette = {
        light: { stroke: "#e6d09a", cardGrad0: "#fff6c7", cardGrad1: "#ffe29a", textSub: "#444", shadowA: 0.28 },
        dark:  { stroke: "#0b1a1a", cardGrad0: "#0f2527", cardGrad1: "#072021", textSub: "#cfd9d9", shadowA: 0.34 },
    };
    const pick = (l, d) => (theme === "light" ? l : theme === "dark" ? d : l);

    const bgRect = (() => {
        if (bg === "warm") {
            return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="url(#${uid}-cardGrad)" ${showBorder ? `stroke="${pick(palette.light.stroke, palette.dark.stroke)}" stroke-width="1.2"` : ""}/>`;
        }
        if (bg === "dark") {
            return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="${palette.dark.cardGrad0}" ${showBorder ? `stroke="${palette.dark.stroke}" stroke-width="1.2"` : ""}/>`;
        }
        if (bg === "medium") {
            return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="${palette.dark.cardGrad1}" ${showBorder ? `stroke="${palette.dark.stroke}" stroke-width="1.0"` : ""}/>`;
        }
        return `<rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22" fill="none" ${showBorder ? `stroke="${pick(palette.light.stroke, palette.dark.stroke)}" stroke-width="1.2"` : ""}/>`;
    })();

    // Auto-fit big number by digits (tabular numerals further stabilize)
    const baseFont = 80;
    const digits = String(clamped).length;
    const scale = digits <= 3 ? 1 : digits === 4 ? 0.9 : digits === 5 ? 0.8 : 0.72;
    const bigDY = digits >= 6 ? -4 : 0;

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 ${vbW} ${vbH}" role="img" aria-labelledby="${uid}-title ${uid}-desc">
  <title id="${uid}-title">${esc(title)}</title>
  <desc id="${uid}-desc">${esc(`GitHub streak counter for ${safeOwner}: ${daysText} ${label}.`)}</desc>

  <defs>
    <clipPath id="${uid}-cardClip"><rect x="20" y="20" width="${innerW}" height="${innerH}" rx="22" ry="22"/></clipPath>
    <filter id="${uid}-cardShadow" x="-40%" y="-40%" width="180%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="4" dy="12" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="${pick(palette.light.shadowA, palette.dark.shadowA)}"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="${uid}-cardGrad" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${palette.light.cardGrad0}"/><stop offset="100%" stop-color="${palette.light.cardGrad1}"/>
    </linearGradient>
    <linearGradient id="${uid}-numGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#fff8df"/><stop offset="55%" stop-color="#ffd26a"/><stop offset="100%" stop-color="#e66a00"/>
    </linearGradient>
    <style>
      :root { --sub:#444; --stroke:${palette.light.stroke}; }
      @media (prefers-color-scheme: dark) { :root { --sub:${palette.dark.textSub}; --stroke:${palette.dark.stroke}; } }
      ${REDUCE_MOTION || reduceMotion ? `.floaty,.flicker{animation:none!important}` : `@media (prefers-reduced-motion:reduce){.floaty,.flicker{animation:none!important}}`}
      .card-font { font-family:${fontFamily}; -webkit-font-smoothing:antialiased; font-variant-numeric: tabular-nums; }
      .title { fill:url(#${uid}-numGrad); font-weight:700; font-size:20px; text-anchor:middle; }
      .big { fill:url(#${uid}-numGrad); font-weight:900; font-size:${baseFont}px; text-anchor:middle; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.14)); }
      .sub { fill:var(--sub); font-size:16px; text-anchor:middle; }
      .egg-shadow { fill:rgba(0,0,0,0.12); }
      .floaty { animation:${uid}-floaty 7000ms ease-in-out infinite; transform-origin:center; }
      .flicker{ animation:${uid}-flicker 5200ms linear infinite; transform-origin:center; }
      @keyframes ${uid}-floaty { 0%{transform:translateY(0)} 50%{transform:translateY(-6px)} 100%{transform:translateY(0)} }
      @keyframes ${uid}-flicker { 0%{transform:scale(1);opacity:1} 40%{transform:scale(.992);opacity:.92} 80%{transform:scale(1.01);opacity:1} 100%{transform:scale(1);opacity:1} }
      a,a:link,a:visited{cursor:pointer}
    </style>
  </defs>

  <g filter="url(#${uid}-cardShadow)">${bgRect}</g>

  <g clip-path="url(#${uid}-cardClip)">
    <g transform="translate(58,76)"><ellipse class="egg-shadow" cx="30" cy="86" rx="46" ry="14" opacity="0.10"/></g>

    <g transform="translate(60,70)"><g class="floaty"><g class="flicker" transform="translate(0,0) scale(0.92)">
      <path d="M70 18 C50 -6 36 -6 22 18 C10 36 14 78 40 84 C66 90 80 56 70 18 Z" fill="#ffb44a"/>
      <path d="M56 40 C50 28 42 30 36 42 C34 48 42 66 54 62 C62 58 68 50 56 40 Z" fill="#ff6a24" opacity="0.98"/>
      <path d="M52 14 C46 8 44 10 40 16 C38 22 44 28 52 26 C58 24 64 18 52 14 Z" fill="#fff5d8" opacity="0.55"/>
    </g></g></g>

    <g class="card-font">
      <text x="${vbW/2}" y="70" class="title">${esc(title)}</text>
      <g transform="translate(${vbW/2}, ${150 + bigDY}) scale(${scale})">
        <text x="0" y="0" class="big">${esc(daysText)}</text>
      </g>
      <text x="${vbW/2}" y="190" class="sub">${esc(label)}</text>
    </g>

    <g transform="translate(${vbW/2}, 240) scale(0.98)" class="floaty" aria-hidden="true">
      <ellipse cx="0" cy="18" rx="36" ry="10" fill="rgba(0,0,0,0.10)" />
      <g class="flicker">
        <path d="M36 -8 C26 -24 -8 -28 -18 -8 C-26 6 -18 34 12 36 C36 38 44 16 36 -8 Z" fill="#ff9a2a" opacity="0.96"/>
        <path d="M24 8 C18 2 6 2 2 8 C0 12 4 18 12 18 C18 18 26 14 24 8 Z" fill="#ff4b00" opacity="0.92"/>
        <path d="M8 -2 C6 -8 0 -10 -4 -2 C-4 0 -1 4 6 4 C9 4 12 2 8 -2 Z" fill="#fff7de" opacity="0.28"/>
      </g>
    </g>

    <g transform="translate(${vbW/2 + 28}, 218) scale(0.52)" class="floaty" aria-hidden="true">
      <g class="flicker">
        <path d="M14 -4 C10 -12 -4 -14 -8 -4 C-10 2 -6 18 4 18 C12 18 18 8 14 -4 Z" fill="#ffb95a" />
        <path d="M8 6 C6 2 0 2 -1 6 C-1 9 2 12 6 12 C9 12 12 10 8 6 Z" fill="#fff6d8" opacity="0.55"/>
      </g>
    </g>
  </g>

  <a xlink:href="https://github.com/${encodeURIComponent(safeOwner)}" target="_blank" rel="noopener">
    <title>${esc(`${safeOwner} – ${daysText} ${label}`)}</title>
    <rect x="0" y="0" width="${vbW}" height="${vbH}" fill="none" pointer-events="all"/>
  </a>
</svg>`;
}

// ----------------------------
// Utilities
// ----------------------------
function isoTodayUTC() {
    return new Date().toISOString().slice(0, 10);
}
function daysBetweenISO(a, b) {
    const d1 = new Date(a + "T00:00:00Z").getTime();
    const d2 = new Date(b + "T00:00:00Z").getTime();
    return Math.round((d2 - d1) / 86400000);
}
function loadState() {
    try {
        const raw = fs.readFileSync(STATE_PATH, "utf8");
        return JSON.parse(raw);
    } catch {
        return { streak: 0, date: isoTodayUTC() };
    }
}
function saveState(obj) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

// ----------------------------
// GraphQL query and streak calc
// ----------------------------
const GQL = /* GraphQL */ `
  query($login:String!) {
    user(login:$login) {
      contributionsCollection {
        contributionCalendar {
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

/**
 * From contribution calendar (flattened), compute the consecutive streak ending "today" (UTC).
 * Rules:
 * - Walk backwards from the max date <= today
 * - Count days while the gap is exactly 1 day and contributionCount > 0
 * - If today's count > 0, it is included; if 0, streak ends yesterday
 */
function computeStreakFromWeeks(weeks) {
    const days = [];
    for (const w of weeks || []) for (const d of w.contributionDays || []) days.push(d);
    if (!days.length) return 0;
    days.sort((a, b) => a.date.localeCompare(b.date));

    const today = isoTodayUTC();
    // Find index of latest day <= today
    let idx = days.length - 1;
    while (idx >= 0 && days[idx].date > today) idx--;
    if (idx < 0) return 0; // calendar is all in the future?

    let streak = 0;
    let prevDate = null;

    for (let i = idx; i >= 0; i--) {
        const { date, contributionCount: count } = days[i];

        if (i === idx) {
            // For the latest day <= today: include only if contributed today
            if (date === today) {
                if (count > 0) {
                    streak++;
                    prevDate = today;
                    continue;
                } else {
                    // no contrib today; pretend "previous" date is today for gap calc with yesterday
                    prevDate = today;
                    continue; // but don't increment; next loop checks yesterday
                }
            } else {
                // Latest day is before today; only counts if it's exactly yesterday and had contribs
                const gap = daysBetweenISO(date, today);
                if (gap !== 1 || count <= 0) break;
                streak++;
                prevDate = date;
                continue;
            }
        }

        // For earlier days, require exact 1-day gap from prevDate
        const gap = daysBetweenISO(date, prevDate);
        if (gap !== 1 || count <= 0) break;
        streak++;
        prevDate = date;
    }

    return streak;
}

// ----------------------------
// Main
// ----------------------------
(async () => {
    const state = loadState();
    const today = isoTodayUTC();

    let liveStreak = null;
    try {
        const resp = await gqlWithRetry(GQL, { login: REPO_OWNER });
        const weeks = resp?.user?.contributionsCollection?.contributionCalendar?.weeks || [];
        liveStreak = computeStreakFromWeeks(weeks);
        if (!Number.isFinite(liveStreak)) liveStreak = null;
    } catch (e) {
        console.warn("GraphQL fetch failed, using local state fallback:", e.message);
    }

    // Fallback: monotonic date-based update when calendar is unavailable
    let newStreak = liveStreak ?? state.streak ?? 0;
    let newDate = today;

    if (liveStreak == null) {
        const last = state.date || today;
        const gap = daysBetweenISO(last, today);
        if (gap === 0) {
            newStreak = state.streak ?? 0;
            newDate = last;
        } else if (gap === 1) {
            newStreak = Math.max(0, (state.streak || 0)) + 1;
        } else if (gap > 1) {
            newStreak = 0;
        }
    }

    // Size presets
    const sizeMap = {
        sm: { width: 360, height: 240 },
        md: { width: 420, height: 300 },
        lg: { width: 520, height: 360 },
    };
    const { width, height } = sizeMap[SIZE] || sizeMap.md;

    const svg = makeStreakSVG(newStreak, {
        width,
        height,
        repoOwner: REPO_OWNER,
        theme: THEME,
        bg: BG,
        showBorder: true,
        reduceMotion: REDUCE_MOTION,
        title: "GitHub Streak",
        label: "Days",
    });

    // Write only if content changed to avoid noisy commits
    let shouldWrite = true;
    try {
        const existing = fs.readFileSync(OUT_SVG, "utf8");
        if (existing === svg) shouldWrite = false;
    } catch {}
    if (shouldWrite) {
        fs.writeFileSync(OUT_SVG, svg, "utf8");
        console.log(`✍️  Updated ${path.basename(OUT_SVG)}`);
    } else {
        console.log("ℹ️  streak.svg unchanged");
    }

    // Persist state
    const prevState = loadState();
    const nextState = { streak: newStreak, date: newDate };
    if (JSON.stringify(prevState) !== JSON.stringify(nextState)) {
        saveState(nextState);
        console.log(`✍️  Updated streak_state.json → ${newStreak} @ ${newDate}`);
    } else {
        console.log("ℹ️  streak_state.json unchanged");
    }

    console.log(`✅ Done — Streak=${newStreak} | Owner=${REPO_OWNER} | Theme=${THEME}/${BG} | Size=${SIZE}`);
})().catch((e) => {
    console.error("❌ Failed generating streak.svg:", e);
    process.exit(1);
});