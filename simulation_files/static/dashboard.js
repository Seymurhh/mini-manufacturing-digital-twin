const state = {
  running: true,
  timer: null,
  intervalMs: 900,
};

const els = {
  toggleButton: document.getElementById("toggleButton"),
  stepButton: document.getElementById("stepButton"),
  resetButton: document.getElementById("resetButton"),
  machineId: document.getElementById("machineId"),
  partId: document.getElementById("partId"),
  phase: document.getElementById("phase"),
  healthScore: document.getElementById("healthScore"),
  severity: document.getElementById("severity"),
  samples: document.getElementById("samples"),
  confidence: document.getElementById("confidence"),
  decision: document.getElementById("decision"),
  action: document.getElementById("action"),
  requiredCheck: document.getElementById("requiredCheck"),
  rationale: document.getElementById("rationale"),
  anomalyCount: document.getElementById("anomalyCount"),
  evidenceList: document.getElementById("evidenceList"),
  topic: document.getElementById("topic"),
  rpm: document.getElementById("rpm"),
  feed: document.getElementById("feed"),
  load: document.getElementById("load"),
  temp: document.getElementById("temp"),
  vibration: document.getElementById("vibration"),
  wear: document.getElementById("wear"),
  loadChart: document.getElementById("loadChart"),
  temperatureChart: document.getElementById("temperatureChart"),
  vibrationChart: document.getElementById("vibrationChart"),
  recommendationPanel: document.querySelector(".recommendation-panel"),
};

function fmt(value, suffix = "", digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "missing";
  }
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function tick(count = 1) {
  const payload = await fetchJson(`/api/next?count=${count}`);
  render(payload);
}

async function reset() {
  const payload = await fetchJson("/api/reset");
  render(payload);
}

function startLoop() {
  stopLoop();
  state.timer = window.setInterval(() => {
    if (state.running) {
      tick().catch(console.error);
    }
  }, state.intervalMs);
}

function stopLoop() {
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
}

function render(payload) {
  const latest = payload.latest;
  const summary = payload.summary;
  const rows = payload.history || [];

  els.samples.textContent = summary.samples;
  els.healthScore.textContent = summary.health_score;
  els.phase.textContent = titleCase(summary.phase);
  els.severity.textContent = titleCase(summary.active_severity);
  els.severity.className = summary.active_severity || "normal";

  if (!latest) {
    drawEmptyCharts();
    return;
  }

  const event = latest.event;
  const detection = latest.detection;
  const recommendation = latest.recommendation;

  els.machineId.textContent = event.machine_id;
  els.partId.textContent = event.part_id;
  els.topic.textContent = event.topic;
  els.rpm.textContent = fmt(event.spindle_speed_rpm, "", 0);
  els.feed.textContent = fmt(event.feed_rate_mm_min, " mm/min", 0);
  els.load.textContent = fmt(event.spindle_load_pct, "%", 1);
  els.temp.textContent = fmt(event.temperature_c, " C", 1);
  els.vibration.textContent = fmt(event.vibration_rms, "", 3);
  els.wear.textContent = fmt(event.tool_wear_pct, "%", 1);

  els.confidence.textContent = `confidence ${Number(recommendation.confidence).toFixed(2)}`;
  els.decision.textContent = titleCase(recommendation.decision);
  els.action.textContent = recommendation.action;
  els.requiredCheck.textContent = recommendation.required_check;
  els.rationale.textContent = recommendation.rationale;

  const severityClass = detection.severity === "critical" ? "critical" :
    detection.severity === "warning" ? "warning" :
    detection.severity === "watch" ? "watch" : "normal";
  els.decision.className = `decision ${severityClass}`;
  els.recommendationPanel.className = `panel recommendation-panel ${severityClass}`;

  const codes = detection.anomaly_codes || [];
  els.anomalyCount.textContent = `${codes.length} active`;
  els.evidenceList.innerHTML = "";
  for (const item of detection.evidence || []) {
    const li = document.createElement("li");
    li.textContent = item;
    els.evidenceList.appendChild(li);
  }

  drawLineChart(els.loadChart, rows, {
    yMin: 0,
    yMax: 100,
    label: "spindle load %",
    series: [
      { color: "#2f6fbb", width: 2.5, getter: (r) => r.event.spindle_load_pct },
      { color: "#9aa8b2", width: 1.5, getter: (r) => r.event.expected_load_pct },
    ],
    anomalyGetter: (r) => r.detection.anomaly_detected,
  });

  drawLineChart(els.temperatureChart, rows, {
    yMin: 20,
    yMax: 62,
    label: "temperature C",
    series: [
      { color: "#b36b00", width: 2.5, getter: (r) => r.event.temperature_c },
      { color: "#9aa8b2", width: 1.5, getter: (r) => r.event.expected_temperature_c },
    ],
    anomalyGetter: (r) => r.detection.anomaly_detected,
  });

  drawLineChart(els.vibrationChart, rows, {
    yMin: 0,
    yMax: 1.8,
    label: "vibration RMS",
    series: [
      { color: "#087f77", width: 2.5, getter: (r) => r.event.vibration_rms },
    ],
    anomalyGetter: (r) => r.detection.anomaly_detected,
  });
}

function drawEmptyCharts() {
  for (const canvas of [els.loadChart, els.temperatureChart, els.vibrationChart]) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawLineChart(canvas, rows, config) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 52, right: 18, top: 18, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#d8e0e4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
  }
  ctx.stroke();

  ctx.fillStyle = "#65727f";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(config.label, pad.left, 15);

  ctx.font = "12px system-ui, sans-serif";
  for (let i = 0; i <= 4; i += 1) {
    const value = config.yMax - ((config.yMax - config.yMin) * i) / 4;
    const y = pad.top + (plotH * i) / 4;
    ctx.fillText(value.toFixed(config.yMax <= 2 ? 1 : 0), 8, y + 4);
  }

  if (!rows.length) {
    return;
  }

  const xFor = (index) => pad.left + (plotW * index) / Math.max(1, rows.length - 1);
  const yFor = (value) => {
    const clamped = Math.max(config.yMin, Math.min(config.yMax, Number(value)));
    return pad.top + plotH - ((clamped - config.yMin) / (config.yMax - config.yMin)) * plotH;
  };

  rows.forEach((row, index) => {
    if (!config.anomalyGetter(row)) {
      return;
    }
    const x = xFor(index);
    ctx.fillStyle = "rgba(180, 35, 24, 0.08)";
    ctx.fillRect(x - 3, pad.top, 6, plotH);
  });

  for (const series of config.series) {
    ctx.strokeStyle = series.color;
    ctx.lineWidth = series.width;
    ctx.beginPath();
    let started = false;
    rows.forEach((row, index) => {
      const value = series.getter(row);
      if (value === null || value === undefined || Number.isNaN(Number(value))) {
        started = false;
        return;
      }
      const x = xFor(index);
      const y = yFor(value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  ctx.strokeStyle = "#17202a";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);
}

els.toggleButton.addEventListener("click", () => {
  state.running = !state.running;
  els.toggleButton.textContent = state.running ? "Pause" : "Resume";
});

els.stepButton.addEventListener("click", () => {
  tick(3).catch(console.error);
});

els.resetButton.addEventListener("click", () => {
  reset().catch(console.error);
});

tick(4).catch(console.error);
startLoop();
