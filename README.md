# NIFTY Morning Monitor

A single repository containing:

1. NIFTY morning market data collector
2. Daily JSON data store
3. GitHub synchronization
4. GitHub Pages dashboard

## Monitoring

The monitor runs during:

- 08:30–09:15 IST: every 5 minutes
- 09:15–09:30 IST: every 1 minute

It collects:

- NIFTY futures daily close
- Dynamic NIFTY futures expiry/symbol
- GIFT Nifty
- GIFT − NIFTY futures cue
- NIFTY 50 09:15 open
- Previous trading-day close
- Gap
- Gap status
- CALL/PUT/WAIT signal
- System IST timestamp
- API timestamps

## GitHub

Local JSON is updated at every monitoring interval.

GitHub is pushed approximately every 5 minutes, plus a final push after the monitoring window.

## Repository layout

```text
nifty-morning-monitor/
├── nifty_monitor.py
├── config.json
├── update_manifest.py
├── requirements.txt
├── .gitignore
├── index.html
├── assets/
│   ├── app.js
│   └── style.css
├── data/
│   ├── index.json
│   ├── YYYY-MM-DD.json
│   └── ...
└── logs/
```

## Setup

```bash
python -m venv .venv
```

Linux/macOS:

```bash
source .venv/bin/activate
```

Windows:

```powershell
.venv\Scripts\Activate.ps1
```

Install:

```bash
pip install -r requirements.txt
```

## Environment variables

Do not store secrets in `config.json`.

Example:

```bash
export NSE_CHART_TOKEN="your-token"
export ENABLE_GIT_PUSH="true"
```

Git authentication should be configured separately.

## Run

```bash
python nifty_monitor.py
```

The process can be started before 08:30. It will wait automatically.

## GitHub Pages

Push the repository to GitHub.

Then:

1. Repository → Settings
2. Pages
3. Source: GitHub Actions or Deploy from branch
4. If using branch deployment, select `main` and `/root`
5. Save

The dashboard reads:

```text
data/index.json
```

and then loads the daily JSON files automatically.

## Dashboard

The dashboard provides:

- Date selector
- Latest market summary
- Full timeline
- Cue
- Gap
- Signal
- API timestamps
- Complete selected-record JSON
- Complete-day JSON

No backend server is required. GitHub Pages serves everything as static files.

## Daily data

Example:

```text
data/
├── index.json
├── 2026-10-05.json
├── 2026-10-06.json
└── 2026-10-07.json
```

`update_manifest.py` automatically scans these files and updates `data/index.json`.

## Architecture

```text
                  ┌─────────────────────┐
                  │  Python Monitor     │
                  │  08:30 - 09:30 IST  │
                  └──────────┬──────────┘
                             │
             ┌───────────────┼────────────────┐
             │               │                │
             ▼               ▼                ▼
       NSE Futures      GIFT Nifty       NIFTY 50
             │               │                │
             └───────────────┼────────────────┘
                             ▼
                    Signal Calculation
                             │
                             ▼
                  data/YYYY-MM-DD.json
                             │
                             ▼
                     data/index.json
                             │
                     every ~5 minutes
                             ▼
                       GitHub Push
                             │
                             ▼
                       GitHub Pages
                             │
                             ▼
                       Web Dashboard
```
