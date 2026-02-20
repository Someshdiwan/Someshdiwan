#!/usr/bin/env python3
"""
Fetches the komarev.com profile-views badge SVG, extracts the view count,
writes a snapshot JSON, appends to a history JSON, and saves the raw SVG.
"""

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


# ── helpers ──────────────────────────────────────────────────────────────────

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


def write_json(path: str, data) -> None:
    ensure_dir_for(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── fetch & parse ─────────────────────────────────────────────────────────────

def fetch_svg(username: str) -> str:
    params = {
        "username": username,
        "label": "Profile views",
        "color": "0e75b6",
        "style": "flat",
    }
    url = BADGE_BASE + "?" + urlencode(params)
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return resp.text


def extract_views(svg_text: str) -> int:
    # All visible text nodes inside SVG tags
    texts = re.findall(r">([^<>]+)<", svg_text)
    cleaned = [t.strip() for t in texts if t.strip()]
    # Match plain integers or comma-formatted numbers e.g. 4,368
    numeric = [t for t in cleaned if re.fullmatch(r"\d{1,3}(?:,\d{3})*|\d+", t)]
    if numeric:
        return int(numeric[-1].replace(",", ""))
    # Fallback: longest digit sequence in raw SVG
    candidates = re.findall(r"\d{2,}", svg_text)
    if candidates:
        return int(max(candidates, key=len))
    raise ValueError("No numeric view count found in badge SVG")


# ── history ───────────────────────────────────────────────────────────────────

def append_history(path: str, date_str: str, views: int, max_days: int = 3650) -> list:
    hist = read_json(path) or []
    if not isinstance(hist, list):
        hist = []

    if hist and hist[-1].get("date") == date_str:
        hist[-1]["views"] = views          # update today's entry in-place
    else:
        hist.append({"date": date_str, "views": views})

    if len(hist) > max_days:
        hist = hist[-max_days:]

    write_json(path, hist)
    return hist


# ── retry ─────────────────────────────────────────────────────────────────────

def fetch_with_retries(username: str, tries: int = 3, delay: int = 4) -> str:
    last_exc: Exception | None = None
    for attempt in range(1, tries + 1):
        try:
            return fetch_svg(username)
        except Exception as exc:
            last_exc = exc
            print(f"Attempt {attempt}/{tries} failed: {exc}", file=sys.stderr)
            if attempt < tries:
                time.sleep(delay)
    raise last_exc  # type: ignore[misc]


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch komarev profile-view count")
    ap.add_argument("--username", required=True)
    ap.add_argument("--snapshot", default=".github/profile-views.json")
    ap.add_argument("--history",  default=".github/profile-views-history.json")
    ap.add_argument("--svg",      default=".github/profile-views.svg")
    args = ap.parse_args()

    today = dt.date.today().isoformat()

    try:
        raw_svg = fetch_with_retries(args.username, tries=3, delay=3)
        views   = extract_views(raw_svg)
    except Exception as exc:
        print(f"FATAL: could not fetch/parse badge — {exc}", file=sys.stderr)
        sys.exit(2)

    write_json(args.snapshot, {"views": views, "date": today})

    hist = append_history(args.history, today, views)

    ensure_dir_for(args.svg)
    with open(args.svg, "w", encoding="utf-8") as f:
        f.write(raw_svg)

    print(f"✅  {args.username} → views={views}, date={today}")
    print(f"    snapshot : {args.snapshot}")
    print(f"    history  : {len(hist)} entries (latest: {hist[-1]})")
    print(f"    svg      : {args.svg}")


if __name__ == "__main__":
    main()