const state = {
  running: true,
  timer: null,
  intervalMs: 900,
  protocol: "mqtt",
  lesson: "twin",
  node: "cnc",
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
  plm: {
    title: "PLM · product record",
    description: "Product Lifecycle Management is the system of record for the as-designed product: part number, revision, BOM, released tolerances, and engineering change orders (ECO). It is where design intent legitimately originates.",
    interface: "Releases the item, revision, and GD&T to CAD and the routing/BOM to MES; receives change requests from QMS.",
    watch: "If a quality non-conformance never turns into a controlled change here, the same defect is built again.",
  },
  mes: {
    title: "MES · execution",
    description: "The Manufacturing Execution System turns a released part and process into a dispatched work order, tracks WIP and routing on the floor, and records the as-built genealogy of every unit.",
    interface: "Dispatches the work order to the CNC cell; consumes as-built state and OEE from the twin and machine-data historian.",
    watch: "A work order dispatched against a superseded revision quietly builds parts to the wrong spec.",
  },
  qms: {
    title: "QMS · quality",
    description: "The Quality Management System consumes CMM results into SPC control charts, raises non-conformance reports (NCR), assigns dispositions, and drives corrective action (CAPA) back to PLM.",
    interface: "Reads inspection deviations from the CMM; opens an NCR and feeds the corrective change back to PLM.",
    watch: "An out-of-tolerance part with no disposition and no linked change is scrap waiting to repeat.",
  },
  hub: {
    title: "Machine data · historian",
    description: "The machine-data layer archives the as-run time series and rolls it up into OEE, utilization, and tool-life analytics — the operational reality that MES scheduling and engineering decisions lean on.",
    interface: "Ingests the same telemetry the twin sees; publishes OEE and utilization to MES and engineering.",
    watch: "Averaged KPIs can hide the short excursions — like a thermal drift — that actually cause defects.",
  },
  cad: {
    title: "CAD · product design",
    description: "The origin of the digital thread: part geometry, tolerances, datums, and material intent are defined here.",
    interface: "Native CAD model with PMI released downstream to CAM and inspection.",
    watch: "Design changes must propagate to the process plan and inspection, or the thread breaks.",
  },
  cae: {
    title: "CAE · simulation",
    description: "Validates the design and the planned process with FEA and machining simulation before any metal is cut.",
    interface: "Simulation margins and results linked back to the specific part revision.",
    watch: "Simulation assumptions that no longer match the real fixture or stock mislead everyone downstream.",
  },
  cam: {
    title: "CAM · NC programming",
    description: "Turns design intent into a machine process plan: toolpaths, feeds, speeds, and the posted NC program.",
    interface: "Posts the NC program to the CNC and the handling sequence to the robot cell.",
    watch: "A wrong post-processor or a stale program sends bad instructions straight to the floor.",
  },
  cnc: {
    title: "CNC machining center",
    description: "The physical cut. Its controller and sensors produce the live state that the digital twin must mirror.",
    interface: "MTConnect adapter and OPC UA served from the cell edge computer.",
    watch: "Program overrides, wrong workholding, or missing operation context can make raw data misleading.",
  },
  robot: {
    title: "Robot handling cell",
    description: "Loads blanks, unloads finished parts, and moves work between the machine and inspection under PLC control.",
    interface: "PLC and robot controller exposed to the platform over OPC UA.",
    watch: "A machine fault should interlock the cell and pause automated handling, not keep feeding parts.",
  },
  cmm: {
    title: "CMM · inspection",
    description: "Measures the finished part against the model and links quality results back to the part and process.",
    interface: "Inspection results and deviations published to the API / state engine.",
    watch: "Out-of-tolerance features flag process drift early, before scrap and rework accumulate.",
  },
  edge: {
    title: "Edge gateway",
    description: "Timestamps, normalizes, buffers, and quality-checks machine and robot data right at the cell edge.",
    interface: "Hosts the MTConnect adapter and OPC UA client, then publishes clean events.",
    watch: "Clock drift, dropped fields, and stale packets must be surfaced, never silently passed through.",
  },
  mqtt: {
    title: "MQTT broker",
    description: "Transports each clean event to every subscriber: the twin engine, the dashboard, and storage.",
    interface: "Publish / subscribe on factory topics with QoS and retained state.",
    watch: "A valid packet can still be wrong if topic, unit, phase, or asset identity is missing.",
  },
  api: {
    title: "API · state engine",
    description: "Validates events, updates current twin state, runs the expected-vs-actual model, and serves the dashboard.",
    interface: "REST and WebSocket interfaces sitting above the machine connectors.",
    watch: "A model tuned to the wrong operation window will flag normal behavior or miss real drift.",
  },
  twin: {
    title: "Digital twin dashboard",
    description: "The live view engineers watch: health, severity, model gap, and the recommended next action.",
    interface: "Reads twin state and feeds live status plus inspection findings back to engineering.",
    watch: "Recommendations without evidence, confidence, and required checks are hard to trust on the floor.",
  },
};

