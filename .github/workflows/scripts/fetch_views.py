#!/usr/bin/env python3
"""
fetch_views.py

- Fetches komarev profile-views SVG (when --username provided)
- Extracts the numeric value (views)
- Writes .github/profile-views.json with shape: {"views": int, "likes": int, "date": "YYYY-MM-DD"}
- Generates a polished SVG badge .github/profile-views.svg (for README) with:
    * gradient background
    * pulsing heart
    * a short sparkle/glint using <animate> on a small circle
- Supports '--inc-like' to increment likes in the JSON (does NOT require --username)
"""

from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import re
import sys
from urllib.parse import urlencode

import requests

BADGE_BASE = "https://komarev.com/ghpvc/"

def fetch_svg(username: str, label: str = "Profile views", style: str = "flat") -> str:
    params = {"username": username, "label": label, "style": style}
    url = BADGE_BASE + "?" + urlencode(params)
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return r.text

def extract_views(svg: str) -> int:
    """
    Extract the most-likely numeric token from the badge SVG.
    Strategy:
      - collect text nodes (between > and <),
      - pick numeric tokens (like '1,234' or '1234'),
      - choose the last numeric token (komarev places value on the right).
      - fallback: longest run of digits.
    """
    texts = re.findall(r'>([^<>]+)<', svg)
    cleaned = [t.strip() for t in texts if t.strip()]
    numeric_tokens = [t for t in cleaned if re.fullmatch(r'\d{1,3}(?:,\d{3})*|\d+', t)]
    if numeric_tokens:
        val = numeric_tokens[-1].replace(",", "")
        try:
            return int(val)
        except ValueError:
            pass
    candidates = re.findall(r'\d{2,}', svg)
    if candidates:
        return int(max(candidates, key=len))
    raise ValueError("No numeric value found in badge SVG")

def ensure_dir_for(path: str):
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)

def read_json_if_exists(path: str):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except Exception:
            return None

def write_json(path: str, data):
    ensure_dir_for(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def generate_animated_svg(path: str, views: int, likes: int):
    """
    Create a visually pleasing SVG badge with:
      - gradient background
      - bold views number
      - pulsing heart
      - tiny sparkle using SVG <animate> (short duration burst)
    The SVG uses inline CSS and SMIL <animate> for the sparkle.
    """
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="280" height="36" viewBox="0 0 280 36" role="img" aria-label="Profile views">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#1e90ff"/>
    </linearGradient>
    <filter id="f1" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feBlend in="SourceGraphic" in2="b"/>
    </filter>
    <style>
      .label {{ font-family: -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial; font-size:13px; fill:#ffffff; opacity:0.95; }}
      .value {{ font-family: -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial; font-size:14px; font-weight:700; fill:#ffffff; }}
      .heart {{ transform-origin: center; animation: beat 1.4s infinite; }}
      @keyframes beat {{
        0% {{ transform: scale(1); }}
        25% {{ transform: scale(1.08); }}
        50% {{ transform: scale(1); }}
        75% {{ transform: scale(1.06); }}
        100% {{ transform: scale(1); }}
      }}
    </style>
  </defs>

  <!-- background -->
  <rect width="280" height="36" rx="8" fill="url(#g1)"/>

  <!-- left label -->
  <text class="label" x="18" y="22">Profile views</text>

  <!-- value -->
  <text class="value" x="150" y="22">{views:,}</text>

  <!-- heart + likes group -->
  <g transform="translate(210,18)">
    <!-- pulsing heart path -->
    <path class="heart" d="M8 0.5
      C5.5 -0.5 2.5 -0.3 1.1 1.7
      C-0.9 4.9 3.5 9 8 12
      C12.5 9 17 4.9 15 1.7
      C13.6 -0.3 10.6 -0.5 8 0.5Z"
      fill="#ff6b81" stroke="#fff" stroke-opacity="0.15" stroke-width="0.6"/>
    <!-- sparkle: a small circle that briefly brightens and scales -->
    <circle cx="26" cy="-6" r="2" fill="#fff" opacity="0.0">
      <!-- brighten + scale quickly, then fade -->
      <animate attributeName="opacity" values="0;0.9;0" dur="0.9s" begin="0s; spark.end+2s" fill="freeze"/>
      <animate attributeName="r" values="1;5;1" dur="0.9s" begin="0s; spark.end+2s" fill="freeze"/>
      <!-- tiny id to coordinate repeats -->
      <set id="spark" attributeName="visibility" to="visible" begin="0s" />
    </circle>
  </g>

  <!-- likes number -->
  <text class="label" x="240" y="22"> {likes}</text>

</svg>'''
    ensure_dir_for(path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=False, help="GitHub username for komarev badge (required unless --inc-like)")
    parser.add_argument("--output", default=".github/profile-views.json", help="where to write JSON")
    parser.add_argument("--svg", default=".github/profile-views.svg", help="where to write SVG badge")
    parser.add_argument("--inc-like", action="store_true", help="increment likes in the JSON (and exit)")
    args = parser.parse_args()

    # load existing file if present (preserve likes)
    existing = read_json_if_exists(args.output) or {}
    views = int(existing.get("views", 0) or 0)
    likes = int(existing.get("likes", 0) or 0)

    # increment likes only path (no username required)
    if args.inc_like:
        likes += 1
        out = {"views": views, "likes": likes, "date": dt.date.today().isoformat()}
        write_json(args.output, out)
        generate_animated_svg(args.svg, views, likes)
        print(f"OK incremented likes -> {likes}")
        return

    # fetch current views (requires username)
    if not args.username:
        print("ERROR: --username required unless --inc-like is used", file=sys.stderr)
        sys.exit(2)

    try:
        raw_svg = fetch_svg(args.username)
        views = extract_views(raw_svg)
    except Exception as e:
        print("ERROR fetching/parsing badge:", e, file=sys.stderr)
        sys.exit(3)

    out = {"views": views, "likes": likes, "date": dt.date.today().isoformat()}
    write_json(args.output, out)
    generate_animated_svg(args.svg, views, likes)
    print(f"Wrote {args.output} and SVG: views={views} likes={likes}")

if __name__ == "__main__":
    main()