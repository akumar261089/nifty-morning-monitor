/*

* NIFTY Morning Monitor — browser-only version

*

* No backend is required for the application logic.

*

* IMPORTANT:

* 1. Browser JavaScript cannot bypass CORS.

* 2. NSE/Moneycontrol may change, restrict, or block browser-origin requests.

* 3. Do NOT put private API keys/secrets in this file.

*

* The calculations below mirror the Python monitor:

*  cue = GIFT_NIFTY - NIFTY_FUTURES

*  gap = NIFTY_OPEN - PREVIOUS_DAY_CLOSE

*  gap > normal_gap_high => PUT BUY

*  gap < normal_gap_low  => CALL BUY

*  otherwise cue > threshold => CALL BUY

*  otherwise cue < threshold => PUT BUY

*/

const CONFIG = {
  timezone: "Asia/Kolkata",

  pollBeforeOpenMs: 5 * 60 * 1000,

  pollDuringMarketMs: 60 * 1000,

  maxRetries: 3,

  strategy: {
    cueThreshold: 50,

    normalGapLow: -120,

    normalGapHigh: 120,
  },

  api: {
    // Same endpoints used by the original Python program.

    gift: {
      name: "GIFT Nifty / Moneycontrol",

      url: "https://priceapi.moneycontrol.com/globaltechCharts/globalMarket/index/history",
    },

    nifty: {
      name: "NIFTY 50 / Moneycontrol",

      url: "https://priceapi.moneycontrol.com/techCharts/indianMarket/index/history",
    },

    futures: {
      name: "NIFTY Futures / NSE Charting",

      url: "https://charting.nseindia.com/v1/charts/symbolHistoricalData",

      token: "48704",
    },
  },
};

let currentData = null;

let selectedDate = null;

let pollTimer = null;

const $ = (id) => document.getElementById(id);

function now() {
  return new Date();
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "number" && Number.isFinite(value))
    return value.toFixed(digits);

  return String(value);
}

function isoIST(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.timezone,

    year: "numeric",

    month: "2-digit",

    day: "2-digit",

    hour: "2-digit",

    minute: "2-digit",

    second: "2-digit",

    hour12: false,
  }).formatToParts(value);

  const get = (type) => parts.find((p) => p.type === type)?.value || "00";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

function istDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.timezone,

    year: "numeric",

    month: "2-digit",

    day: "2-digit",
  }).format(value);
}

function unixSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function unixMillis(value) {
  return Math.floor(new Date(value).getTime());
}

function signalClass(signal) {
  if (!signal) return "";

  if (signal.includes("CALL")) return "signal-call";

  if (signal.includes("PUT")) return "signal-put";

  return "waiting";
}

function gapClass(status) {
  if (status === "GAP_UP") return "positive";

  if (status === "GAP_DOWN") return "negative";

  return "normal";
}

async function fetchJson(url, options = {}, attempt = 1) {
  try {
    const response = await fetch(url, {
      ...options,

      cache: "no-store",

      headers: {
        Accept: "application/json, text/plain, */*",

        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (attempt < CONFIG.maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));

      return fetchJson(url, options, attempt + 1);
    }

    throw error;
  }
}

function setStatus(text, color = "var(--yellow)") {
  $("statusText").textContent = text;

  $("statusDot").style.background = color;
}

function renderApiStatus(items) {
  $("apiStatus").innerHTML = items

    .map(
      (x) => `

  <div class="source ${x.ok ? "ok" : x.loading ? "loading" : "error"}">

   <strong>${escapeHtml(x.name)}</strong>:

   ${escapeHtml(x.message)}

  </div>

 `,
    )

    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")

    .replaceAll("<", "&lt;")

    .replaceAll(">", "&gt;")

    .replaceAll('"', "&quot;")

    .replaceAll("'", "&#039;");
}

/* ---------- Client-side market calculations ---------- */

function lastTuesday(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));

  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);

  return d;
}

