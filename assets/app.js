const INDEX_URL = "data/index.json";

let manifest = null;
let currentData = null;

const $ = (id) => document.getElementById(id);

async function fetchJson(url) {
  const response = await fetch(`${url}?v=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toFixed(digits);
  return value;
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

function latestUpdate(data) {
  return data?.updates?.length
    ? data.updates[data.updates.length - 1]
    : null;
}

function renderSummary(update) {
  const container = $("summary");

  if (!update) {
    container.innerHTML = `<div class="card"><div class="value">No data</div></div>`;
    return;
  }

  const cue = update.cue?.value;
  const gap = update.gap?.value;
  const signal = update.decision?.signal;
  const fut = update.nifty_futures?.last_close;
  const gift = update.gift_nifty?.last_price;
  const open = update.market?.today_open;

  container.innerHTML = `
    <div class="card">
      <div class="label">GIFT Nifty</div>
      <div class="value">${fmt(gift)}</div>
      <div class="sub">${update.gift_nifty?.api_time_ist || "—"}</div>
    </div>

    <div class="card">
      <div class="label">NIFTY Future</div>
      <div class="value">${fmt(fut)}</div>
      <div class="sub">${update.nifty_futures?.symbol || "—"}</div>
    </div>

    <div class="card">
      <div class="label">Cue</div>
      <div class="value">${fmt(cue)}</div>
      <div class="sub">GIFT − FUT</div>
    </div>

    <div class="card">
      <div class="label">NIFTY Open</div>
      <div class="value">${fmt(open)}</div>
      <div class="sub">${update.market?.today_open_api_time_ist || "Waiting"}</div>
    </div>

    <div class="card">
      <div class="label">Gap</div>
      <div class="value ${gapClass(update.gap?.status)}">${fmt(gap)}</div>
      <div class="sub">${update.gap?.status || "—"}</div>
    </div>

    <div class="card">
      <div class="label">Signal</div>
      <div class="value ${signalClass(signal)}">${signal || "—"}</div>
      <div class="sub">${update.system_time_ist || "—"}</div>
    </div>
  `;
}

function renderTimeline(data) {
  const tbody = $("timelineTable").querySelector("tbody");
  tbody.innerHTML = "";

  const updates = data?.updates || [];
  $("recordCount").textContent = `${updates.length} records`;

  updates.forEach((u, index) => {
    const tr = document.createElement("tr");

    const cue = u.cue?.value;
    const gap = u.gap?.value;
    const signal = u.decision?.signal;

    tr.innerHTML = `
      <td>${u.system_time_ist || "—"}</td>
      <td>${fmt(u.gift_nifty?.last_price)}</td>
      <td>${fmt(u.nifty_futures?.last_close)}</td>
      <td class="${cue >= 50 ? "positive" : cue !== null && cue !== undefined ? "negative" : ""}">
        ${fmt(cue)}
      </td>
      <td>${fmt(u.market?.today_open)}</td>
      <td>${fmt(u.market?.previous_day_close)}</td>
      <td class="${gapClass(u.gap?.status)}">${fmt(gap)}</td>
      <td class="${gapClass(u.gap?.status)}">${u.gap?.status || "—"}</td>
      <td class="${signalClass(signal)}">${signal || "—"}</td>
    `;

    tr.addEventListener("click", () => {
      $("rawJson").textContent = JSON.stringify(u, null, 2);
    });

    tbody.appendChild(tr);
  });

  if (updates.length) {
    $("rawJson").textContent = JSON.stringify(
      updates[updates.length - 1],
      null,
      2
    );
  }
}

async function loadDate(date) {
  $("statusText").textContent = `Loading ${date}...`;
  $("statusDot").style.background = "var(--yellow)";

  try {
    const data = await fetchJson(`data/${date}.json`);
    currentData = data;

    const latest = latestUpdate(data);

    renderSummary(latest);
    renderTimeline(data);
    $("dayJson").textContent = JSON.stringify(data, null, 2);

    $("lastUpdated").textContent =
      `Last JSON update: ${data.last_updated_system_time_ist || "—"}`;

    $("statusText").textContent = "Data loaded";
    $("statusDot").style.background = "var(--green)";
  } catch (error) {
    console.error(error);
    $("statusText").textContent = `Failed to load ${date}`;
    $("statusDot").style.background = "var(--red)";
  }
}

async function loadManifest() {
  try {
    manifest = await fetchJson(INDEX_URL);

    const select = $("dateSelect");
    select.innerHTML = "";

    const dates = manifest.dates || [];

    dates.forEach((date) => {
      const option = document.createElement("option");
      option.value = date;
      option.textContent = date;
      select.appendChild(option);
    });

    if (!dates.length) {
      $("statusText").textContent = "No daily data available";
      $("statusDot").style.background = "var(--yellow)";
      return;
    }

    select.value = dates[0];
    await loadDate(dates[0]);

  } catch (error) {
    console.error(error);
    $("statusText").textContent = "Unable to load data/index.json";
    $("statusDot").style.background = "var(--red)";
  }
}

$("dateSelect").addEventListener("change", (event) => {
  loadDate(event.target.value);
});

$("refreshBtn").addEventListener("click", () => {
  loadManifest();
});

loadManifest();


$("copyJsonBtn").addEventListener("click", async () => {
  if (!currentData) return;

  try {
    await navigator.clipboard.writeText(
      JSON.stringify(currentData, null, 2)
    );
    $("copyJsonBtn").textContent = "Copied";
    setTimeout(() => {
      $("copyJsonBtn").textContent = "Copy JSON";
    }, 1200);
  } catch (error) {
    console.error(error);
  }
});
