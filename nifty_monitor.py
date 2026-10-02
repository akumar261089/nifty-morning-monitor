#!/usr/bin/env python3

"""NIFTY 50 morning monitor + GitHub Pages data publisher."""



from __future__ import annotations



import argparse
import json
import logging
import logging.handlers
import os
import subprocess
import sys
import time
from datetime import date, datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo
import requests


BASE_DIR = Path(__file__).resolve().parent

CONFIG_PATH = BASE_DIR / "config/config.json"

IST = ZoneInfo("Asia/Kolkata")





def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)





CONFIG = load_config()



DATA_DIR = BASE_DIR / CONFIG["output"]["data_directory"]

LOG_DIR = BASE_DIR / CONFIG["output"]["log_directory"]

DATA_DIR.mkdir(parents=True, exist_ok=True)

LOG_DIR.mkdir(parents=True, exist_ok=True)



SCHEDULE = CONFIG["schedule"]

STRATEGY = CONFIG["strategy"]

API_CONFIG = CONFIG["api"]

GITHUB = CONFIG["github"]



MONITOR_START = dt_time.fromisoformat(SCHEDULE["start"])

MARKET_OPEN = dt_time.fromisoformat(SCHEDULE["market_open"])

MONITOR_END = dt_time.fromisoformat(SCHEDULE["end"])





def setup_logging() -> logging.Logger:
    logger = logging.getLogger("nifty_monitor")
    logger.setLevel(logging.INFO)
    if logger.handlers:
        return logger
    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        )
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_DIR / "nifty_monitor.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5,

        encoding="utf-8",

    )

    file_handler.setFormatter(fmt)



    logger.addHandler(console)

    logger.addHandler(file_handler)

    return logger





logger = setup_logging()



session = requests.Session()

session.headers.update({

    "User-Agent": "Mozilla/5.0 Chrome/154.0 Safari/537.36",

    "Accept": "application/json,text/plain,*/*",

})



NSE_URL = "https://charting.nseindia.com/v1/charts/symbolHistoricalData"

GIFT_URL = "https://priceapi.moneycontrol.com/globaltechCharts/globalMarket/index/history"

NIFTY_URL = "https://priceapi.moneycontrol.com/techCharts/indianMarket/index/history"



NSE_TOKEN = os.getenv("NSE_CHART_TOKEN", "48704")





def now_ist() -> datetime:

    return datetime.now(IST)





def iso(dt: datetime) -> str:

    return dt.astimezone(IST).isoformat()





def unix(dt: datetime) -> int:

    return int(dt.timestamp())





def api_get(

    url: str,

    params: dict[str, Any],

    name: str,

) -> Optional[dict[str, Any]]:

    retries = int(API_CONFIG["max_retries"])

    timeout = int(API_CONFIG["timeout_seconds"])

    backoff = int(API_CONFIG["retry_backoff_seconds"])



    for attempt in range(1, retries + 1):

        try:

            response = session.get(url, params=params, timeout=timeout)

            response.raise_for_status()

            return response.json()

        except Exception as exc:

            logger.warning(

                "API failed | %s | attempt=%d/%d | %s",

                name, attempt, retries, exc,

            )

            if attempt < retries:

                time.sleep(backoff * attempt)



    return None





def last_tuesday(year: int, month: int) -> date:

    if month == 12:

        first_next = date(year + 1, 1, 1)

    else:

        first_next = date(year, month + 1, 1)



    last_day = first_next - timedelta(days=1)

    return last_day - timedelta(days=(last_day.weekday() - 1) % 7)





# Keep the annual exchange holiday handling isolated so it can be updated

# without changing the rest of the monitor.

HOLIDAY_FILE = Path("config/nse_holidays.json")





def load_nse_holidays() -> set[date]:

    with open(HOLIDAY_FILE, "r", encoding="utf-8") as f:

        data = json.load(f)



    holidays = set()



    for dates in data.values():

        for d in dates:

            holidays.add(date.fromisoformat(d))



    return holidays





NSE_HOLIDAYS = load_nse_holidays()







def is_trading_day(d: date) -> bool:

    return d.weekday() < 5 and d not in NSE_HOLIDAYS





