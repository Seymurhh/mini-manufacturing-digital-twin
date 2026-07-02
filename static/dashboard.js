const state = {
  running: true,
  timer: null,
  intervalMs: 900,
  protocol: "mqtt",
  lesson: "twin",
  node: "machine",
  sensor: "load",
  source: "synthetic",
  collection: "controller",
  activeSection: "overview",
  machiningFrame: null,
  reducedMotion: window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false,
  lastPayload: null,
};

const CYCLE_LENGTH = 180;
const PHASE_START = {
  warmup: 0,
  roughing: 28,
  finishing: 100,
  inspection: 156,
};
const PHASE_LENGTH = {
  warmup: 28,
  roughing: 72,
  finishing: 56,
  inspection: 24,
};

const SECTION_CAPTIONS = {
  overview: "Stage 01: observe the live physical process and its digital state.",
  "data-path": "Stage 02: connect the machine, sensors, edge layer, protocol, model, and operator.",
  signals: "Stage 03: inspect the packet envelope and the sensor signals behind the twin.",
  "real-data": "Stage 04: switch from synthetic data to a realistic machine collection plan.",
  "case-study": "Stage 05: compare actual CNC behavior with the expected machining model.",
  decisions: "Stage 06: translate evidence into human-reviewable action.",
};

const NODE_DETAILS = {
  machine: {
    title: "CNC machine",
    description: "The physical milling process creates the real state: spindle load, tool engagement, heat, vibration, feed, and part quality risk.",
    latency: "Controller values can update in milliseconds; auxiliary sensors vary by sampling plan.",
    failure: "Program overrides, wrong workholding, or missing operation context can make raw data misleading.",
  },
  sensors: {
    title: "Sensor and controller signals",
    description: "The twin combines controller values with sensors so it can see both commanded behavior and measured process response.",
    latency: "Vibration can be high-frequency; supervisory dashboards often consume reduced features at 1-10 Hz.",
    failure: "Bad calibration, dropout, or unit mismatch can make the twin less trustworthy than the machine itself.",
  },
  edge: {
    title: "Edge gateway",
    description: "The edge layer timestamps, normalizes, buffers, and quality-checks data before it becomes a platform event.",
    latency: "Usually 5-500 ms depending on buffering, filtering, and network conditions.",
    failure: "Clock drift, stale packets, and dropped fields are common issues that must be surfaced.",
  },
  protocol: {
    title: "Protocol layer",
    description: "Protocols define how machine data is represented and transported. MQTT, OPC UA, and MTConnect solve different parts of the factory problem.",
    latency: "MQTT telemetry is often near-real-time; structured interoperability layers may add modeling overhead.",
    failure: "A valid packet can still be semantically wrong if topic, unit, phase, or asset identity is missing.",
  },
  model: {
    title: "Twin model",
    description: "The digital replica compares actual signals against expected process behavior for the active machining phase.",
    latency: "Simple rule and residual models can run per event; heavier simulation may run asynchronously.",
    failure: "A model trained on the wrong operation window will flag normal behavior or miss true process drift.",
  },
  operator: {
    title: "Human decision layer",
    description: "The platform translates evidence into reviewable action instead of hiding uncertainty behind full automation.",
    latency: "Immediate alarms are possible, but high-impact changes should include human review and traceable rationale.",
    failure: "Recommendations without evidence, confidence, or required checks are hard to trust on a factory floor.",
  },
};

const LESSONS = {
  twin: {
    title: "What is a digital twin?",
    step: "Step 1 of 3",
    node: "model",
    body: "A manufacturing digital twin is a live digital representation of a physical asset, updated by operational data and compared with an expected model.",
    points: [
      "It is more than a dashboard because it keeps state and process context.",
      "It is more than a CAD model because real telemetry continuously updates it.",
      "It supports monitoring, simulation, prediction, and human decision-making.",
    ],
  },
  flow: {
    title: "How does factory data flow?",
    step: "Step 2 of 3",
    node: "protocol",
    body: "Machine signals become useful only after they are captured, timestamped, normalized, transported, validated, and connected to the right operation phase.",
    points: [
      "Sensors and controller values measure the physical process.",
      "The edge layer adds timestamps, units, quality, and buffering.",
      "The twin service updates digital state and checks expected vs actual behavior.",
    ],
  },
  case: {
    title: "CNC machining case study",
    step: "Step 3 of 3",
    node: "machine",
    body: "This case models a bracket milling cycle where the twin watches roughing, finishing, thermal behavior, chatter risk, tool wear, feed mismatch, and telemetry health.",
    points: [
      "The physical process is one CNC milling center cutting one part family.",
      "The parallel digital replica tracks load, vibration, temperature, feed, and tool-wear evidence.",
      "Recommendations stay auditable and keep the operator in the loop.",
    ],
  },
};