function futuresSymbol(date = new Date()) {
  // Approximation of the original Python monthly-expiry logic.

  // If an exchange holiday moves expiry earlier, NSE's actual symbol

  // may differ; the API failure/status area makes that visible.

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CONFIG.timezone,

    year: "numeric",

    month: "2-digit",

    day: "2-digit",
  }).formatToParts(date);

  const y = Number(parts.find((p) => p.type === "year").value);

  const m = Number(parts.find((p) => p.type === "month").value) - 1;

  const day = Number(parts.find((p) => p.type === "day").value);

  let expiry = lastTuesday(y, m);

  if (day > expiry.getUTCDate()) {
    expiry = lastTuesday(m === 11 ? y + 1 : y, (m + 1) % 12);
  }

  const mon = expiry

    .toLocaleString("en-US", { month: "short", timeZone: "UTC" })

    .toUpperCase();

  return `NIFTY${String(expiry.getUTCFullYear()).slice(-2)}${mon}FUT`;
}

function calculateSignal(cue, gap) {
  if (gap === null || gap === undefined) return "WAITING_FOR_MARKET";

  if (gap > CONFIG.strategy.normalGapHigh) return "PUT BUY";

  if (gap < CONFIG.strategy.normalGapLow) return "CALL BUY";

  if (cue === null || cue === undefined) return "WAIT";

  if (cue > CONFIG.strategy.cueThreshold) return "CALL BUY";

  if (cue < CONFIG.strategy.cueThreshold) return "PUT BUY";

  return "WAIT";
}

function calculateUpdate({ gift, futures, market, time = new Date() }) {
  const cue =
    gift.last_price != null && futures.last_close != null
      ? Number(gift.last_price) - Number(futures.last_close)
      : null;

  const gap =
    market.today_open != null && market.previous_day_close != null
      ? Number(market.today_open) - Number(market.previous_day_close)
      : null;

  let gapStatus = "WAITING_FOR_MARKET";

  if (gap != null) {
    if (gap > CONFIG.strategy.normalGapHigh) gapStatus = "GAP_UP";
    else if (gap < CONFIG.strategy.normalGapLow) gapStatus = "GAP_DOWN";
    else gapStatus = "NORMAL";
  }

  return {
    system_time_ist: isoIST(time),

    system_timestamp: Math.floor(time.getTime() / 1000),

    nifty_futures: futures,

    gift_nifty: gift,

    cue: {
      value: cue,

      formula: "GIFT_NIFTY - NIFTY_FUTURES",

      threshold: CONFIG.strategy.cueThreshold,
    },

    market: {
      market_open_time_ist: "09:15:00",

      ...market,
    },

    gap: {
      value: gap,

      status: gapStatus,

      normal_range: [
        CONFIG.strategy.normalGapLow,

        CONFIG.strategy.normalGapHigh,
      ],
    },

    decision: {
      signal: calculateSignal(cue, gap),
    },
  };
}

/* ---------- Direct API adapters ---------- */

async function getGift(date = new Date()) {
  const end = unixSeconds(date);

  const start = end - 10 * 86400;

  const params = new URLSearchParams({
    symbol: "in;gsx",

    resolution: "1D",

    from: String(start),

    to: String(end),

    countback: "10",

    currencyCode: "inr",
  });

  const response = await fetchJson(`${CONFIG.api.gift.url}?${params}`);

  const timestamps = response?.t || [];

  const closes = response?.c || [];

  if (!timestamps.length || !closes.length) {
    throw new Error("No GIFT Nifty candles returned");
  }

  const rows = timestamps

    .map((t, i) => ({
      timestamp: Number(t),

      close: closes[i],
    }))

    .filter((x) => x.close != null);

  const wanted = istDate(date);

  const matching = rows.filter(
    (x) => istDate(new Date(x.timestamp * 1000)) === wanted,
  );

  const row = matching.at(-1) || rows.at(-1);

  return {
    last_price: row ? Number(row.close) : null,

    api_time_ist: row ? new Date(row.timestamp * 1000).toISOString() : null,
  };
}

