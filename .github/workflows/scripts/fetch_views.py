#!/usr/bin/env python3
"""
fetch_views.py
--------------
Fetch your GitHub profile view count from Komarev, update a JSON snapshot,
and save the official Komarev SVG badge for display in README.

Usage:
  python fetch_views.py --username Someshdiwan \
                        --output .github/profile-views.json \
                        --svg .github/profile-views.svg
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

# ---------- Utility helpers ----------

def ensure_dir(path: str) -> None:
    """Ensure the directory for the given path exists."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)


def read_json_if_exists(path: str) -> dict | None:
    """Read JSON if file exists, else None."""
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_json(path: str, data: dict) -> None:
    """Write JSON with UTF-8 and indentation."""
    ensure_dir(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------- Komarev fetching ----------

def fetch_svg(username: str, label: str = "Profile views", color: str = "0e75b6", style: str = "flat") -> str:
    """Download the Komarev badge SVG."""
    params = {"username": username, "label": label, "color": color, "style": style}
    url = BADGE_BASE + "?" + urlencode(params)
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return resp.text


def extract_views(svg_text: str) -> int:
    """Extract the numeric view count from the SVG text."""
    texts = re.findall(r'>([^<>]+)<', svg_text)
    numbers = [
        t.replace(",", "").strip()
        for t in texts
        if re.fullmatch(r"\d{1,3}(?:,\d{3})*|\d+", t.strip())
    ]
    if numbers:
        return int(numbers[-1])

    # fallback: longest run of digits
    digits = re.findall(r"\d{2,}", svg_text)
    if digits:
        return int(max(digits, key=len))

    raise ValueError("No numeric value found in badge SVG")


# ---------- Main routine ----------

def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch and store GitHub profile views.")
    parser.add_argument("--username", required=True, help="GitHub username")
    parser.add_argument("--output", default=".github/profile-views.json", help="Path to JSON output")
    parser.add_argument("--svg", default=".github/profile-views.svg", help="Path to SVG output")
    args = parser.parse_args()

    try:
        svg = fetch_svg(args.username)
        views = extract_views(svg)
    except Exception as e:
        print(f"❌ ERROR fetching badge: {e}", file=sys.stderr)
        sys.exit(2)

    today = dt.date.today().isoformat()
    data = {"views": views, "date": today}

    # Write outputs
    write_json(args.output, data)
    ensure_dir(args.svg)
    with open(args.svg, "w", encoding="utf-8") as f:
        f.write(svg)

    print(f"✅ Updated {args.username}: {views} views on {today}")
    print(f"   JSON -> {args.output}")
    print(f"   SVG  -> {args.svg}")


if __name__ == "__main__":
    main()