const SENSORS = {
  load: {
    label: "Spindle load",
    field: "spindle_load_pct",
    suffix: "%",
    digits: 1,
    range: "Nominal roughing is often near 55-70% in this synthetic process window.",
    used: "Cutting-force proxy, overload detection, tool-wear evidence, and expected-vs-actual residuals.",
    failure: "Controller scaling, overload clipping, or missing phase context can hide the true cutting condition.",
  },
  vibration: {
    label: "Vibration RMS",
    field: "vibration_rms",
    suffix: "",
    digits: 3,
    range: "Roughing limit is 0.82 RMS; finishing limit is 0.58 RMS in this demo.",
    used: "Chatter risk, unstable engagement, fixturing problems, and tool-condition evidence.",
    failure: "Mounting location, sampling rate, and filtering strongly affect chatter visibility.",
  },
  temperature: {
    label: "Temperature",
    field: "temperature_c",
    suffix: " C",
    digits: 1,
    range: "Expected model is phase-dependent; drift above +7 C is treated as risk.",
    used: "Thermal drift, coolant issues, dimensional risk, and machine warmup behavior.",
    failure: "Sensor placement and thermal lag can delay or exaggerate process changes.",
  },
  rpm: {
    label: "Spindle speed",
    field: "spindle_speed_rpm",
    suffix: " rpm",
    digits: 0,
    range: "This cycle uses 2500-9200 rpm depending on operation phase.",
    used: "Verifies commanded cutting condition and catches wrong program or override state.",
    failure: "Controller-reported RPM may not expose transient load changes by itself.",
  },
  feed: {
    label: "Feed rate",
    field: "feed_rate_mm_min",
    suffix: " mm/min",
    digits: 0,
    range: "Validated windows: warmup 240-460, roughing 650-980, finishing 410-660, inspection 90-220.",
    used: "Detects feed override, program mismatch, and operation-window violations.",
    failure: "Feed value without phase context cannot prove whether a setting is safe.",
  },
  wear: {
    label: "Tool wear",
    field: "tool_wear_pct",
    suffix: "%",
    digits: 1,
    range: "This detector starts scheduling intervention around 32% estimated wear.",
    used: "Maintenance planning and explaining rising load or vibration over a part run.",
    failure: "Tool wear is often inferred, so it should be checked against inspection and part count.",
  },
};

const PROTOCOL_LABELS = {
  mqtt: "MQTT",
  opcua: "OPC UA",
  mtconnect: "MTConnect",
  rest: "REST/WebSocket",
};

const PROTOCOL_DETAILS = {
  mqtt: {
    role: "Telemetry streaming",
    name: "MQTT publish/subscribe",
    purpose: "MQTT moves lightweight machine events from an edge gateway to subscribers such as the digital twin, dashboard, and storage services.",
    function: "Publish each CNC event to a topic so multiple systems can consume the same telemetry stream.",
    twinUse: "The topic names the asset and the payload carries timestamped process signals, quality, model expectations, and detection state.",
  },
  opcua: {
    role: "Industrial data model",
    name: "OPC UA structured machine access",
    purpose: "OPC UA exposes machine data as a structured address space with tags, metadata, units, data types, and security controls.",
    function: "Let an edge gateway or twin connector browse, read, subscribe to, and contextualize controller and sensor values.",
    twinUse: "The twin can map OPC UA nodes such as spindle load, feed rate, temperature, and alarms into a consistent digital asset model.",
  },
  mtconnect: {
    role: "Machine-tool interoperability",
    name: "MTConnect manufacturing stream",
    purpose: "MTConnect standardizes CNC and machine-tool data so equipment from different vendors can report status, samples, events, and conditions in a common format.",
    function: "Provide normalized machine-tool observations such as execution state, path feedrate, spindle speed, load, tool, alarms, and conditions.",
    twinUse: "The twin uses MTConnect when the goal is to collect CNC-specific operational context without writing a custom parser for each controller.",
  },
  rest: {
    role: "Platform API and browser updates",
    name: "REST and WebSocket interfaces",
    purpose: "REST is useful for request/response platform APIs, while WebSockets are useful when a browser dashboard needs live updates.",
    function: "Move validated twin state, history, exports, configuration, and dashboard updates between services and user interfaces.",
    twinUse: "REST/WebSocket usually sit above the machine connector layer: the twin ingests industrial data, then exposes clean state to apps and users.",
  },
};

const DATA_SOURCES = {
  synthetic: {
    badge: "Simulation active",
    body: "The current demo uses deterministic synthetic CNC events so the full twin workflow is repeatable, explainable, and easy to validate.",
    points: [
      "Simulator creates warmup, roughing, finishing, and inspection phases.",
      "Known anomaly windows make chatter, tool wear, drift, feed mismatch, and dropout explainable.",
      "The same event schema can receive real machine data later.",
    ],
  },
  real: {
    badge: "Real connector path",
    body: "A production version would keep this UI and replace the simulator with a real machine connector running on an edge computer near the CNC cell.",
    points: [
      "Read controller tags through MTConnect, OPC UA, a vendor API, or a gateway already approved by the plant.",
      "Add external sensors only for physics the controller cannot measure directly, such as chatter, coolant health, thermal drift, or fixture vibration.",
      "Timestamp, unit-normalize, quality-check, buffer, and publish each event before the twin updates state.",
    ],
  },
};