async function getNiftyMarket(date = new Date()) {
  const end = unixSeconds(date);
  const start = end - 12 * 86400;

  const params = new URLSearchParams({
    symbol: "in;NSX",
    resolution: "5",
    from: String(start),
    to: String(end),
    countback: "326",
    currencyCode: "INR",
  });

  const response = await fetchJson(`${CONFIG.api.nifty.url}?${params}`);
  const ts = response?.t || [];
  const opens = response?.o || [];
  const highs = response?.h || [];
  const lows = response?.l || [];
  const closes = response?.c || [];

  const candles = ts.map((t, i) => ({
    dt: new Date(Number(t) * 1000),
    open: opens[i] ?? null,
    high: highs[i] ?? null,
    low: lows[i] ?? null,
    close: closes[i] ?? null,
  }));

  const wanted = istDate(date);
  const today = candles.filter((c) => istDate(c.dt) === wanted);

  // Find the 09:15 IST candle.
  const todayOpen = today.find((c) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: CONFIG.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(c.dt);

    const h = parts.find((p) => p.type === "hour")?.value;
    const m = parts.find((p) => p.type === "minute")?.value;
    return h === "09" && m === "15";
  });

  const priorDates = [
    ...new Set(
      candles.filter((c) => istDate(c.dt) < wanted).map((c) => istDate(c.dt)),
    ),
  ].sort();

  const previousDate = priorDates.at(-1);
  const previous = previousDate
    ? candles.filter((c) => istDate(c.dt) === previousDate).at(-1)
    : null;

  return {
    today_open: todayOpen?.open ?? null,
    today_open_api_time_ist: todayOpen?.dt?.toISOString() ?? null,
    previous_day_close: previous?.close ?? null,
    previous_day_close_api_time_ist: previous?.dt?.toISOString() ?? null,
    candles: today,
  };
}

async function getFutures(date = new Date()) {
  const symbol = futuresSymbol(date);

  const end = unixSeconds(date);

  const start = end - 10 * 86400;

  const params = new URLSearchParams({
    token: CONFIG.api.futures.token,

    // NSE charting API expects Unix timestamps in seconds here.

    // The original Python implementation sends unix(start)/unix(end).

    fromDate: String(start),

    toDate: String(end),

    symbol,

    symbolType: "Futures",

    chartType: "D",

    timeInterval: "1",
  });

  const response = await fetchJson(`${CONFIG.api.futures.url}?${params}`);

  const rows = [...(response?.data || [])].sort(
    (a, b) => Number(a.time) - Number(b.time),
  );

  if (!rows.length) {
    throw new Error(`No futures data returned for ${symbol}`);
  }

  const row = rows.at(-1);

  return {
    symbol,

    expiry_date: null,

    last_close: row.close ?? null,

    api_time_ist: row.time ? new Date(Number(row.time)).toISOString() : null,
  };
}

/* ---------- UI ---------- */

function renderSummary(update) {
  const container = $("summary");

  if (!update) {
    container.innerHTML = `<div class="card"><div class="value">No data</div></div>`;

    return;
  }

  const cue = update.cue?.value;

  const gap = update.gap?.value;

  const signal = update.decision?.signal;

  container.innerHTML = `

  <div class="card">

   <div class="label">GIFT Nifty</div>

   <div class="value">${fmt(update.gift_nifty?.last_price)}</div>

   <div class="sub">${escapeHtml(update.gift_nifty?.api_time_ist || "—")}</div>

  </div>

  <div class="card">

   <div class="label">NIFTY Future</div>

   <div class="value">${fmt(update.nifty_futures?.last_close)}</div>

   <div class="sub">${escapeHtml(update.nifty_futures?.symbol || "—")}</div>

  </div>

  <div class="card">

   <div class="label">Cue</div>

   <div class="value">${fmt(cue)}</div>

   <div class="sub">GIFT − FUT</div>

  </div>

  <div class="card">

   <div class="label">NIFTY Open</div>

   <div class="value">${fmt(update.market?.today_open)}</div>

   <div class="sub">${escapeHtml(update.market?.today_open_api_time_ist || "Waiting")}</div>

  </div>

  <div class="card">

   <div class="label">Gap</div>

   <div class="value ${gapClass(update.gap?.status)}">${fmt(gap)}</div>

   <div class="sub">${escapeHtml(update.gap?.status || "—")}</div>

  </div>

  <div class="card">

   <div class="label">Signal</div>

   <div class="value ${signalClass(signal)}">${escapeHtml(signal || "—")}</div>

   <div class="sub">${escapeHtml(update.system_time_ist || "—")}</div>

  </div>

 `;
}