const LESSONS = {
  twin: {
    title: "What is a digital twin?",
    step: "Step 1 of 3",
    node: "twin",
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
    node: "mqtt",
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
    node: "cnc",
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
  nodeLive: document.getElementById("nodeLive"),
  factoryMap: document.getElementById("factoryMap"),
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

// The twin runs entirely in the browser via twin-engine.js (the client-side port of the
// Python simulator/detector/recommender), so the same UI works with no backend on static
// hosting. window.TwinEngine returns the identical { latest, history, summary } payload the
// Python /api endpoints did.
async function tick(count = 1) {
  const payload = window.TwinEngine.next(count);
  render(payload);
}

async function reset() {
  const payload = window.TwinEngine.reset();
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
  const detail = NODE_DETAILS[state.node] || NODE_DETAILS.cnc;
  els.nodeTitle.textContent = detail.title;
  els.nodeDescription.textContent = detail.description;
  els.nodeLatency.textContent = detail.interface;
  els.nodeFailure.textContent = detail.watch;

  const f = deriveFactory(state.lastPayload);
  if (els.nodeLive) {
    els.nodeLive.textContent = nodeLiveText(state.node, f);
    const tone = nodeLiveTone(state.node, f);
    els.nodeLive.className = "live-chip" + (tone && tone !== "normal" ? ` ${tone}` : "");
  }

  document.querySelectorAll(".zone[data-node]").forEach((zone) => {
    zone.classList.toggle("selected", zone.dataset.node === state.node);
  });
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
  // Enterprise context that ties telemetry to the systems of record (PLM/MES/QMS).
  const thread = {
    work_order: event.work_order,
    part_revision: event.part_revision,
    tolerance_um: event.tolerance_um,
    mes_state: event.mes_state,
    quality: {
      verdict: event.cmm_verdict,
      deviation_um: event.cmm_deviation_um,
      ncr_id: event.ncr_id,
      disposition: event.disposition,
      eco_id: event.eco_id,
    },
    oee_pct: event.oee_pct,
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
        thread,
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
      thread,
      detection: {
        severity: detection.severity,
        health_score: detection.health_score,
        anomaly_codes: detection.anomaly_codes,
      },
    },
  }, null, 2);
}

function setMapText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setZoneState(id, severity) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("sev-watch", "sev-warning", "sev-critical");
  if (severity && severity !== "normal") el.classList.add(`sev-${severity}`);
}

function setThreadState(id, severity, degraded) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("sev-warning", "sev-critical", "degraded");
  if (severity === "warning") el.classList.add("sev-warning");
  else if (severity === "critical") el.classList.add("sev-critical");
  if (degraded) el.classList.add("degraded");
}

function setPill(pillId, textId, text, tone) {
  const pill = document.getElementById(pillId);
  const label = document.getElementById(textId);
  const cls = tone === "critical" ? "crit" : tone === "warning" ? "warn" : null;
  if (label) {
    label.textContent = text;
    label.classList.remove("warn", "crit");
    if (cls) label.classList.add(cls);
  }
  if (pill) {
    pill.classList.remove("warn", "crit");
    if (cls) pill.classList.add(cls);
  }
}