const COLLECTION_STAGES = {
  controller: {
    stage: "Controller first",
    title: "Controller data first",
    body: "Start with the CNC controller because it already knows program, feed, speed, alarms, overrides, tool number, axis position, and spindle load.",
    signals: "Program, operation, feed, speed, load, tool, alarms, axis position.",
    interface: "MTConnect adapter, OPC UA server, controller API, or vendor gateway.",
    note: "Controller data is necessary, but it may not directly measure chatter, thermal drift, or fixturing problems.",
  },
  sensors: {
    stage: "Sensor augmentation",
    title: "Add sensors for missing physics",
    body: "Use external sensors when the controller stream cannot observe the physical behavior needed by the twin.",
    signals: "Tri-axial vibration, acoustic emission, spindle current, temperature, coolant flow, coolant pressure, part probe, camera inspection.",
    interface: "DAQ module, IO-Link master, analog input, accelerometer conditioner, or industrial sensor gateway.",
    note: "A strong minimum stack is controller data plus vibration near the spindle or fixture and temperature near the process or machine structure.",
  },
  edge: {
    stage: "Edge normalization",
    title: "Normalize at the cell edge",
    body: "An edge computer near the machine joins controller tags and sensor samples into one reliable event stream.",
    signals: "Timestamp, machine id, part id, operation phase, signal value, unit, quality, source, sequence.",
    interface: "Industrial PC, gateway appliance, local broker, store-and-forward buffer, time sync service.",
    note: "The edge layer should handle clock sync, missing values, buffering during network loss, and unit conversion before data reaches the twin.",
  },
  platform: {
    stage: "Twin ingestion",
    title: "Publish into the twin platform",
    body: "The platform subscribes to machine events, validates schema and quality, updates current state, stores history, and runs model comparison.",
    signals: "Clean event envelope, expected model fields, quality flags, anomaly evidence, recommendation state.",
    interface: "MQTT broker, OPC UA bridge, MTConnect agent, REST endpoint, WebSocket dashboard stream, time-series database.",
    note: "The platform should not trust raw values without machine identity, units, phase context, timestamp, and quality metadata.",
  },
  validation: {
    stage: "Model validation",
    title: "Validate against real outcomes",
    body: "Real data only becomes useful after the expected model and detector thresholds are checked against physical outcomes.",
    signals: "Inspection results, scrap/rework records, tool changes, surface finish, alarm history, operator notes.",
    interface: "MES/QMS export, inspection CSV, probe reports, maintenance log, manual labeling workflow.",
    note: "A real twin should begin in advisory mode until false alarms, missed faults, and operator trust are measured.",
  },
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
  activeProtocol: document.getElementById("activeProtocol"),
  pathCaption: document.getElementById("pathCaption"),
  twinState: document.getElementById("twinState"),
  physicalState: document.getElementById("physicalState"),
  digitalState: document.getElementById("digitalState"),
  modelGap: document.getElementById("modelGap"),
  machineLoadBar: document.getElementById("machineLoadBar"),
  machineTempBar: document.getElementById("machineTempBar"),
  machineVibrationBar: document.getElementById("machineVibrationBar"),
  nodeTitle: document.getElementById("nodeTitle"),
  nodeDescription: document.getElementById("nodeDescription"),
  nodeLatency: document.getElementById("nodeLatency"),
  nodeFailure: document.getElementById("nodeFailure"),
  lessonTitle: document.getElementById("lessonTitle"),
  lessonStep: document.getElementById("lessonStep"),
  lessonBody: document.getElementById("lessonBody"),
  lessonPoints: document.getElementById("lessonPoints"),
  protocolRoleLabel: document.getElementById("protocolRoleLabel"),
  protocolName: document.getElementById("protocolName"),
  protocolPurpose: document.getElementById("protocolPurpose"),
  protocolFunction: document.getElementById("protocolFunction"),
  protocolTwinUse: document.getElementById("protocolTwinUse"),
  packetQuality: document.getElementById("packetQuality"),
  packetPayload: document.getElementById("packetPayload"),
  sensorButtons: document.getElementById("sensorButtons"),
  sensorValue: document.getElementById("sensorValue"),
  sensorRange: document.getElementById("sensorRange"),
  sensorUse: document.getElementById("sensorUse"),
  sensorFailure: document.getElementById("sensorFailure"),
  sourceBadge: document.getElementById("sourceBadge"),
  sourceBody: document.getElementById("sourceBody"),
  sourcePoints: document.getElementById("sourcePoints"),
  collectionStage: document.getElementById("collectionStage"),
  collectionTitleDetail: document.getElementById("collectionTitleDetail"),
  collectionBody: document.getElementById("collectionBody"),
  collectionSignals: document.getElementById("collectionSignals"),
  collectionInterface: document.getElementById("collectionInterface"),
  collectionNote: document.getElementById("collectionNote"),
  phaseTimeline: document.getElementById("phaseTimeline"),
  anomalyTags: document.getElementById("anomalyTags"),
  cyclePosition: document.getElementById("cyclePosition"),
  machiningCanvas: document.getElementById("machiningCanvas"),
  cutPhaseLabel: document.getElementById("cutPhaseLabel"),
  cutProgress: document.getElementById("cutProgress"),
  toolPosition: document.getElementById("toolPosition"),
  materialRemoval: document.getElementById("materialRemoval"),
  chipLoadState: document.getElementById("chipLoadState"),
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function severityClass(severity) {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  if (severity === "watch") return "watch";
  return "normal";
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

function setActiveButtons(selector, attribute, value) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle("active", button.dataset[attribute] === value);
  });
}

function activateLearningPath(sectionId, options = {}) {
  const target = document.getElementById(sectionId);
  if (!target) return;

  state.activeSection = sectionId;
  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.scrollTarget === sectionId);
  });
  els.pathCaption.textContent = SECTION_CAPTIONS[sectionId] || SECTION_CAPTIONS.overview;

  if (options.scroll) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (options.pulse) {
    target.classList.remove("section-focus");
    window.requestAnimationFrame(() => {
      target.classList.add("section-focus");
      window.setTimeout(() => target.classList.remove("section-focus"), 900);
    });
  }
}

