#!/usr/bin/env python3

from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from urllib.parse import urlencode

import requests

BADGE_BASE = "https://komarev.com/ghpvc/"

# ---------------- helpers ----------------

def ensure_dir_for(path: str) -> None:
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)

def read_json(path: str):
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

# ---------------- fetching/parsing ----------------

def fetch_svg(username: str, label: str = "Profile views", color: str = "0e75b6", style: str = "flat") -> str:
    params = {"username": username, "label": label, "color": color, "style": style}
    url = BADGE_BASE + "?" + urlencode(params)
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return resp.text

def extract_views(svg_text: str) -> int:
    # Gather visible text nodes and pick last numeric token
    texts = re.findall(r'>([^<>]+)<', svg_text)
    cleaned = [t.strip() for t in texts if t.strip()]
    numeric = [t for t in cleaned if re.fullmatch(r'\d{1,3}(?:,\d{3})*|\d+', t)]
    if numeric:
        try:
            return int(numeric[-1].replace(",", ""))
        except ValueError:
            pass
    # fallback: longest run of digits
    candidates = re.findall(r'\d{2,}', svg_text)
    if candidates:
        return int(max(candidates, key=len))
    raise ValueError("No numeric value found in badge SVG")

# ---------------- history handling ----------------

def append_history(history_path: str, date_str: str, views: int, max_days: int = 3650):
    """
    Read existing history (list of {"date","views"}) or create new.
    If last entry has same date, replace it. Otherwise append.
    Trim to max_days (default 10 years).
    """
    hist = read_json(history_path) or []
    # ensure list
    if not isinstance(hist, list):
        hist = []

    if hist and hist[-1].get("date") == date_str:
        hist[-1]["views"] = views
    else:
        hist.append({"date": date_str, "views": views})

    # trim oldest if too long
    if len(hist) > max_days:
        hist = hist[-max_days:]
    write_json(history_path, hist)
    return hist

# ---------------- retry helper ----------------

def fetch_with_retries(username: str, tries: int = 3, delay: int = 4):
    last_exc = None
    for attempt in range(1, tries + 1):
        try:
            return fetch_svg(username)
        except Exception as e:
            last_exc = e
            if attempt < tries:
                time.sleep(delay)
    # final raise
    raise last_exc

# ---------------- main ----------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True, help="GitHub username for komarev")
    ap.add_argument("--snapshot", default=".github/profile-views.json", help="latest snapshot JSON")
    ap.add_argument("--history", default=".github/profile-views-history.json", help="history JSON (array)")
    ap.add_argument("--svg", default=".github/profile-views.svg", help="path to save komarev svg")
    args = ap.parse_args()

    today = dt.date.today().isoformat()

    try:
        raw_svg = fetch_with_retries(args.username, tries=3, delay=3)
        views = extract_views(raw_svg)
    except Exception as e:
        print("ERROR: failed to fetch/parse komarev badge:", e, file=sys.stderr)
        sys.exit(2)

    # snapshot
    snapshot = {"views": views, "date": today}
    write_json(args.snapshot, snapshot)

    # history append
    hist = append_history(args.history, today, views)

    # save svg
    ensure_dir_for(args.svg)
    with open(args.svg, "w", encoding="utf-8") as f:
        f.write(raw_svg)

    print(f"OK: {args.username} -> views={views}, date={today}")
    print(f"Snapshot: {args.snapshot}")
    print(f"History entries: {len(hist)} (latest: {hist[-1] if hist else None})")
    print(f"SVG: {args.svg}")

if __name__ == "__main__":
    main()