def futures_symbol(ref_date: date) -> tuple[str, date]:

    expiry = last_tuesday(ref_date.year, ref_date.month)



    if ref_date > expiry:

        if ref_date.month == 12:

            expiry = last_tuesday(ref_date.year + 1, 1)

        else:

            expiry = last_tuesday(ref_date.year, ref_date.month + 1)



    while not is_trading_day(expiry):

        expiry -= timedelta(days=1)



    symbol = f"NIFTY{expiry:%y}{expiry:%b}".upper() + "FUT"

    return symbol, expiry





def get_futures() -> dict[str, Any]:

    today = now_ist().date()

    symbol, expiry = futures_symbol(today)



    start = datetime.combine(

        today - timedelta(days=7), dt_time.min, tzinfo=IST

    )

    end = datetime.combine(

        today + timedelta(days=1), dt_time.max, tzinfo=IST

    )



    response = api_get(

        NSE_URL,

        {

            "token": NSE_TOKEN,

            "fromDate": unix(start),

            "toDate": unix(end),

            "symbol": symbol,

            "symbolType": "Futures",

            "chartType": "D",

            "timeInterval": 1,

        },

        f"NIFTY Futures {symbol}",

    )



    if not response or not response.get("data"):

        return {

            "symbol": symbol,

            "expiry_date": expiry.isoformat(),

            "last_close": None,

            "api_time_ist": None,

        }



    rows = sorted(response["data"], key=lambda x: x.get("time", 0))

    row = rows[-1]



    api_time = None

    if row.get("time") is not None:

        api_time = iso(datetime.fromtimestamp(row["time"] / 1000, IST))



    return {

        "symbol": symbol,

        "expiry_date": expiry.isoformat(),

        "last_close": row.get("close"),

        "api_time_ist": api_time,

    }





def get_gift() -> dict[str, Any]:

    now = now_ist()



    response = api_get(

        GIFT_URL,

        {

            "symbol": "in;gsx",

            "resolution": "1D",

            "from": unix(now - timedelta(days=7)),

            "to": unix(now),

            "countback": 10,

            "currencyCode": "inr",

        },

        "GIFT NIFTY",

    )



    if not response:

        return {"last_price": None, "api_time_ist": None}



    timestamps = response.get("t", [])

    closes = response.get("c", [])



    if not timestamps or not closes:

        return {"last_price": None, "api_time_ist": None}



    i = len(timestamps) - 1

    return {

        "last_price": closes[i],

        "api_time_ist": iso(datetime.fromtimestamp(timestamps[i], IST)),

    }





def get_nifty_market() -> dict[str, Any]:

    now = now_ist()



    response = api_get(

        NIFTY_URL,

        {

            "symbol": "in;NSX",

            "resolution": 5,

            "from": unix(now - timedelta(days=10)),

            "to": unix(now),

            "countback": 326,

            "currencyCode": "INR",

        },

        "NIFTY 50",

    )



    empty = {

        "today_open": None,

        "today_open_api_time_ist": None,

        "previous_day_close": None,

        "previous_day_close_api_time_ist": None,

    }



    if not response:

        return empty



    ts = response.get("t", [])

    opens = response.get("o", [])

    closes = response.get("c", [])



    candles = []

    for i, timestamp in enumerate(ts):

        candles.append({

            "dt": datetime.fromtimestamp(timestamp, IST),

            "open": opens[i] if i < len(opens) else None,

            "close": closes[i] if i < len(closes) else None,

        })



    today_candle = next(

        (

            c for c in candles

            if c["dt"].date() == now.date()

            and c["dt"].time() == MARKET_OPEN

        ),

        None,

    )



    previous = [

        c for c in candles

        if c["dt"].date() < now.date()

    ]



    previous_candle = None

    if previous:

        previous_date = max(c["dt"].date() for c in previous)

        previous_candle = max(

            (c for c in previous if c["dt"].date() == previous_date),

            key=lambda c: c["dt"],

        )



    return {

        "today_open": today_candle["open"] if today_candle else None,

        "today_open_api_time_ist": (

            iso(today_candle["dt"]) if today_candle else None

        ),

        "previous_day_close": (

            previous_candle["close"] if previous_candle else None

        ),

        "previous_day_close_api_time_ist": (

            iso(previous_candle["dt"]) if previous_candle else None

        ),

    }