function setupLearningPath() {
  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => {
      activateLearningPath(button.dataset.scrollTarget, { scroll: true, pulse: true });
    });
  });

  const sectionEls = Array.from(document.querySelectorAll(".section-anchor[data-section]"));
  if (!("IntersectionObserver" in window) || !sectionEls.length) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible?.target?.dataset?.section) {
      activateLearningPath(visible.target.dataset.section);
    }
  }, {
    rootMargin: "-28% 0px -58% 0px",
    threshold: [0.1, 0.3, 0.55],
  });

  sectionEls.forEach((section) => observer.observe(section));
}

function renderNode() {
  const detail = NODE_DETAILS[state.node] || NODE_DETAILS.machine;
  els.nodeTitle.textContent = detail.title;
  els.nodeDescription.textContent = detail.description;
  els.nodeLatency.textContent = detail.latency;
  els.nodeFailure.textContent = detail.failure;
  setActiveButtons("[data-node]", "node", state.node);
}

function renderLesson() {
  const lesson = LESSONS[state.lesson] || LESSONS.twin;
  els.lessonTitle.textContent = lesson.title;
  els.lessonStep.textContent = lesson.step;
  els.lessonBody.textContent = lesson.body;
  els.lessonPoints.innerHTML = "";
  lesson.points.forEach((point) => {
    const li = document.createElement("li");
    li.textContent = point;
    els.lessonPoints.appendChild(li);
  });
  setActiveButtons("[data-lesson]", "lesson", state.lesson);
}

function setupSensorButtons() {
  els.sensorButtons.innerHTML = "";
  Object.entries(SENSORS).forEach(([key, sensor]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sensor = key;
    button.textContent = sensor.label;
    button.addEventListener("click", () => {
      state.sensor = key;
      renderSensor(state.lastPayload?.latest?.event || null);
      activateLearningPath("signals", { pulse: true });
    });
    els.sensorButtons.appendChild(button);
  });
}

function renderSensor(event) {
  const sensor = SENSORS[state.sensor] || SENSORS.load;
  const value = event ? event[sensor.field] : null;
  els.sensorValue.textContent = value === null || value === undefined
    ? "No value"
    : fmt(value, sensor.suffix, sensor.digits);
  els.sensorRange.textContent = sensor.range;
  els.sensorUse.textContent = sensor.used;
  els.sensorFailure.textContent = sensor.failure;
  setActiveButtons("[data-sensor]", "sensor", state.sensor);
}

function renderDataSource() {
  const source = DATA_SOURCES[state.source] || DATA_SOURCES.synthetic;
  els.sourceBadge.textContent = source.badge;
  els.sourceBody.textContent = source.body;
  els.sourcePoints.innerHTML = "";
  source.points.forEach((point) => {
    const li = document.createElement("li");
    li.textContent = point;
    els.sourcePoints.appendChild(li);
  });
  setActiveButtons("[data-source]", "source", state.source);
}

function renderCollectionStage() {
  const stage = COLLECTION_STAGES[state.collection] || COLLECTION_STAGES.controller;
  els.collectionStage.textContent = stage.stage;
  els.collectionTitleDetail.textContent = stage.title;
  els.collectionBody.textContent = stage.body;
  els.collectionSignals.textContent = stage.signals;
  els.collectionInterface.textContent = stage.interface;
  els.collectionNote.textContent = stage.note;
  setActiveButtons("[data-collection]", "collection", state.collection);
}

function signalQuality(event) {
  if (!event) return "quality pending";
  if (event.spindle_load_pct === null || event.temperature_c === null || event.vibration_rms === null) {
    return "quality degraded - sensor dropout";
  }
  return "quality valid";
}

function compactSignalValue(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(Number(value).toFixed(digits));
}

function signalEnvelope(event) {
  return {
    spindle_speed_rpm: { value: compactSignalValue(event.spindle_speed_rpm, 0), unit: "rpm", source: "controller", quality: "good" },
    feed_rate: { value: compactSignalValue(event.feed_rate_mm_min, 0), unit: "mm/min", source: "controller", quality: "good" },
    spindle_load: { value: compactSignalValue(event.spindle_load_pct, 1), unit: "%", source: "controller", quality: event.spindle_load_pct === null ? "missing" : "good" },
    vibration_rms: { value: compactSignalValue(event.vibration_rms, 3), unit: "g RMS", source: "accelerometer", quality: event.vibration_rms === null ? "missing" : "good" },
    temperature: { value: compactSignalValue(event.temperature_c, 1), unit: "C", source: "thermal sensor", quality: event.temperature_c === null ? "missing" : "good" },
    tool_wear: { value: compactSignalValue(event.tool_wear_pct, 1), unit: "%", source: "inferred feature", quality: "estimated" },
  };
}

