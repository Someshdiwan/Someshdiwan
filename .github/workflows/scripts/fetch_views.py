#!/usr/bin/env python3
"""
fetch_views.py

- Fetches komarev profile-views SVG
- Extracts the numeric value (views)
- Writes .github/profile-views.json with shape: {"views": int, "likes": int, "date": "YYYY-MM-DD"}
- Generates a small SVG badge .github/profile-views.svg (for README)
- Supports '--inc-like' to increment likes in the JSON (for future use / manual)
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
    # Collect text nodes and pick the last numeric token (komarev puts value on the right).
    texts = re.findall(r'>([^<>]+)<', svg)
    cleaned = [t.strip() for t in texts if t.strip()]
    numeric_tokens = [t for t in cleaned if re.fullmatch(r'\d{1,3}(?:,\d{3})*|\d+', t)]
    if numeric_tokens:
        val = numeric_tokens[-1].replace(",", "")
        return int(val)
    # fallback: longest run of digits
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
        return json.load(f)

def write_json(path: str, data):
    ensure_dir_for(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def generate_svg_badge(path: str, views: int, likes: int):
    """
    Very small flat SVG badge (self-contained). Keeps visual simple and suitable for README.
    """
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="220" height="20" viewBox="0 0 220 20" role="img" aria-label="Profile views">
  <rect width="220" height="20" rx="3" fill="#555"></rect>
  <rect x="100" width="120" height="20" rx="3" fill="#0e75b6"></rect>
  <g fill="#fff" font-family="Verdana,Arial,Helvetica,sans-serif" font-size="11">
    <text x="10" y="14">Profile views</text>
    <text x="110" y="14">{views}</text>
  </g>
  <!-- optional small heart on right -->
  <g transform="translate(190,2)">
    <path d="M8 2c-1.657 0-3 1.343-3 3 0 3 6 6.5 6 6.5s6-3.5 6-6.5c0-1.657-1.343-3-3-3-1.042 0-1.947.6-2.5 1.453C9.947 2.6 9.042 2 8 2z" fill="#fff" opacity="0.85"/>
  </g>
</svg>'''
    ensure_dir_for(path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True)
    ap.add_argument("--output", default=".github/profile-views.json", help="where to write JSON")
    ap.add_argument("--svg", default=".github/profile-views.svg", help="where to write small SVG badge")
    ap.add_argument("--inc-like", action="store_true", help="increment likes in the JSON (and exit)")
    args = ap.parse_args()

    # Load existing JSON to preserve likes counter
    existing = read_json_if_exists(args.output) or {}
    likes = int(existing.get("likes", 0))

    if args.inc_like:
        likes += 1
        data = {
            "views": int(existing.get("views", 0)),
            "likes": likes,
            "date": dt.date.today().isoformat()
        }
        write_json(args.output, data)
        print("Incremented likes ->", likes)
        # update svg too
        generate_svg_badge(args.svg, data["views"], data["likes"])
        return

    try:
        svg_text = fetch_svg(args.username)
        views = extract_views(svg_text)
    except Exception as e:
        print("ERROR fetching/parsing badge:", e, file=sys.stderr)
        sys.exit(2)

    today = dt.date.today().isoformat()
    data = {"views": views, "likes": likes, "date": today}
    write_json(args.output, data)
    generate_svg_badge(args.svg, views, likes)
    print(f"Wrote {args.output}: {data}")
    print(f"Wrote SVG badge to {args.svg}")

if __name__ == "__main__":
    main()