def calculate_signal(

    cue: Optional[float],

    gap: Optional[float],

) -> str:

    if gap is None:

        return "WAITING_FOR_MARKET"



    if gap > float(STRATEGY["normal_gap_high"]):

        return "PUT BUY"



    if gap < float(STRATEGY["normal_gap_low"]):

        return "CALL BUY"



    if cue is None:

        return "WAIT"



    if cue > float(STRATEGY["cue_threshold"]):

        return "CALL BUY"



    if cue < float(STRATEGY["cue_threshold"]):

        return "PUT BUY"



    return "WAIT"





def collect_update() -> dict[str, Any]:

    current = now_ist()



    futures = get_futures()

    gift = get_gift()



    cue = None

    if futures["last_close"] is not None and gift["last_price"] is not None:

        cue = gift["last_price"] - futures["last_close"]



    market = {

        "today_open": None,

        "today_open_api_time_ist": None,

        "previous_day_close": None,

        "previous_day_close_api_time_ist": None,

    }



    gap = None



    if current.time() >= MARKET_OPEN:

        market = get_nifty_market()



        if (

            market["today_open"] is not None

            and market["previous_day_close"] is not None

        ):

            gap = (

                market["today_open"]

                - market["previous_day_close"]

            )



    low = float(STRATEGY["normal_gap_low"])

    high = float(STRATEGY["normal_gap_high"])



    if gap is None:

        gap_status = "WAITING_FOR_MARKET"

    elif gap > high:

        gap_status = "GAP_UP"

    elif gap < low:

        gap_status = "GAP_DOWN"

    else:

        gap_status = "NORMAL"



    return {

        "system_time_ist": iso(current),

        "system_timestamp": int(current.timestamp()),



        "nifty_futures": futures,



        "gift_nifty": gift,



        "cue": {

            "value": cue,

            "formula": "GIFT_NIFTY - NIFTY_FUTURES",

            "threshold": float(STRATEGY["cue_threshold"]),

        },



        "market": {

            "market_open_time_ist": "09:15:00",

            **market,

        },



        "gap": {

            "value": gap,

            "status": gap_status,

            "normal_range": [low, high],

        },



        "decision": {

            "signal": calculate_signal(cue, gap),

        },

    }





def json_path(d: date) -> Path:

    return DATA_DIR / f"{d.isoformat()}.json"





def load_day(path: Path) -> dict[str, Any]:

    if not path.exists():

        return {

            "date": path.stem,

            "timezone": "Asia/Kolkata",

            "market": "NIFTY 50",

            "monitoring_window": {

                "start": SCHEDULE["start"],

                "end": SCHEDULE["end"],

            },

            "updates": [],

        }



    try:

        with path.open("r", encoding="utf-8") as f:

            return json.load(f)

    except Exception:

        logger.exception("Could not read %s; starting a new day file", path)

        return {

            "date": path.stem,

            "timezone": "Asia/Kolkata",

            "market": "NIFTY 50",

            "updates": [],

        }





def save_json(path: Path, payload: dict[str, Any]) -> None:

    temp = path.with_suffix(".tmp")

    with temp.open("w", encoding="utf-8") as f:

        json.dump(payload, f, indent=2, ensure_ascii=False)

        f.write("\n")

    temp.replace(path)





def update_manifest() -> None:

    dates = []
    for path in DATA_DIR.glob("????-??-??.json"):

        try:

            datetime.strptime(path.stem, "%Y-%m-%d")

            dates.append(path.stem)

        except ValueError:

            pass



    dates.sort(reverse=True)
    payload = {
        "generated_at": iso(now_ist()),
        "timezone": "Asia/Kolkata",
        "dates": dates,
    }



    path = DATA_DIR / "index.json"

    temp = path.with_suffix(".tmp")



    with temp.open("w", encoding="utf-8") as f:

        json.dump(payload, f, indent=2)

        f.write("\n")



    temp.replace(path)