function buildProtocolPacket(event, detection) {
  if (!event) return "Waiting for telemetry packet...";

  const signals = signalEnvelope(event);
  const common = {
    timestamp: event.timestamp,
    sequence: event.sequence,
    machine_id: event.machine_id,
    part_id: event.part_id,
    operation: event.operation,
    phase: event.process_phase,
  };

  if (state.protocol === "opcua") {
    return JSON.stringify({
      server: "opc.tcp://edge-gateway.local:4840",
      namespace: "factory.digitalTwin.cnc",
      nodes: [
        { nodeId: `ns=2;s=${event.machine_id}.Spindle.Load`, browseName: "SpindleLoad", ...signals.spindle_load },
        { nodeId: `ns=2;s=${event.machine_id}.Axis.FeedRate`, browseName: "FeedRate", ...signals.feed_rate },
        { nodeId: `ns=2;s=${event.machine_id}.Condition.VibrationRms`, browseName: "VibrationRms", ...signals.vibration_rms },
        { nodeId: `ns=2;s=${event.machine_id}.Thermal.Temperature`, browseName: "Temperature", ...signals.temperature },
      ],
      context: common,
      detection: {
        severity: detection.severity,
        anomaly_codes: detection.anomaly_codes,
      },
    }, null, 2);
  }

  if (state.protocol === "mtconnect") {
    return JSON.stringify({
      stream: "MTConnectStreams",
      deviceStream: event.machine_id,
      componentStreams: [
        {
          component: "Controller",
          samples: {
            path_feedrate: signals.feed_rate,
            spindle_speed: signals.spindle_speed_rpm,
          },
        },
        {
          component: "Condition",
          samples: {
            load: signals.spindle_load,
            vibration: signals.vibration_rms,
            temperature: signals.temperature,
          },
        },
      ],
      asset: event.part_id,
      sequence: event.sequence,
      condition: detection.severity,
    }, null, 2);
  }

  if (state.protocol === "rest") {
    return JSON.stringify({
      method: "POST",
      path: `/api/twins/${event.machine_id}/events`,
      websocket_update: `/ws/twins/${event.machine_id}/state`,
      body: {
        ...common,
        signals,
        expected_model: {
          expected_load_pct: event.expected_load_pct,
          expected_temperature_c: event.expected_temperature_c,
        },
        detection,
      },
    }, null, 2);
  }

  return JSON.stringify({
    protocol: "MQTT",
    topic: event.topic,
    qos: 1,
    retain: false,
    payload: {
      ...common,
      signals,
      expected_model: {
        expected_load_pct: event.expected_load_pct,
        expected_temperature_c: event.expected_temperature_c,
      },
      quality: signalQuality(event),
      detection: {
        severity: detection.severity,
        health_score: detection.health_score,
        anomaly_codes: detection.anomaly_codes,
      },
    },
  }, null, 2);
}

function renderFlowSeverity(detection) {
  const severity = severityClass(detection?.severity);
  document.querySelectorAll("[data-node]").forEach((button) => {
    button.classList.remove("watch", "warning", "critical");
    if (severity === "normal") return;
    if (["machine", "sensors", "model", "operator"].includes(button.dataset.node)) {
      button.classList.add(severity);
    }
  });
}

function renderPhase(phase) {
  document.querySelectorAll("#phaseTimeline [data-phase]").forEach((item) => {
    item.classList.toggle("active", item.dataset.phase === phase);
  });
  els.cyclePosition.textContent = phase
    ? `${titleCase(phase)} phase in the bracket milling cycle`
    : "Warmup -> Roughing -> Finishing -> Inspection";
}

function renderAnomalyTags(detection) {
  const codes = detection?.anomaly_codes || [];
  els.anomalyTags.innerHTML = "";
  if (!codes.length) {
    const tag = document.createElement("span");
    tag.textContent = "Nominal process";
    els.anomalyTags.appendChild(tag);
    return;
  }
  codes.forEach((code) => {
    const tag = document.createElement("span");
    tag.textContent = titleCase(code);
    tag.className = severityClass(detection.severity);
    els.anomalyTags.appendChild(tag);
  });
}

function renderPlatformState(event, detection) {
  if (!event) {
    els.twinState.textContent = "Waiting for machine telemetry";
    els.physicalState.textContent = "Physical process stream has not started.";
    els.digitalState.textContent = "Twin state will update every telemetry packet.";
    els.modelGap.textContent = "No sample yet.";
    els.machineLoadBar.value = 0;
    els.machineTempBar.value = 20;
    els.machineVibrationBar.value = 0;
    renderPhase(null);
    renderAnomalyTags(null);
    return;
  }

  const loadGap = event.spindle_load_pct === null
    ? null
    : Number(event.spindle_load_pct) - Number(event.expected_load_pct);
  const tempGap = event.temperature_c === null
    ? null
    : Number(event.temperature_c) - Number(event.expected_temperature_c);

  els.twinState.textContent = `${titleCase(detection.severity)} twin state for ${event.machine_id}`;
  els.physicalState.textContent = `${titleCase(event.process_phase)} pass on ${event.part_id}: spindle ${fmt(event.spindle_speed_rpm, " rpm", 0)}, feed ${fmt(event.feed_rate_mm_min, " mm/min", 0)}.`;
  els.digitalState.textContent = detection.anomaly_detected
    ? `Replica is flagging ${detection.anomaly_codes.map(titleCase).join(", ")} with health ${detection.health_score}.`
    : `Replica matches the expected model with health ${detection.health_score}.`;
  els.modelGap.textContent = loadGap === null || tempGap === null
    ? "Model comparison blocked by missing load or temperature."
    : `Load ${loadGap >= 0 ? "+" : ""}${loadGap.toFixed(1)} points, thermal ${tempGap >= 0 ? "+" : ""}${tempGap.toFixed(1)} C.`;

  els.machineLoadBar.value = event.spindle_load_pct ?? 0;
  els.machineTempBar.value = event.temperature_c ?? 20;
  els.machineVibrationBar.value = event.vibration_rms ?? 0;
  renderPhase(event.process_phase);
  renderAnomalyTags(detection);
}