function renderTimeline(data) {
  const tbody = $("timelineTable").querySelector("tbody");

  tbody.innerHTML = "";

  const updates = data?.updates || [];

  $("recordCount").textContent = `${updates.length} records`;

  updates.forEach((u) => {
    const tr = document.createElement("tr");

    const cue = u.cue?.value;

    const gap = u.gap?.value;

    const signal = u.decision?.signal;

    tr.innerHTML = `

   <td>${escapeHtml(u.system_time_ist || "—")}</td>

   <td>${fmt(u.gift_nifty?.last_price)}</td>

   <td>${fmt(u.nifty_futures?.last_close)}</td>

   <td class="${cue >= CONFIG.strategy.cueThreshold ? "positive" : cue != null ? "negative" : ""}">

    ${fmt(cue)}

   </td>

   <td>${fmt(u.market?.today_open)}</td>

   <td>${fmt(u.market?.previous_day_close)}</td>

   <td class="${gapClass(u.gap?.status)}">${fmt(gap)}</td>

   <td class="${gapClass(u.gap?.status)}">${escapeHtml(u.gap?.status || "—")}</td>

   <td class="${signalClass(signal)}">${escapeHtml(signal || "—")}</td>

  `;

    tr.addEventListener("click", () => {
      document

        .querySelectorAll("#timelineTable tbody tr")

        .forEach((r) => r.classList.remove("selected"));

      tr.classList.add("selected");

      $("rawJson").textContent = JSON.stringify(u, null, 2);
    });

    tbody.appendChild(tr);
  });

  if (updates.length) {
    $("rawJson").textContent = JSON.stringify(updates.at(-1), null, 2);
  }
}

function availableDates() {
  const dates = [];

  const d = new Date();

  // Give the selector a useful client-side history window.

  // Actual API results determine whether a particular date has data.

  for (let i = 0; i < 30; i++) {
    const candidate = new Date(d);

    candidate.setDate(d.getDate() - i);

    const weekday = candidate.getDay();

    if (weekday !== 0 && weekday !== 6) {
      dates.push(istDate(candidate));
    }
  }

  return dates;
}

function populateDates() {
  const select = $("dateSelect");

  select.innerHTML = "";

  for (const date of availableDates()) {
    const option = document.createElement("option");

    option.value = date;

    option.textContent = date;

    select.appendChild(option);
  }

  if (!selectedDate) selectedDate = select.value;

  select.value = selectedDate;
}