def git_push(path: Path) -> bool:

    if not GITHUB.get("enabled", False):

        return False



    try:

        relative = path.relative_to(BASE_DIR)



        subprocess.run(

            ["git", "add", str(relative), "data/index.json"],

            cwd=BASE_DIR,

            check=True,

            capture_output=True,

            text=True,

        )



        diff = subprocess.run(

            ["git", "diff", "--cached", "--quiet"],

            cwd=BASE_DIR,

            check=False,

        )



        if diff.returncode == 0:

            logger.info("GitHub: no changes to commit")

            return True



        subprocess.run(

            [

                "git",

                "commit",

                "-m",

                f"NIFTY update {now_ist():%Y-%m-%d %H:%M:%S IST}",

            ],

            cwd=BASE_DIR,

            check=True,

            capture_output=True,

            text=True,

        )



        subprocess.run(

            [

                "git",

                "push",

                GITHUB.get("remote", "origin"),

                GITHUB.get("branch", "main"),

            ],

            cwd=BASE_DIR,

            check=True,

            capture_output=True,

            text=True,

        )



        logger.info("GitHub push successful")

        return True



    except subprocess.CalledProcessError as exc:

        logger.error(

            "GitHub failed | stdout=%s | stderr=%s",

            exc.stdout,

            exc.stderr,

        )

        return False





def next_poll_time(current: datetime) -> datetime:

    if current.time() < MARKET_OPEN:

        minute = current.minute

        next_minute = ((minute // 5) + 1) * 5



        if next_minute >= 60:

            return (

                current + timedelta(hours=1)

            ).replace(

                minute=0, second=0, microsecond=0

            )



        return current.replace(

            minute=next_minute,

            second=0,

            microsecond=0,

        )



    return (

        current + timedelta(minutes=1)

    ).replace(

        second=0,

        microsecond=0,

    )





def run() -> None:
    parser = argparse.ArgumentParser(
        description="NIFTY 50 morning monitor + GitHub Pages data publisher."
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run one monitoring cycle immediately, ignoring trading-day/time-window checks and without GitHub push.",
    )
    args = parser.parse_args()

    current = now_ist()

    if args.test:
        logger.info("TEST MODE: ignoring trading-day and monitoring-window checks")

        try:
            update = collect_update()
            path = json_path(current.date())

            payload = load_day(path)
            payload["last_updated_system_time_ist"] = update["system_time_ist"]
            payload["last_signal"] = update["decision"]["signal"]
            payload["updates"].append(update)

            save_json(path, payload)
            update_manifest()

            logger.info("TEST MODE: update saved to %s", path)
            logger.info("TEST MODE: GitHub push skipped")
        except Exception:
            logger.exception("TEST MODE cycle failed")
            raise

        logger.info("Monitor finished")
        return

    if not is_trading_day(current.date()):
        logger.info("Not an NSE trading day: %s", current.date())
        return

    if current.time() < MONITOR_START:
        start = datetime.combine(
            current.date(), MONITOR_START, tzinfo=IST
        )
        wait = (start - current).total_seconds()
        logger.info("Waiting until %s IST", MONITOR_START)
        time.sleep(max(1, wait))

    last_push: Optional[datetime] = None
    push_interval = int(
        SCHEDULE["github_push_interval_seconds"]
    )

    while True:
        current = now_ist()

        if current.time() > MONITOR_END:
            break

        try:
            update = collect_update()
            path = json_path(current.date())

            payload = load_day(path)
            payload["last_updated_system_time_ist"] = (
                update["system_time_ist"]
            )
            payload["last_signal"] = (
                update["decision"]["signal"]
            )
            payload["updates"].append(update)

            save_json(path, payload)
            update_manifest()

            if (
                last_push is None
                or (current - last_push).total_seconds()
                >= push_interval
            ):
                if git_push(path):
                    last_push = now_ist()

        except Exception:
            logger.exception("Monitoring cycle failed")

        if now_ist().time() <= MONITOR_END:
            next_run = next_poll_time(now_ist())
            sleep_for = max(
                0,
                (next_run - now_ist()).total_seconds()
            )

            logger.info(
                "Next poll at %s IST",
                iso(next_run),
            )

            time.sleep(sleep_for)

    # Always publish the final state.
    try:
        path = json_path(current.date())
        if path.exists():
            update_manifest()
            git_push(path)
    except Exception:
        logger.exception("Final GitHub push failed")

    logger.info("Monitor finished")


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        logger.info("Stopped by user")
    except Exception:
        logger.exception("Fatal error")
        raise