function cyclePosition(event) {
  if (!event) return 0;
  return ((Number(event.sequence) % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
}

function cycleProgress(event) {
  return event ? cyclePosition(event) / CYCLE_LENGTH : 0;
}

function phaseProgress(event) {
  if (!event) return 0;
  const phase = event.process_phase;
  const start = PHASE_START[phase] ?? 0;
  const length = PHASE_LENGTH[phase] ?? CYCLE_LENGTH;
  return clamp((cyclePosition(event) - start) / length, 0, 1);
}

function machiningProgress(event, phaseName) {
  if (!event) return 0;
  const position = cyclePosition(event);
  if (phaseName === "roughing") {
    return clamp((position - PHASE_START.roughing) / PHASE_LENGTH.roughing, 0, 1);
  }
  if (phaseName === "finishing") {
    return clamp((position - PHASE_START.finishing) / PHASE_LENGTH.finishing, 0, 1);
  }
  if (phaseName === "inspection") {
    return clamp((position - PHASE_START.inspection) / PHASE_LENGTH.inspection, 0, 1);
  }
  return cycleProgress(event);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function toolPathPoint(event, now) {
  if (!event) {
    return { nx: 0.18, ny: 0.24, cutting: false };
  }

  const phase = event.process_phase;
  const p = phaseProgress(event);
  const timeShift = state.reducedMotion ? 0 : Math.sin(now / 520) * 0.012;

  if (phase === "warmup") {
    return { nx: 0.12 + p * 0.12, ny: 0.16 + timeShift, cutting: false };
  }

  if (phase === "roughing") {
    const passes = 7;
    const scaled = p * passes;
    const line = Math.min(passes - 1, Math.floor(scaled));
    const local = scaled - line;
    const direction = line % 2 === 0 ? local : 1 - local;
    return {
      nx: 0.18 + direction * 0.64,
      ny: 0.27 + line * 0.075 + timeShift,
      cutting: true,
    };
  }

  if (phase === "finishing") {
    const perimeter = p * 4;
    if (perimeter < 1) return { nx: 0.18 + perimeter * 0.64, ny: 0.22, cutting: true };
    if (perimeter < 2) return { nx: 0.82, ny: 0.22 + (perimeter - 1) * 0.52, cutting: true };
    if (perimeter < 3) return { nx: 0.82 - (perimeter - 2) * 0.64, ny: 0.74, cutting: true };
    return { nx: 0.18, ny: 0.74 - (perimeter - 3) * 0.52, cutting: true };
  }

  return {
    nx: 0.5 + Math.cos((state.reducedMotion ? 0 : now) / 800) * 0.18,
    ny: 0.48 + Math.sin((state.reducedMotion ? 0 : now) / 920) * 0.14,
    cutting: false,
  };
}

function drawToolPath(ctx, work) {
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = "rgba(47, 111, 187, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let line = 0; line < 7; line += 1) {
    const y = work.y + work.h * (0.27 + line * 0.075);
    const x1 = work.x + work.w * 0.18;
    const x2 = work.x + work.w * 0.82;
    if (line % 2 === 0) {
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
    } else {
      ctx.moveTo(x2, y);
      ctx.lineTo(x1, y);
    }
  }
  ctx.stroke();

  ctx.setLineDash([16, 10]);
  ctx.strokeStyle = "rgba(8, 127, 119, 0.68)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(work.x + work.w * 0.18, work.y + work.h * 0.22, work.w * 0.64, work.h * 0.52);
  ctx.restore();
}

function drawRemovedMaterial(ctx, work, event) {
  const rough = machiningProgress(event, "roughing");
  const finish = machiningProgress(event, "finishing");
  const pocketX = work.x + work.w * 0.22;
  const pocketY = work.y + work.h * 0.28;
  const pocketW = work.w * 0.56 * rough;
  const pocketH = work.h * 0.38;

  if (rough > 0) {
    const pocketGradient = ctx.createLinearGradient(pocketX, pocketY, pocketX, pocketY + pocketH);
    pocketGradient.addColorStop(0, "#4f6a75");
    pocketGradient.addColorStop(1, "#263f4a");
    roundedRect(ctx, pocketX, pocketY, pocketW, pocketH, 10);
    ctx.fillStyle = pocketGradient;
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i += 1) {
      const x = pocketX + (pocketW * i) / 8;
      ctx.beginPath();
      ctx.moveTo(x, pocketY + 6);
      ctx.lineTo(x, pocketY + pocketH - 6);
      ctx.stroke();
    }
  }

  if (finish > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(126, 246, 255, 0.72)";
    ctx.lineWidth = 4;
    roundedRect(ctx, work.x + work.w * 0.1, work.y + work.h * 0.12, work.w * 0.8, work.h * 0.72, 20);
    ctx.stroke();
    ctx.restore();
  }

  const holes = [
    [0.24, 0.24],
    [0.76, 0.24],
    [0.24, 0.76],
    [0.76, 0.76],
  ];
  holes.forEach(([hx, hy], index) => {
    const reveal = clamp(finish * 5 - index, 0, 1);
    ctx.beginPath();
    ctx.arc(work.x + work.w * hx, work.y + work.h * hy, lerp(6, 18, reveal), 0, Math.PI * 2);
    ctx.fillStyle = reveal > 0.01 ? "#1c2a33" : "rgba(47, 111, 187, 0.2)";
    ctx.fill();
    ctx.strokeStyle = reveal > 0.01 ? "rgba(126, 246, 255, 0.45)" : "rgba(47, 111, 187, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawMachiningScene(event, detection, timestamp) {
  const canvas = els.machiningCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const now = state.reducedMotion ? 0 : timestamp;
  const severity = severityClass(detection?.severity);
  const codes = detection?.anomaly_codes || [];
  const work = { x: 158, y: 82, w: 580, h: 218 };

  ctx.clearRect(0, 0, width, height);
  const bedGradient = ctx.createLinearGradient(0, 0, 0, height);
  bedGradient.addColorStop(0, "#101922");
  bedGradient.addColorStop(1, "#172635");
  ctx.fillStyle = bedGradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  roundedRect(ctx, 84, 44, 710, 286, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(184, 198, 207, 0.25)";
  ctx.stroke();

  const partGradient = ctx.createLinearGradient(work.x, work.y, work.x, work.y + work.h);
  partGradient.addColorStop(0, "#d5dde0");
  partGradient.addColorStop(0.52, "#aebbc0");
  partGradient.addColorStop(1, "#899aa2");
  roundedRect(ctx, work.x, work.y, work.w, work.h, 22);
  ctx.fillStyle = partGradient;
  ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 12;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#eef4f5";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawRemovedMaterial(ctx, work, event);
  drawToolPath(ctx, work);

  const path = toolPathPoint(event, now);
  let cutterX = work.x + work.w * path.nx;
  let cutterY = work.y + work.h * path.ny;
  if (codes.includes("chatter_risk")) {
    cutterX += Math.sin(now / 38) * 4;
    cutterY += Math.cos(now / 42) * 4;
  }

  if (codes.includes("thermal_drift")) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    const heatGradient = ctx.createRadialGradient(cutterX, cutterY, 12, cutterX, cutterY, 135);
    heatGradient.addColorStop(0, "#ff9c3a");
    heatGradient.addColorStop(1, "transparent");
    ctx.fillStyle = heatGradient;
    ctx.fillRect(work.x - 40, work.y - 40, work.w + 80, work.h + 80);
    ctx.restore();
  }

  if (path.cutting && !codes.includes("sensor_dropout")) {
    const chipCount = severity === "critical" ? 22 : severity === "warning" ? 16 : 10;
    for (let i = 0; i < chipCount; i += 1) {
      const angle = (i / chipCount) * Math.PI * 2 + now / 260;
      const radius = 16 + ((i * 11) % 34);
      const x = cutterX + Math.cos(angle) * radius;
      const y = cutterY + Math.sin(angle) * radius * 0.55;
      ctx.fillStyle = i % 3 === 0 ? "#ffcc66" : "#7ef6ff";
      ctx.globalAlpha = 0.72;
      ctx.fillRect(x, y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  const rpm = event?.spindle_speed_rpm || 4500;
  const rotation = state.reducedMotion ? 0 : (now / 1000) * (rpm / 600);
  ctx.save();
  ctx.translate(cutterX, cutterY);
  ctx.rotate(rotation);
  ctx.shadowColor = severity === "critical" ? "rgba(180, 35, 24, 0.78)" : "rgba(126, 246, 255, 0.75)";
  ctx.shadowBlur = severity === "normal" ? 14 : 24;
  ctx.fillStyle = "#e9f3f5";
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = severity === "critical" ? "#b42318" : "#087f77";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = "#172433";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-17, 0);
  ctx.lineTo(17, 0);
  ctx.moveTo(0, -17);
  ctx.lineTo(0, 17);
  ctx.stroke();
  ctx.fillStyle = "#172433";
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#d5edf0";
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.fillText(event ? `${titleCase(event.process_phase)} cycle - ${event.part_id}` : "Waiting for CNC cycle", 34, 32);
  ctx.fillStyle = severity === "critical" ? "#ffb0aa" : severity === "warning" ? "#ffd58a" : "#9fd7d2";
  ctx.fillText(event ? `${titleCase(severity)} process state` : "No active telemetry", 34, 56);

  const progress = clamp(cycleProgress(event) * 100, 0, 100);
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  roundedRect(ctx, 840, 78, 212, 18, 9);
  ctx.fill();
  ctx.fillStyle = severity === "critical" ? "#b42318" : severity === "warning" ? "#b36b00" : "#087f77";
  roundedRect(ctx, 840, 78, 212 * (progress / 100), 18, 9);
  ctx.fill();
  ctx.fillStyle = "#d5edf0";
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.fillText("Cycle progress", 840, 68);
  ctx.fillText(`${progress.toFixed(0)}%`, 1018, 112);
}

function updateMachiningReadout(event, detection) {
  if (!els.cutPhaseLabel) return;
  if (!event) {
    els.cutPhaseLabel.textContent = "Waiting for cycle";
    els.cutProgress.textContent = "0%";
    els.toolPosition.textContent = "X 0.0 / Y 0.0";
    els.materialRemoval.textContent = "No active cut.";
    els.chipLoadState.textContent = "Waiting for telemetry.";
    return;
  }

  const path = toolPathPoint(event, 0);
  const rough = machiningProgress(event, "roughing");
  const finish = machiningProgress(event, "finishing");
  const codes = detection?.anomaly_codes || [];
  const loadGap = event.spindle_load_pct === null
    ? null
    : Number(event.spindle_load_pct) - Number(event.expected_load_pct);

  els.cutPhaseLabel.textContent = `${titleCase(event.process_phase)} pass`;
  els.cutProgress.textContent = `${Math.round(cycleProgress(event) * 100)}% cycle`;
  els.toolPosition.textContent = `X ${(path.nx * 220).toFixed(1)} / Y ${(path.ny * 120).toFixed(1)}`;

  if (event.process_phase === "warmup") {
    els.materialRemoval.textContent = "Spindle warmup, tool above part.";
  } else if (event.process_phase === "roughing") {
    els.materialRemoval.textContent = `Rough pocket removal ${Math.round(rough * 100)}%.`;
  } else if (event.process_phase === "finishing") {
    els.materialRemoval.textContent = `Finish contour and holes ${Math.round(finish * 100)}%.`;
  } else {
    els.materialRemoval.textContent = "Inspection pass, cutter retracted.";
  }

  if (codes.includes("sensor_dropout")) {
    els.chipLoadState.textContent = "Telemetry missing; cut state cannot be trusted.";
  } else if (codes.includes("feed_mismatch")) {
    els.chipLoadState.textContent = "Feed outside validated window.";
  } else if (codes.includes("chatter_risk")) {
    els.chipLoadState.textContent = "Unstable cut: vibration suggests chatter.";
  } else if (codes.includes("thermal_drift")) {
    els.chipLoadState.textContent = "Thermal drift building around the cut.";
  } else if (loadGap !== null && Math.abs(loadGap) > 6) {
    els.chipLoadState.textContent = `Load residual ${loadGap >= 0 ? "+" : ""}${loadGap.toFixed(1)} points.`;
  } else {
    els.chipLoadState.textContent = `Nominal chip load at ${fmt(event.spindle_load_pct, "%", 1)}.`;
  }
}

function startMachiningLoop() {
  if (!els.machiningCanvas || state.machiningFrame) return;
  const draw = (timestamp) => {
    const latest = state.lastPayload?.latest;
    drawMachiningScene(latest?.event || null, latest?.detection || null, timestamp);
    state.machiningFrame = window.requestAnimationFrame(draw);
  };
  state.machiningFrame = window.requestAnimationFrame(draw);
}

function render(payload) {
  state.lastPayload = payload;
  const latest = payload.latest;
  const summary = payload.summary;
  const rows = payload.history || [];

  els.samples.textContent = summary.samples;
  els.healthScore.textContent = summary.health_score;
  els.phase.textContent = titleCase(summary.phase);
  els.severity.textContent = titleCase(summary.active_severity);
  els.severity.className = summary.active_severity || "normal";
  els.activeProtocol.textContent = PROTOCOL_LABELS[state.protocol];

  if (!latest) {
    drawEmptyCharts();
    renderPlatformState(null, null);
    renderSensor(null);
    renderNode();
    renderLesson();
    renderDataSource();
    renderCollectionStage();
    renderFlowSeverity({ severity: "normal" });
    updateMachiningReadout(null, null);
    els.packetPayload.textContent = buildProtocolPacket(null, null);
    els.packetQuality.textContent = "quality pending";
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

  const currentSeverity = severityClass(detection.severity);
  els.decision.className = `decision ${currentSeverity}`;
  els.recommendationPanel.className = `panel recommendation-panel ${currentSeverity}`;

  const codes = detection.anomaly_codes || [];
  els.anomalyCount.textContent = `${codes.length} active`;
  els.evidenceList.innerHTML = "";
  for (const item of detection.evidence || []) {
    const li = document.createElement("li");
    li.textContent = item;
    els.evidenceList.appendChild(li);
  }

  renderPlatformState(event, detection);
  renderSensor(event);
  renderNode();
  renderLesson();
  renderDataSource();
  renderCollectionStage();
  renderFlowSeverity(detection);
  updateMachiningReadout(event, detection);
  els.packetQuality.textContent = detection.anomaly_detected
    ? `${signalQuality(event)} - ${titleCase(detection.severity)} evidence`
    : `${signalQuality(event)} - nominal`;
  els.packetPayload.textContent = buildProtocolPacket(event, detection);

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

document.querySelectorAll("[data-node]").forEach((button) => {
  button.addEventListener("click", () => {
    state.node = button.dataset.node;
    renderNode();
    activateLearningPath("data-path", { pulse: true });
  });
});

document.querySelectorAll("[data-lesson]").forEach((button) => {
  button.addEventListener("click", () => {
    state.lesson = button.dataset.lesson;
    state.node = LESSONS[state.lesson].node;
    renderLesson();
    renderNode();
    activateLearningPath(state.lesson === "case" ? "case-study" : "data-path", { pulse: true });
  });
});

document.querySelectorAll("[data-protocol]").forEach((button) => {
  button.addEventListener("click", () => {
    state.protocol = button.dataset.protocol;
    setActiveButtons("[data-protocol]", "protocol", state.protocol);
    els.activeProtocol.textContent = PROTOCOL_LABELS[state.protocol];
    if (state.lastPayload?.latest) {
      els.packetPayload.textContent = buildProtocolPacket(
        state.lastPayload.latest.event,
        state.lastPayload.latest.detection,
      );
    }
    activateLearningPath("signals", { pulse: true });
  });
});

document.querySelectorAll("[data-source]").forEach((button) => {
  button.addEventListener("click", () => {
    state.source = button.dataset.source;
    renderDataSource();
    activateLearningPath("real-data", { pulse: true });
  });
});

document.querySelectorAll("[data-collection]").forEach((button) => {
  button.addEventListener("click", () => {
    state.collection = button.dataset.collection;
    renderCollectionStage();
    activateLearningPath("real-data", { pulse: true });
  });
});

setupSensorButtons();
setupLearningPath();
renderNode();
renderLesson();
renderSensor(null);
renderDataSource();
renderCollectionStage();
activateLearningPath("overview");
setActiveButtons("[data-protocol]", "protocol", state.protocol);
updateMachiningReadout(null, null);
startMachiningLoop();
tick(4).catch(console.error);
startLoop();
