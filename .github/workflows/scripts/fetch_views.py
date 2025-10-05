#!/usr/bin/env python3
"""
fetch_views.py

Fetch komarev profile-views SVG for a GitHub username, extract the RIGHT-SIDE value,
and write JSON:
{
  "views": <int>,
  "date": "YYYY-MM-DD"
}

Usage:
  python .github/workflows/scripts/fetch_views.py \
    --username Someshdiwan \
    --output .github/profile-views.json
"""

from __future__ import annotations
import argparse
import datetime as dt
import json
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
    Strategy:
      1) Grab ALL visible text fragments between '>' and '<'.
      2) Clean them, keep those that are pure numbers (allow commas).
      3) On komarev, the *last* numeric text node is the value side.
    This avoids picking up widths, coordinates, etc.
    """
    # collect all text nodes (not attributes)
    texts = re.findall(r'>([^<>]+)<', svg)
    # strip & collapse whitespace
    cleaned = [t.strip() for t in texts if t.strip()]

    # keep only tokens that look like numbers (with optional commas)
    numeric_tokens = []
    for t in cleaned:
        if re.fullmatch(r'\d{1,3}(?:,\d{3})*|\d+', t):
            numeric_tokens.append(t)

    if not numeric_tokens:
        # fallback: find the longest run of digits in whole SVG
        candidates = re.findall(r'\d{2,}', svg)
        if candidates:
            return int(max(candidates, key=len))
        raise ValueError("No numeric tokens found in SVG")

    # choose the LAST numeric token; komarev puts value at the right side
    val = numeric_tokens[-1].replace(",", "")
    return int(val)

def write_json(path: str, views: int, date_iso: str) -> None:
    data = {"views": views, "date": date_iso}
    # ensure directory exists
    import os
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote {path}: {data}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--label", default="Profile views")
    ap.add_argument("--style", default="flat")
    args = ap.parse_args()

    try:
        svg = fetch_svg(args.username, args.label, args.style)
        views = extract_views(svg)
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)

    today = dt.date.today().isoformat()
    write_json(args.output, views, today)

if __name__ == "__main__":
    main()