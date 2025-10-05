#!/usr/bin/env python3
"""
fetch_views.py

Fetch the komarev profile-views SVG for a GitHub username, extract the numeric count,
and write a JSON snapshot to an output path:

{
  "streak": <numeric_count>,
  "date": "YYYY-MM-DD"
}

Usage (example):
python .github/scripts/fetch_views.py --username Someshdiwan --output .github/profile-views.json
"""

from __future__ import annotations
import argparse
import datetime
import json
import re
import sys
from urllib.parse import urlencode

import requests

BADGE_BASE = "https://komarev.com/ghpvc/"

def fetch_svg(username: str, label: str = "Profile views", style: str = "flat") -> str:
    params = {"username": username, "label": label, "style": style}
    url = BADGE_BASE + "?" + urlencode(params)
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    return resp.text

def extract_number_from_svg(svg_text: str) -> int:
    """
    Heuristics to extract the views number from the returned SVG text.
    Tries a few regex patterns and falls back to the longest digit-run.
    """
    # Common cases: text nodes like ">1234<" or ">1,234<" or ">1234 views<"
    patterns = [
        r'>([\d,]+)\s*views<',  # e.g. ">1,234 views<"
        r'>([\d,]+)<',          # e.g. ">1234<" or ">1,234<"
    ]
    for pat in patterns:
        m = re.search(pat, svg_text, flags=re.IGNORECASE)
        if m:
            s = m.group(1).replace(",", "")
            try:
                return int(s)
            except ValueError:
                continue

    # Fallback: find the longest run of digits (2+ digits to avoid single-year artifacts)
    candidates = re.findall(r'\d{2,}', svg_text)
    if candidates:
        longest = max(candidates, key=len)
        return int(longest)

    raise ValueError("Could not extract numeric count from SVG")

def write_snapshot(path: str, count: int, date_str: str) -> None:
    obj = {"streak": count, "date": date_str}
    # ensure dir exists
    import os
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"Wrote snapshot to {path}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True, help="GitHub username for komarev badge")
    parser.add_argument("--output", required=True, help="Path to write JSON snapshot")
    parser.add_argument("--label", default="Profile views", help="Label param for komarev (optional)")
    parser.add_argument("--style", default="flat", help="Badge style param for komarev (optional)")
    args = parser.parse_args()

    try:
        svg = fetch_svg(args.username, label=args.label, style=args.style)
    except Exception as e:
        print("ERROR: failed to fetch badge:", e, file=sys.stderr)
        sys.exit(2)

    try:
        count = extract_number_from_svg(svg)
    except Exception as e:
        print("ERROR: failed to parse count from badge:", e, file=sys.stderr)
        sys.exit(3)

    today = datetime.date.today().isoformat()
    write_snapshot(args.output, count, today)
    print(f"OK: {args.username} -> {count} on {today}")

if __name__ == "__main__":
    main()