function loadCachedDay(date) {
  try {
    const raw = localStorage.getItem(`nifty-monitor:${date}`);

    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCachedDay(data) {
  if (!data?.date) return;

  try {
    localStorage.setItem(`nifty-monitor:${data.date}`, JSON.stringify(data));
  } catch {
    // Storage is optional; the live UI still works.
  }
}

async function loadDate(date, { live = true } = {}) {
  selectedDate = date;

  setStatus(`Loading ${date}...`);

  $("refreshBtn").disabled = true;

  const dateObj = new Date(`${date}T12:00:00+05:30`);

  const results = await Promise.allSettled([
    getGift(dateObj),

    getFutures(dateObj),

    getNiftyMarket(dateObj),
  ]);

  const names = [
    CONFIG.api.gift.name,

    CONFIG.api.futures.name,

    CONFIG.api.nifty.name,
  ];

  const statuses = results.map((r, i) => ({
    name: names[i],

    ok: r.status === "fulfilled",

    loading: false,

    message:
      r.status === "fulfilled"
        ? "Connected"
        : `Failed: ${r.reason?.message || "request error"}`,
  }));

  renderApiStatus(statuses);

  const gift =
    results[0].status === "fulfilled"
      ? results[0].value
      : { last_price: null, api_time_ist: null };

  const futures =
    results[1].status === "fulfilled"
      ? results[1].value
      : {
          symbol: futuresSymbol(dateObj),

          last_close: null,

          api_time_ist: null,
        };

  const market =
    results[2].status === "fulfilled"
      ? results[2].value
      : {
          today_open: null,

          today_open_api_time_ist: null,

          previous_day_close: null,

          previous_day_close_api_time_ist: null,
        };

  const allFailed = results.every((r) => r.status === "rejected");

  if (allFailed) {
    const cached = loadCachedDay(date);

    if (cached) {
      currentData = cached;

      renderSummary(cached.updates?.at(-1));

      renderTimeline(cached);

      $("dayJson").textContent = JSON.stringify(cached, null, 2);

      $("lastUpdated").textContent = "Showing locally cached data";

      setStatus("APIs unavailable — cached data shown", "var(--yellow)");
    } else {
      currentData = null;

      renderSummary(null);

      renderTimeline({ updates: [] });

      $("dayJson").textContent = JSON.stringify(
        {
          error: "All direct API requests failed",

          date,

          hint: "This is usually a browser CORS/API-access issue, not a calculation issue.",
        },

        null,

        2,
      );

      setStatus("API requests blocked/failed", "var(--red)");
    }

    $("refreshBtn").disabled = false;

    return;
  }

  const update = calculateUpdate({
    gift,

    futures,

    market,

    time: new Date(),
  });

  let day = loadCachedDay(date) || {
    date,

    timezone: CONFIG.timezone,

    market: "NIFTY 50",

    monitoring_window: {
      start: "08:30:00",

      end: "09:30:00",
    },

    updates: [],
  };

  if (live) {
    day.updates.push(update);

    // Keep browser storage bounded.

    day.updates = day.updates.slice(-500);
  }

  day.last_updated_system_time_ist = update.system_time_ist;

  day.last_signal = update.decision.signal;

  currentData = day;

  saveCachedDay(day);

  renderSummary(update);

  renderTimeline(day);

  $("dayJson").textContent = JSON.stringify(day, null, 2);

  $("lastUpdated").textContent = `Client update: ${update.system_time_ist}`;

  const successful = results.filter((r) => r.status === "fulfilled").length;

  if (successful === results.length) {
    setStatus("Live — direct API mode", "var(--green)");
  } else {
    setStatus(`Live — ${successful}/3 APIs connected`, "var(--yellow)");
  }

  $("refreshBtn").disabled = false;
}

function schedulePolling() {
  clearTimeout(pollTimer);

  const current = now();

  const hourIST = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: CONFIG.timezone,

      hour: "2-digit",

      hour12: false,
    }).format(current),
  );

  const interval =
    hourIST >= 9 && hourIST < 16
      ? CONFIG.pollDuringMarketMs
      : CONFIG.pollBeforeOpenMs;

  pollTimer = setTimeout(async () => {
    if (selectedDate === istDate()) {
      await loadDate(selectedDate, { live: true });
    }

    schedulePolling();
  }, interval);
}

$("dateSelect").addEventListener("change", (event) => {
  loadDate(event.target.value, { live: false }).catch(console.error);
});

$("refreshBtn").addEventListener("click", async () => {
  populateDates();

  await loadDate($("dateSelect").value, { live: true });

  schedulePolling();
});

$("calculateTradeBtn").addEventListener("click", () => {
  calculateTrade().catch((error) => {
    console.error(error);
    $("tradeStatus").textContent = "Error";
    $("tradeResult").innerHTML =
      `<div class="negative">${escapeHtml(error.message || "Trade calculation failed")}</div>`;
  });
});

$("copyJsonBtn").addEventListener("click", async () => {
  if (!currentData) return;

  try {
    await navigator.clipboard.writeText(JSON.stringify(currentData, null, 2));

    $("copyJsonBtn").textContent = "Copied";

    setTimeout(() => ($("copyJsonBtn").textContent = "Copy JSON"), 1200);
  } catch (error) {
    console.error(error);
  }
});

async function init() {
  populateDates();

  await loadDate($("dateSelect").value, { live: true });

  schedulePolling();
}

init().catch((error) => {
  console.error(error);

  setStatus(`Startup failed: ${error.message}`, "var(--red)");
});
