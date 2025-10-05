#!/usr/bin/env python3
"""
fetch_views.py (safe README SVG)

- Fetches komarev badge when --username provided
- Extracts numeric views
- Writes .github/profile-views.json {"views", "likes", "date"}
- Writes a GitHub-safe SVG (no <style>, no <animate>) to .github/profile-views.svg
- Supports --inc-like (increment likes) without requiring --username
"""

from __future__ import annotations
import argparse, datetime as dt, json, os, re, sys
from urllib.parse import urlencode

import requests

BADGE_BASE = "https://komarev.com/ghpvc/"

def fetch_svg(username: str, label: str = "Profile views", style: str = "flat") -> str:
    url = BADGE_BASE + "?" + urlencode({"username": username, "label": label, "style": style})
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return r.text

def extract_views(svg_text: str) -> int:
    texts = re.findall(r'>([^<>]+)<', svg_text)
    cleaned = [t.strip() for t in texts if t.strip()]
    nums = [t for t in cleaned if re.fullmatch(r'\d{1,3}(?:,\d{3})*|\d+', t)]
    if nums:
        return int(nums[-1].replace(",", ""))
    fallback = re.findall(r'\d{2,}', svg_text)
    if fallback:
        return int(max(fallback, key=len))
    raise ValueError("No numeric value found in badge SVG")

def ensure_dir_for(path: str):
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)

def read_json_if_exists(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_json(path: str, data):
    ensure_dir_for(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def generate_safe_svg(path: str, views: int, likes: int):
    """
    Generate a static, sanitized SVG that GitHub will render in README reliably.
    Avoids <style> blocks and SMIL. Uses attributes only.
    """
    # use thousands separator for humans
    views_text = f"{views:,}"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="320" height="36" viewBox="0 0 320 36" role="img" aria-label="Profile views">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0ea5e9"/>
      <stop offset="1" stop-color="#1e90ff"/>
    </linearGradient>
  </defs>

  <!-- background -->
  <rect rx="8" width="320" height="36" fill="url(#g)"/>

  <!-- left label -->
  <text x="18" y="22" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#ffffff">Profile views</text>

  <!-- numeric value -->
  <text x="170" y="22" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="14" fill="#ffffff">{views_text}</text>

  <!-- heart icon (static) -->
  <g transform="translate(230,8)">
    <path d="M8 0.6 C5.6-0.2 3-0.1 1.6 1.7 C-0.7 5 3.6 9.2 8 12 C12.4 9.2 16.7 5 15.4 1.7 C14 -0.1 11.4-0.2 8 0.6 Z" fill="#ff6b81" stroke="#ffffff" stroke-opacity="0.12" stroke-width="0.6"/>
  </g>

  <!-- likes count -->
  <text x="260" y="22" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#ffffff">{likes}</text>

</svg>'''
    ensure_dir_for(path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--username", required=False)
    p.add_argument("--output", default=".github/profile-views.json")
    p.add_argument("--svg", default=".github/profile-views.svg")
    p.add_argument("--inc-like", action="store_true")
    args = p.parse_args()

    existing = read_json_if_exists(args.output) or {}
    views = int(existing.get("views", 0) or 0)
    likes = int(existing.get("likes", 0) or 0)

    if args.inc_like:
        likes += 1
        out = {"views": views, "likes": likes, "date": dt.date.today().isoformat()}
        write_json(args.output, out)
        generate_safe_svg(args.svg, views, likes)
        print("Incremented likes ->", likes)
        return

    if not args.username:
        print("ERROR: --username required unless --inc-like is used", file=sys.stderr)
        sys.exit(2)

    try:
        raw = fetch_svg(args.username)
        views = extract_views(raw)
    except Exception as e:
        print("ERROR fetching/parsing badge:", e, file=sys.stderr)
        sys.exit(3)

    out = {"views": views, "likes": likes, "date": dt.date.today().isoformat()}
    write_json(args.output, out)
    generate_safe_svg(args.svg, views, likes)
    print(f"Wrote {args.output} and safe SVG: views={views}, likes={likes}")

if __name__ == "__main__":
    main()