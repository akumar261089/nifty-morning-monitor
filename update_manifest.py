#!/usr/bin/env python3

"""
Update data/index.json after a daily JSON file is created.

Usage:
    python update_manifest.py

The script scans data/YYYY-MM-DD.json files, keeps the newest
date first, and writes data/index.json atomically.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
INDEX_FILE = DATA_DIR / "index.json"

IST = ZoneInfo("Asia/Kolkata")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    dates = []

    for path in DATA_DIR.glob("????-??-??.json"):
        try:
            datetime.strptime(
                path.stem,
                "%Y-%m-%d",
            )
            dates.append(path.stem)
        except ValueError:
            continue

    dates.sort(reverse=True)

    payload = {
        "generated_at": datetime.now(IST).isoformat(),
        "timezone": "Asia/Kolkata",
        "dates": dates,
    }

    temp = INDEX_FILE.with_suffix(".tmp")

    with temp.open("w", encoding="utf-8") as f:
        json.dump(
            payload,
            f,
            indent=2,
        )
        f.write("\n")

    temp.replace(INDEX_FILE)

    print(
        f"Updated {INDEX_FILE} with {len(dates)} dates."
    )


if __name__ == "__main__":
    main()