// Derive robot, inspection, edge, transport, and platform values from the live CNC stream
// so every station on the map reflects the same synthetic process in a coherent way.
function deriveFactory(payload) {
  const latest = payload && payload.latest;
  const summary = (payload && payload.summary) || {};
  if (!latest || !latest.event) return null;

  const event = latest.event;
  const detection = latest.detection || {};
  const recommendation = latest.recommendation || {};
  const seq = Number(event.sequence) || 0;
  const pos = ((seq % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
  const phase = event.process_phase;
  const sev = severityClass(detection.severity);
  const codes = detection.anomaly_codes || [];
  const dropout = codes.includes("sensor_dropout");
  const parts = Math.floor(seq / CYCLE_LENGTH);

  const load = event.spindle_load_pct;
  const temp = event.temperature_c;
  const vib = event.vibration_rms;
  const hasLoad = load !== null && load !== undefined;
  const hasTemp = temp !== null && temp !== undefined;
  const hasVib = vib !== null && vib !== undefined;
  const loadGap = hasLoad ? Number(load) - Number(event.expected_load_pct) : null;
  const tempGap = hasTemp ? Number(temp) - Number(event.expected_temperature_c) : null;
  const msgRate = 1000 / state.intervalMs;

  // Robot handling cell: sequenced to the machining cycle, interlocked on faults.
  let robotStatus = "RUN";
  let robotMode = "Standby · cycle in progress";
  if (dropout || sev === "critical") {
    robotStatus = "HOLD";
    robotMode = "Safety interlock · line paused";
  } else if (phase === "warmup") {
    robotMode = "Loading blank into fixture";
  } else if (phase === "inspection") {
    robotMode = "Unloading · transfer to CMM";
  } else if (sev === "warning") {
    robotMode = "Holding · monitoring cell";
  }
  const robotAxis = dropout
    ? null
    : clamp(16 + (pos % 14) * 2.4 + (sev === "warning" ? 18 : sev === "critical" ? 28 : 0), 0, 100);
  const plcScan = dropout ? "—" : 4 + (seq % 3);

  // CMM inspection: the dimensional verdict comes from the enterprise quality record,
  // not the process severity, so the CMM and QMS stations tell the same story.
  const inspecting = phase === "inspection";
  const outOfTol = event.cmm_verdict === "out_of_tol";
  const cmmState = inspecting
    ? "Probing datums + features"
    : outOfTol
      ? "Part held for rework"
      : robotStatus === "HOLD"
        ? "Idle · awaiting release"
        : "Awaiting finished part";
  const devUm =
    event.cmm_deviation_um === null || event.cmm_deviation_um === undefined
      ? null
      : Number(event.cmm_deviation_um);
  const verdict = outOfTol ? "OUT OF TOL" : "IN TOL";

  // Enterprise systems of record: PLM / MES / QMS / machine-data historian.
  const ncrOpen = Boolean(event.ncr_id);
  const enterprise = {
    plmPart: `${event.part_id} · ${event.part_revision}`,
    plmTol: `±${Number(event.tolerance_um).toFixed(0)} µm`,
    plmEco: event.eco_id || "—",
    mesState: (event.mes_state || "in_process").replace(/_/g, " "),
    mesWo: event.work_order,
    mesDispatch: `rev ${event.part_revision} · ${phase}`,
    qmsVerdict: outOfTol ? "NCR" : "IN TOL",
    qmsNcr: event.ncr_id || "none open",
    qmsDisp: event.disposition || "—",
    hubOee: `${Number(event.oee_pct).toFixed(0)}%`,
    hubArchive: `${((summary.samples || seq + 1) * 6).toLocaleString()} pts`,
    hubTool: `${clamp(100 - Number(event.tool_wear_pct || 0), 0, 100).toFixed(0)}%`,
    ncrOpen,
    ecoIssued: Boolean(event.eco_id),
    revB: event.part_revision === "B",
  };

  // Edge gateway + adapters.
  const edgeQuality = dropout ? "DEGRADED" : "VALID";
  const mtcState = dropout ? "UNAVAILABLE" : phase === "inspection" ? "READY" : "ACTIVE";
  const opcState = robotStatus === "HOLD" ? "sub · stalled" : "sub · 20 Hz";
  const throughput = dropout ? "buffering" : `${msgRate.toFixed(1)} msg/s`;

  const mqttMsgs = summary.samples || seq + 1;
  const apiLatency = dropout ? 40 : 6 + Math.round(Math.abs(Math.sin(seq / 5)) * 7);
  const apiReq = Math.max(1, Math.round(msgRate * 4));
  const version = summary.samples || seq + 1;

  return {
    event,
    detection,
    recommendation,
    summary,
    seq,
    pos,
    phase,
    sev,
    codes,
    dropout,
    parts,
    load,
    temp,
    vib,
    hasLoad,
    hasTemp,
    hasVib,
    loadGap,
    tempGap,
    robotStatus,
    robotMode,
    robotAxis,
    plcScan,
    inspecting,
    cmmState,
    devUm,
    verdict,
    outOfTol,
    enterprise,
    edgeQuality,
    mtcState,
    opcState,
    throughput,
    mqttMsgs,
    apiLatency,
    apiReq,
    version,
    health: detection.health_score,
    decision: recommendation.decision,
  };
}

function nodeLiveText(node, f) {
  if (!f) return "waiting for telemetry";
  switch (node) {
    case "cnc":
      return `${f.hasLoad ? `${Number(f.load).toFixed(0)}% load` : "load ——"} · vib ${f.hasVib ? Number(f.vib).toFixed(2) : "——"} · ${f.hasTemp ? `${Number(f.temp).toFixed(0)}°C` : "temp ——"}`;
    case "robot":
      return `${f.robotStatus} · ${f.robotMode}`;
    case "cmm":
      return `${f.verdict} · ${f.devUm === null ? "no reading" : `${f.devUm.toFixed(1)} µm`}`;
    case "plm":
      return `${f.enterprise.plmPart} · ECO ${f.enterprise.ecoIssued ? f.event.eco_id : "none"}`;
    case "mes":
      return `${f.enterprise.mesWo} · ${f.enterprise.mesState}`;
    case "qms":
      return f.enterprise.ncrOpen
        ? `${f.event.ncr_id} · ${f.enterprise.qmsDisp}`
        : `no open NCR · in tolerance`;
    case "hub":
      return `OEE ${f.enterprise.hubOee} · ${f.enterprise.hubArchive} archived`;
    case "edge":
      return `${f.edgeQuality} · ${f.throughput}`;
    case "mqtt":
      return `${f.mqttMsgs} published · QoS 1`;
    case "api":
      return `${f.apiLatency} ms · state v${f.version}`;
    case "twin":
      return `health ${f.health} · ${f.detection.severity || "normal"}`;
    case "cad":
      return `${f.event.part_id} · rev ${f.event.part_revision} released`;
    case "cae":
      return "FEA verified · margin 1.8×";
    case "cam":
      return `${titleCase(f.phase)} toolpath active`;
    default:
      return "live";
  }
}

function nodeLiveTone(node, f) {
  if (!f) return "normal";
  if (node === "robot") return f.robotStatus === "HOLD" ? "critical" : f.sev === "warning" ? "warning" : "normal";
  if (node === "cmm") return f.outOfTol ? "warning" : "normal";
  if (node === "qms") return f.enterprise.ncrOpen ? "warning" : "normal";
  if (node === "mes") return f.enterprise.mesState === "hold" ? "warning" : "normal";
  if (node === "edge") return f.dropout ? "warning" : "normal";
  if (["cnc", "twin", "api"].includes(node)) return f.sev;
  return "normal";
}

function renderFactoryMap(payload) {
  const f = deriveFactory(payload);

  if (!f) {
    ["cellCnc", "cellRobot", "cellCmm", "nodeEdge", "nodeMqtt", "nodeApi", "nodeTwin", "nodePlm", "nodeMes", "nodeQms", "nodeHub"].forEach((id) =>
      setZoneState(id, "normal"),
    );
    ["pCncEdge", "pRobotEdge", "pCmmApi", "pApiTwin", "pCamCnc", "pMesCnc", "pCmmQms", "pApiMes", "pQmsPlm", "pPlmMes", "pHubMes"].forEach((id) =>
      setThreadState(id, "normal", false),
    );
    return;
  }

  const part = f.event.part_id;
  const sev = f.sev;
  const criticalTone = f.dropout || sev === "critical" ? "critical" : sev === "warning" ? "warning" : "normal";

  // Engineering office
  setMapText("fmCadPart", part);
  setMapText("fmCamPhase", titleCase(f.phase));

  // CNC machining center
  const cncStatus = f.dropout ? "DATA LOSS" : sev === "critical" ? "FAULT" : sev === "warning" ? "WATCH" : "RUN";
  setPill("fmCncStatusPill", "fmCncStatus", cncStatus, criticalTone);
  setMapText("fmCncPhase", titleCase(f.phase));
  setMapText("fmCncLoad", f.hasLoad ? `${Number(f.load).toFixed(0)}%` : "——");
  setMapText("fmCncRpm", `${fmt(f.event.spindle_speed_rpm, "", 0)}`);
  setMapText("fmCncFeed", `${fmt(f.event.feed_rate_mm_min, "", 0)}`);
  setMapText("fmCncTemp", f.hasTemp ? `${Number(f.temp).toFixed(0)}°` : "——");
  setMapText("fmCncVib", f.hasVib ? Number(f.vib).toFixed(2) : "——");
  setMapText("fmCncWear", fmt(f.event.tool_wear_pct, "%", 0));
  setZoneState("cellCnc", sev);

  // Robot handling cell
  const robotTone = f.robotStatus === "HOLD" ? "critical" : sev === "warning" ? "warning" : "normal";
  setPill("fmRobotStatusPill", "fmRobotStatus", f.robotStatus, robotTone);
  setMapText("fmRobotMode", f.robotMode);
  setMapText("fmRobotAxis", f.robotAxis === null ? "——" : `${f.robotAxis.toFixed(0)}%`);
  setMapText("fmRobotCycles", String(f.parts));
  setMapText("fmPlcScan", `PLC scan ${f.plcScan} ms`);
  setZoneState("cellRobot", robotTone);

  // CMM inspection (dimensional verdict from the quality record)
  const cmmTone = f.outOfTol ? "warning" : "normal";
  setPill("fmCmmVerdictPill", "fmCmmVerdict", f.verdict, cmmTone);
  setMapText("fmCmmDev", f.devUm === null ? "— µm" : `${f.devUm.toFixed(1)} µm`);
  setMapText("fmCmmState", f.cmmState);
  setMapText("fmCmmPart", part);
  setZoneState("cellCmm", cmmTone);

  // Edge gateway + adapters
  setMapText("fmMtcState", f.mtcState);
  setMapText("fmOpcState", f.opcState);
  setMapText("fmEdgeThroughput", f.throughput);
  setMapText("fmEdgeQuality", f.edgeQuality);
  setZoneState("nodeEdge", f.dropout ? "warning" : "normal");
  const ledEdge = document.getElementById("ledEdge");
  if (ledEdge) ledEdge.classList.toggle("led-on", !f.dropout);

  // MQTT broker
  setMapText("fmMqttTopic", String(f.event.topic).replace(f.event.machine_id, "…"));
  setMapText("fmMqttMsgs", String(f.mqttMsgs));

  // API / state engine
  setMapText("fmApiLatency", `${f.apiLatency} ms`);
  setMapText("fmApiReq", `${f.apiReq} /s`);
  setMapText("fmApiVersion", `v${f.version}`);
  setZoneState("nodeApi", f.dropout ? "warning" : "normal");

  // Digital twin dashboard
  setMapText("fmTwinHealth", f.health === null || f.health === undefined ? "—" : String(f.health));
  setPill("fmTwinSeverityPill", "fmTwinSeverity", (f.detection.severity || "normal").toUpperCase(), criticalTone);
  setMapText(
    "fmTwinGap",
    f.loadGap === null || f.tempGap === null
      ? "data incomplete"
      : `load ${f.loadGap >= 0 ? "+" : ""}${f.loadGap.toFixed(1)} · therm ${f.tempGap >= 0 ? "+" : ""}${f.tempGap.toFixed(1)}`,
  );
  setMapText("fmTwinDecision", titleCase(f.decision || "proceed"));
  setZoneState("nodeTwin", sev);

  const loadBar = document.getElementById("fmTwinBarLoad");
  const thermBar = document.getElementById("fmTwinBarThermal");
  if (loadBar) {
    loadBar.setAttribute("width", String(clamp(f.hasLoad ? (Number(f.load) / 100) * 104 : 0, 2, 104)));
  }
  if (thermBar) {
    const tfrac = f.hasTemp ? clamp((Number(f.temp) - 20) / 45, 0, 1) : 0;
    thermBar.setAttribute("width", String(clamp(tfrac * 104, 2, 104)));
    thermBar.setAttribute("fill", f.tempGap !== null && f.tempGap > 5 ? "#ffbf5a" : "#2ee6d6");
  }

  // Enterprise systems of record: PLM, MES, QMS, machine-data historian.
  const e = f.enterprise;
  setMapText("fmPlmPart", e.plmPart);
  setMapText("fmPlmTol", e.plmTol);
  setMapText("fmPlmEco", e.plmEco);
  const plmEco = document.getElementById("fmPlmEco");
  if (plmEco) plmEco.classList.toggle("val-alert", e.ecoIssued);
  setZoneState("nodePlm", "normal");

  const mesTone = e.mesState === "hold" ? "warning" : "normal";
  setPill("fmMesStatePill", "fmMesState", e.mesState.toUpperCase(), mesTone);
  setMapText("fmMesWo", e.mesWo);
  setMapText("fmMesDispatch", e.mesDispatch);
  setZoneState("nodeMes", mesTone);

  const qmsTone = e.ncrOpen ? "warning" : "normal";
  setPill("fmQmsVerdictPill", "fmQmsVerdict", e.qmsVerdict, qmsTone);
  setMapText("fmQmsNcr", e.qmsNcr);
  setMapText("fmQmsDisp", e.qmsDisp);
  setZoneState("nodeQms", qmsTone);

  setMapText("fmHubOee", e.hubOee);
  setMapText("fmHubArchive", e.hubArchive);
  setMapText("fmHubTool", e.hubTool);
  setZoneState("nodeHub", "normal");

  // Data thread severity: telemetry, platform, and enterprise paths react to state.
  setThreadState("pCncEdge", f.dropout ? "critical" : sev, f.dropout);
  setThreadState("pRobotEdge", f.robotStatus === "HOLD" ? "critical" : "normal", false);
  setThreadState("pCmmApi", cmmTone, false);
  setThreadState("pApiTwin", sev, false);
  // The corrective loop lights up while a non-conformance is open: CMM -> QMS -> PLM,
  // and the held MES dispatch, until the corrected revision is re-released.
  setThreadState("pCmmQms", f.outOfTol ? "warning" : "normal", false);
  setThreadState("pQmsPlm", e.ncrOpen ? "warning" : "normal", false);
  setThreadState("pApiMes", e.ncrOpen ? "warning" : "normal", false);
  setThreadState("pMesCnc", mesTone, false);
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

// Part geometry expressed as fractions of the raw stock (top-down view).
const POCKET = { x0: 0.18, x1: 0.82, y0: 0.26, y1: 0.72 };
const PROFILE = { x0: 0.07, x1: 0.93, y0: 0.1, y1: 0.9 };
const ROUGH_PASSES = 7;
const HOLES = [
  [0.12, 0.15],
  [0.88, 0.15],
  [0.12, 0.85],
  [0.88, 0.85],
];

// Eased machining state so the cut animates smoothly between discrete events.
const MACH = { rough: 0, finish: 0, lastPos: null };

function serpentinePos(rough) {
  const total = clamp(rough, 0, 1) * ROUGH_PASSES;
  const line = Math.min(ROUGH_PASSES - 1, Math.floor(total));
  const frac = total - line;
  const dir = line % 2 === 0 ? frac : 1 - frac;
  const strip = (POCKET.y1 - POCKET.y0) / ROUGH_PASSES;
  return {
    nx: POCKET.x0 + dir * (POCKET.x1 - POCKET.x0),
    ny: POCKET.y0 + (line + 0.5) * strip,
    cutting: true,
  };
}

function contourPos(finish) {
  const t = clamp(finish, 0, 1) * 4;
  if (t < 1) return { nx: lerp(PROFILE.x0, PROFILE.x1, t), ny: PROFILE.y0, cutting: true };
  if (t < 2) return { nx: PROFILE.x1, ny: lerp(PROFILE.y0, PROFILE.y1, t - 1), cutting: true };
  if (t < 3) return { nx: lerp(PROFILE.x1, PROFILE.x0, t - 2), ny: PROFILE.y1, cutting: true };
  return { nx: PROFILE.x0, ny: lerp(PROFILE.y1, PROFILE.y0, t - 3), cutting: true };
}

// Logical (non-eased) tool target for the numeric readout.
function machineToolTarget(event) {
  if (!event) return { nx: 0.5, ny: 0.12, cutting: false };
  const phase = event.process_phase;
  if (phase === "roughing") return serpentinePos(machiningProgress(event, "roughing"));
  if (phase === "finishing") return contourPos(machiningProgress(event, "finishing"));
  return { nx: 0.5, ny: 0.12, cutting: false };
}

function drawClamp(ctx, x, y, w, h) {
  ctx.save();
  roundedRect(ctx, x - w / 2, y - h / 2, w, h, 4);
  ctx.fillStyle = "#2a3a48";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, Math.min(w, h) * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "#151f28";
  ctx.fill();
  ctx.restore();
}

// Reveal the roughed pocket serpentine-pass by pass, up to the current progress.
function drawPocket(ctx, stock, rough) {
  if (rough <= 0.002) return;
  const px = stock.x + stock.w * POCKET.x0;
  const py = stock.y + stock.h * POCKET.y0;
  const pw = stock.w * (POCKET.x1 - POCKET.x0);
  const ph = stock.h * (POCKET.y1 - POCKET.y0);
  const strip = ph / ROUGH_PASSES;
  const total = clamp(rough, 0, 1) * ROUGH_PASSES;
  const done = Math.floor(total);
  const frac = total - done;

  ctx.save();
  roundedRect(ctx, px, py, pw, ph, 8);
  ctx.clip();

  for (let i = 0; i <= done && i < ROUGH_PASSES; i += 1) {
    let sx = px;
    let sw = pw;
    if (i === done) {
      sw = pw * frac;
      sx = i % 2 === 0 ? px : px + pw - sw;
    }
    if (sw <= 0.5) continue;
    const g = ctx.createLinearGradient(0, py + i * strip, 0, py + (i + 1) * strip);
    g.addColorStop(0, "#3c515f");
    g.addColorStop(0.5, "#263843");
    g.addColorStop(1, "#1b2a34");
    ctx.fillStyle = g;
    ctx.fillRect(sx, py + i * strip, sw, strip + 0.6);
    // scallop tool marks along the finished passes
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let mx = sx + 7; mx < sx + sw; mx += 13) {
      ctx.beginPath();
      ctx.arc(mx, py + i * strip + strip / 2, 6, -Math.PI * 0.2, Math.PI * 1.2);
      ctx.stroke();
    }
  }

  // inner shadow along the top edge for a sense of pocket depth
  const shade = ctx.createLinearGradient(0, py, 0, py + strip * 1.4);
  shade.addColorStop(0, "rgba(0, 0, 0, 0.4)");
  shade.addColorStop(1, "transparent");
  ctx.fillStyle = shade;
  ctx.fillRect(px, py, pw, strip * 1.4);
  ctx.restore();

  if (rough > 0.92) {
    roundedRect(ctx, px, py, pw, ph, 8);
    ctx.strokeStyle = "rgba(126, 246, 255, 0.28)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Finishing pass: clean outer profile plus drilled holes, revealed progressively.
function drawFinishing(ctx, stock, finish) {
  if (finish <= 0.002) return;
  const ox = stock.x + stock.w * PROFILE.x0;
  const oy = stock.y + stock.h * PROFILE.y0;
  const ow = stock.w * (PROFILE.x1 - PROFILE.x0);
  const oh = stock.h * (PROFILE.y1 - PROFILE.y0);

  ctx.save();
  ctx.globalAlpha = clamp(finish * 1.6, 0, 1);
  roundedRect(ctx, ox, oy, ow, oh, 16);
  ctx.strokeStyle = "rgba(126, 246, 255, 0.8)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  const holeR = Math.min(stock.w, stock.h) * 0.05;
  HOLES.forEach(([hx, hy], idx) => {
    const reveal = clamp(finish * 4 - idx, 0, 1);
    if (reveal <= 0.01) return;
    const cx = stock.x + stock.w * hx;
    const cy = stock.y + stock.h * hy;
    ctx.beginPath();
    ctx.arc(cx, cy, holeR * 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(126, 246, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, lerp(3, holeR, reveal), 0, Math.PI * 2);
    ctx.fillStyle = "#12202a";
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 246, 255, 0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

// Inspection: retracted probe scanning the finished part.
function drawInspection(ctx, stock, now, probeX) {
  const y0 = stock.y + stock.h * 0.06;
  const y1 = stock.y + stock.h * 0.94;
  ctx.save();
  ctx.strokeStyle = "rgba(126, 246, 255, 0.5)";
  ctx.setLineDash([5, 6]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(probeX, y0);
  ctx.lineTo(probeX, y1);
  ctx.stroke();
  ctx.restore();
}

function drawEndMill(ctx, x, y, radius, rpm, severity, now, cutting) {
  const rot = state.reducedMotion ? 0 : (now / 1000) * (rpm / 700);
  if (cutting) {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, radius * 2.3);
    const color =
      severity === "critical" ? "rgba(255, 91, 77, 0.5)" : severity === "warning" ? "rgba(255, 191, 90, 0.45)" : "rgba(126, 246, 255, 0.5)";
    glow.addColorStop(0, color);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = severity === "critical" ? "rgba(255, 91, 77, 0.8)" : "rgba(126, 246, 255, 0.75)";
  ctx.shadowBlur = cutting ? 18 : 9;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#e9f3f5";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = severity === "critical" ? "#ff5b4d" : severity === "warning" ? "#b36b00" : "#0f9c90";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = "#243543";
  ctx.lineWidth = 2.5;
  for (let f = 0; f < 4; f += 1) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * 0.85, 0);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "#243543";
  ctx.fill();
  ctx.restore();
}

function drawMachiningScene(event, detection, timestamp) {
  const canvas = els.machiningCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const now = state.reducedMotion ? 0 : timestamp;
  const severity = severityClass(detection?.severity);
  const codes = detection?.anomaly_codes || [];
  const dropout = codes.includes("sensor_dropout");
  const phase = event ? event.process_phase : null;

  // Centered raw stock on a fixtured machine table.
  const stock = { w: W * 0.5, h: H * 0.6 };
  stock.x = (W - stock.w) / 2;
  stock.y = (H - stock.h) / 2 + H * 0.03;
  const toCanvas = (nx, ny) => ({ x: stock.x + nx * stock.w, y: stock.y + ny * stock.h });

  // Ease the machined progress toward the real event progress; snap on a new cycle.
  const targetRough = event ? machiningProgress(event, "roughing") : 0;
  const targetFinish = event ? machiningProgress(event, "finishing") : 0;
  const pos = event ? cyclePosition(event) : 0;
  if (MACH.lastPos === null || pos < MACH.lastPos - 1) {
    MACH.rough = targetRough;
    MACH.finish = targetFinish;
  }
  MACH.lastPos = pos;
  MACH.rough += (targetRough - MACH.rough) * 0.08;
  MACH.finish += (targetFinish - MACH.finish) * 0.08;
  if (Math.abs(targetRough - MACH.rough) < 0.004) MACH.rough = targetRough;
  if (Math.abs(targetFinish - MACH.finish) < 0.004) MACH.finish = targetFinish;

  // Tool position derives from the eased progress so cut and cutter stay aligned.
  let toolNx = 0.5;
  let toolNy = 0.12;
  let cutting = false;
  let probeX = stock.x + stock.w * 0.5;
  if (phase === "roughing") {
    const s = serpentinePos(MACH.rough);
    toolNx = s.nx;
    toolNy = s.ny;
    cutting = true;
  } else if (phase === "finishing") {
    const c = contourPos(MACH.finish);
    toolNx = c.nx;
    toolNy = c.ny;
    cutting = true;
  } else if (phase === "inspection") {
    const scan = state.reducedMotion ? 0.5 : Math.sin(now / 620) * 0.5 + 0.5;
    toolNx = lerp(PROFILE.x0, PROFILE.x1, scan);
    toolNy = 0.5;
    probeX = stock.x + stock.w * toolNx;
    cutting = false;
  }
  if (dropout) cutting = false;
  const tool = toCanvas(toolNx, toolNy);
  if (codes.includes("chatter_risk")) {
    tool.x += Math.sin(now / 26) * 4;
    tool.y += Math.cos(now / 30) * 4;
  }

  // ---- machine bed ----
  ctx.clearRect(0, 0, W, H);
  const bed = ctx.createLinearGradient(0, 0, 0, H);
  bed.addColorStop(0, "#0f1a24");
  bed.addColorStop(1, "#0b141c");
  ctx.fillStyle = bed;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // ---- fixtured table under the stock, with T-slots ----
  const tableX = stock.x - W * 0.06;
  const tableY = stock.y - H * 0.1;
  const tableW = stock.w + W * 0.12;
  const tableH = stock.h + H * 0.2;
  roundedRect(ctx, tableX, tableY, tableW, tableH, 16);
  ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
  ctx.fill();
  ctx.strokeStyle = "rgba(184, 198, 207, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
  ctx.lineWidth = 6;
  for (let i = 1; i <= 3; i += 1) {
    const yy = tableY + (tableH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(tableX + 12, yy);
    ctx.lineTo(tableX + tableW - 12, yy);
    ctx.stroke();
  }
  drawClamp(ctx, stock.x - 4, stock.y + stock.h * 0.5, 22, 48);
  drawClamp(ctx, stock.x + stock.w + 4, stock.y + stock.h * 0.5, 22, 48);

  // ---- raw stock ----
  const sg = ctx.createLinearGradient(stock.x, stock.y, stock.x, stock.y + stock.h);
  sg.addColorStop(0, "#dae2e6");
  sg.addColorStop(0.5, "#bac7ce");
  sg.addColorStop(1, "#99a8b0");
  roundedRect(ctx, stock.x, stock.y, stock.w, stock.h, 10);
  ctx.fillStyle = sg;
  ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 10;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#eef4f5";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ---- material removal + finishing ----
  drawPocket(ctx, stock, MACH.rough);
  drawFinishing(ctx, stock, MACH.finish);
  if (phase === "inspection") drawInspection(ctx, stock, now, probeX);

  // ---- heat plume on thermal drift ----
  if (codes.includes("thermal_drift")) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    const heat = ctx.createRadialGradient(tool.x, tool.y, 10, tool.x, tool.y, H * 0.32);
    heat.addColorStop(0, "#ff9c3a");
    heat.addColorStop(1, "transparent");
    ctx.fillStyle = heat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---- chips flying off the cut ----
  if (cutting) {
    const chipCount = severity === "critical" ? 20 : severity === "warning" ? 14 : 9;
    for (let i = 0; i < chipCount; i += 1) {
      const angle = (i / chipCount) * Math.PI * 2 + now / 240;
      const radius = 14 + ((i * 13) % 30);
      const x = tool.x + Math.cos(angle) * radius;
      const y = tool.y + Math.sin(angle) * radius * 0.6;
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = i % 3 === 0 ? "#ffcf7a" : "#8fe9ff";
      ctx.fillRect(x, y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  // ---- end mill / probe ----
  const rpm = event?.spindle_speed_rpm || 4500;
  drawEndMill(ctx, tool.x, tool.y, H * 0.05, rpm, severity, now, cutting);

  // ---- labels ----
  ctx.fillStyle = "#d5edf0";
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.fillText(event ? `${titleCase(phase)} · ${event.part_id}` : "Awaiting CNC cycle", 20, 30);
  ctx.fillStyle = severity === "critical" ? "#ff9a8f" : severity === "warning" ? "#ffce8a" : "#8fd7d0";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.fillText(
    event ? (dropout ? "Telemetry lost — cut unverified" : `${titleCase(severity)} process state`) : "No active telemetry",
    20,
    50,
  );

  // ---- cycle progress strip with phase ticks ----
  const barX = 20;
  const barW = W - 40;
  const barY = H - 22;
  const progress = clamp(cycleProgress(event) * 100, 0, 100);
  roundedRect(ctx, barX, barY, barW, 8, 4);
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fill();
  roundedRect(ctx, barX, barY, (barW * progress) / 100, 8, 4);
  ctx.fillStyle = severity === "critical" ? "#ff5b4d" : severity === "warning" ? "#ffbf5a" : "#0f9c90";
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  Object.values(PHASE_START).forEach((startPos) => {
    const tx = barX + barW * (startPos / CYCLE_LENGTH);
    ctx.fillRect(tx, barY - 3, 1.5, 14);
  });

  // ---- telemetry-loss overlay ----
  if (dropout) {
    ctx.fillStyle = "rgba(9, 15, 21, 0.5)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ff9a8f";
    ctx.font = "800 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TELEMETRY LOST — CUT STATE UNVERIFIED", W / 2, H / 2);
    ctx.textAlign = "left";
  }
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

  const path = machineToolTarget(event);
  const rough = machiningProgress(event, "roughing");
  const finish = machiningProgress(event, "finishing");
  const codes = detection?.anomaly_codes || [];
  const loadGap = event.spindle_load_pct === null
    ? null
    : Number(event.spindle_load_pct) - Number(event.expected_load_pct);

  els.cutPhaseLabel.textContent = `${titleCase(event.process_phase)} pass`;
  els.cutProgress.textContent = `${Math.round(cycleProgress(event) * 100)}% cycle`;
  els.toolPosition.textContent = `X ${(clamp(path.nx, 0, 1) * 220).toFixed(1)} / Y ${(clamp(path.ny, 0, 1) * 140).toFixed(1)}`;

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
    renderFactoryMap(payload);
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
  renderFactoryMap(payload);
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

// CSV export runs client-side (equivalent to the Python /api/export.csv endpoint).
const exportButton = document.getElementById("exportButton");
if (exportButton) {
  exportButton.addEventListener("click", () => {
    const csv = window.TwinEngine.toCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "digital_twin_history.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}

document.querySelectorAll("[data-node]").forEach((zone) => {
  const selectZone = () => {
    state.node = zone.dataset.node;
    renderNode();
    activateLearningPath("data-path", { pulse: true });
  };
  zone.addEventListener("click", selectZone);
  zone.addEventListener("keydown", (eventObj) => {
    if (eventObj.key === "Enter" || eventObj.key === " ") {
      eventObj.preventDefault();
      selectZone();
    }
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
if (state.reducedMotion && els.factoryMap && typeof els.factoryMap.pauseAnimations === "function") {
  els.factoryMap.pauseAnimations();
}
tick(4).catch(console.error);
startLoop();
