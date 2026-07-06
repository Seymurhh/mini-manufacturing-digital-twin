/*
 * twin-engine.js — in-browser port of the Python twin backend.
 *
 * The reference implementation is a small Python service (simulator.py, detector.py,
 * recommender.py, app.py). For static hosting (GitHub Pages, the seymur.net embed) there
 * is no server to run it, so the same logic runs here in the browser and produces the
 * identical `{ latest, history, summary }` payload shape the dashboard already consumes.
 *
 * Keeping both is intentional: the Python service is the "real" architecture, this is the
 * zero-backend replay build. The two must stay behaviourally equivalent.
 */
(function (global) {
  "use strict";

  var PHASES = [
    ["warmup", 28],
    ["roughing", 72],
    ["finishing", 56],
    ["inspection", 24],
  ];
  var CYCLE_LENGTH = PHASES.reduce(function (sum, p) {
    return sum + p[1];
  }, 0);
  var PART_TOLERANCE_UM = 25.0;
  var MAX_HISTORY = 180;

  // ---- deterministic PRNG so reset() replays the same run ----------------------------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Rng(seed) {
    this.seed = seed;
    this._next = mulberry32(seed);
    this._spare = null;
  }
  Rng.prototype.random = function () {
    return this._next();
  };
  Rng.prototype.uniform = function (lo, hi) {
    return lo + (hi - lo) * this._next();
  };
  Rng.prototype.randint = function (lo, hi) {
    return lo + Math.floor(this._next() * (hi - lo + 1));
  };
  Rng.prototype.gauss = function (mu, sigma) {
    // Box–Muller with a cached spare, mirroring Python's random.gauss usage.
    if (this._spare !== null) {
      var s = this._spare;
      this._spare = null;
      return mu + sigma * s;
    }
    var u1 = Math.max(this._next(), 1e-12);
    var u2 = this._next();
    var mag = Math.sqrt(-2.0 * Math.log(u1));
    this._spare = mag * Math.sin(2 * Math.PI * u2);
    return mu + sigma * (mag * Math.cos(2 * Math.PI * u2));
  };

  function round(value, digits) {
    var f = Math.pow(10, digits);
    return Math.round(value * f) / f;
  }
  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }
  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }
  function pstdev(arr) {
    if (!arr.length) return 0;
    var m = mean(arr);
    var v = arr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / arr.length;
    return Math.sqrt(v);
  }

  // ---- simulator ---------------------------------------------------------------------
  function Simulator(seed) {
    this.seedValue = seed == null ? 7 : seed;
    this.reset();
  }
  Simulator.prototype.reset = function () {
    this.rng = new Rng(this.seedValue);
    this.sequence = 0;
    this.startTime = Date.now();
    this.machineId = "SEAS-CNC-01";
    this.partId = "BRACKET-" + this.rng.randint(1000, 9999);
    this.operation = "adaptive_cnc_milling";
    this._lastNormalLoad = 45.0;
    this._oee = 84.0;
  };
  Simulator.prototype._phaseForSequence = function (seq) {
    var position = ((seq % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
    var cursor = 0;
    for (var i = 0; i < PHASES.length; i++) {
      if (cursor <= position && position < cursor + PHASES[i][1]) return PHASES[i][0];
      cursor += PHASES[i][1];
    }
    return PHASES[PHASES.length - 1][0];
  };
  Simulator.prototype._expectedValues = function (phase, seq) {
    var wave = Math.sin(seq / 11.0);
    if (phase === "warmup") return [28 + wave * 2.0, 28 + ((seq % 20) * 0.12), 4500, 340];
    if (phase === "roughing") return [62 + wave * 4.5, 43 + wave * 1.2, 7800, 820];
    if (phase === "finishing") return [43 + wave * 2.5, 38 + wave * 0.8, 9200, 520];
    return [18 + wave * 1.0, 32 + wave * 0.4, 2500, 140];
  };
  Simulator.prototype._nominalVibration = function (phase) {
    if (phase === "roughing") return 0.42;
    if (phase === "finishing") return 0.28;
    if (phase === "warmup") return 0.18;
    return 0.12;
  };
  Simulator.prototype._anomalyForSequence = function (seq) {
    if (seq >= 46 && seq <= 54) return "chatter";
    if (seq >= 91 && seq <= 108) return "tool_wear";
    if (seq >= 137 && seq <= 153) return "thermal_drift";
    if (seq >= 174 && seq <= 180) return "feed_mismatch";
    if (seq >= 208 && seq <= 213) return "sensor_dropout";
    if (seq > 235) {
      var roll = this.rng.random();
      if (roll < 0.018) return "chatter";
      if (roll < 0.032) return "thermal_drift";
      if (roll < 0.044) return "feed_mismatch";
    }
    return "normal";
  };
  Simulator.prototype._threadSnapshot = function (seq) {
    var rng = this.rng;
    var rev = "A";
    var workOrder = "WO-1041";
    var mesState = "in_process";
    var ncrId = null;
    var disposition = null;
    var ecoId = null;
    var verdict = "in_tol";
    var deviation = round(8.0 + Math.abs(rng.gauss(0, 1.4)), 1);
    var oeeTarget = 84.0;

    if (seq >= 156 && seq <= 179) {
      mesState = "hold";
      ncrId = "NCR-207";
      disposition = "rework";
      verdict = "out_of_tol";
      deviation = round(31.0 + Math.abs(rng.gauss(0, 1.8)), 1);
      ecoId = seq >= 170 ? "ECO-118" : null;
      oeeTarget = 63.0;
    } else if (seq >= 180 && seq <= 189) {
      mesState = "planning";
      ncrId = "NCR-207";
      disposition = "rework";
      verdict = "out_of_tol";
      deviation = round(31.0 + Math.abs(rng.gauss(0, 1.2)), 1);
      ecoId = "ECO-118";
      oeeTarget = 68.0;
    } else if (seq >= 190) {
      rev = "B";
      workOrder = "WO-1042";
      ecoId = "ECO-118";
      mesState = "in_process";
      verdict = "in_tol";
      deviation = round(9.0 + Math.abs(rng.gauss(0, 1.1)), 1);
      oeeTarget = 86.0;
    }

    this._oee += (oeeTarget - this._oee) * 0.25;

    return {
      work_order: workOrder,
      part_revision: rev,
      tolerance_um: PART_TOLERANCE_UM,
      eco_id: ecoId,
      ncr_id: ncrId,
      disposition: disposition,
      cmm_deviation_um: deviation,
      cmm_verdict: verdict,
      mes_state: mesState,
      oee_pct: round(this._oee, 1),
    };
  };
  Simulator.prototype.nextEvent = function () {
    var seq = this.sequence;
    var phase = this._phaseForSequence(seq);
    var exp = this._expectedValues(phase, seq);
    var expectedLoad = exp[0], expectedTemp = exp[1], rpm = exp[2], feed = exp[3];
    var toolWear = Math.min(98.0, 4.0 + seq * 0.18 + this.rng.gauss(0, 0.45));

    var label = this._anomalyForSequence(seq);
    var load = expectedLoad + this.rng.gauss(0, 2.2);
    var vibration = this._nominalVibration(phase) + this.rng.gauss(0, 0.04);
    var temperature = expectedTemp + this.rng.gauss(0, 0.75);

    if (label === "tool_wear") {
      load += 10 + (seq % 16) * 0.5;
      vibration += 0.12 + (seq % 10) * 0.015;
      toolWear += 18;
    } else if (label === "chatter") {
      load += this.rng.uniform(4, 8);
      vibration += this.rng.uniform(0.75, 1.35);
    } else if (label === "thermal_drift") {
      temperature += 9 + (seq % 18) * 0.45;
      load += 3;
    } else if (label === "feed_mismatch") {
      feed *= 2.35;
      vibration += 0.28;
      load += 8;
    } else if (label === "sensor_dropout") {
      load = null;
      vibration = null;
      temperature = null;
    }

    if (load !== null) this._lastNormalLoad = load;

    var thread = this._threadSnapshot(seq);
    var eventTime = new Date(this.startTime + seq * 2000).toISOString();

    var event = {
      timestamp: eventTime,
      sequence: seq,
      topic: "factory/" + this.machineId + "/process",
      machine_id: this.machineId,
      part_id: this.partId,
      operation: this.operation,
      process_phase: phase,
      spindle_speed_rpm: round(rpm, 1),
      feed_rate_mm_min: round(feed, 1),
      spindle_load_pct: load !== null ? round(load, 2) : null,
      vibration_rms: vibration !== null ? round(vibration, 3) : null,
      temperature_c: temperature !== null ? round(temperature, 2) : null,
      tool_wear_pct: round(clamp(toolWear, 0.0, 100.0), 2),
      expected_load_pct: round(expectedLoad, 2),
      expected_temperature_c: round(expectedTemp, 2),
      anomaly_label: label,
      work_order: thread.work_order,
      part_revision: thread.part_revision,
      tolerance_um: thread.tolerance_um,
      eco_id: thread.eco_id,
      ncr_id: thread.ncr_id,
      disposition: thread.disposition,
      cmm_deviation_um: thread.cmm_deviation_um,
      cmm_verdict: thread.cmm_verdict,
      mes_state: thread.mes_state,
      oee_pct: thread.oee_pct,
    };
    this.sequence += 1;
    return event;
  };

  // ---- detector ----------------------------------------------------------------------
  function Detector(windowSize) {
    this.windowSize = windowSize || 24;
    this.reset();
  }
  Detector.prototype.reset = function () {
    this.loadResiduals = [];
    this.temperatureResiduals = [];
    this.vibrationValues = [];
    this.recentHealth = [];
  };
  Detector.prototype._push = function (arr, value, maxlen) {
    arr.push(value);
    if (arr.length > maxlen) arr.shift();
  };
  Detector.prototype._zscore = function (value, history) {
    if (history.length < 8) return 0.0;
    var m = mean(history);
    var sd = pstdev(history);
    if (sd < 1e-6) return 0.0;
    return (value - m) / sd;
  };
  Detector.prototype._vibrationLimit = function (phase) {
    if (phase === "roughing") return 0.82;
    if (phase === "finishing") return 0.58;
    if (phase === "warmup") return 0.42;
    return 0.32;
  };
  Detector.prototype._feedInRange = function (phase, feed) {
    var windows = {
      warmup: [240, 460],
      roughing: [650, 980],
      finishing: [410, 660],
      inspection: [90, 220],
    };
    var w = windows[phase] || [0, 2000];
    return w[0] <= feed && feed <= w[1];
  };
  Detector.prototype._result = function (codes, evidence, penalty) {
    var health = clamp(100 - penalty, 0, 100);
    this._push(this.recentHealth, health, 12);
    var smoothed = this.recentHealth.length ? Math.round(mean(this.recentHealth)) : health;

    var severity, confidence;
    if (!codes.length) {
      severity = "normal";
      confidence = 0.92;
      evidence = ["Signals are within expected process limits."];
    } else if (penalty >= 42) {
      severity = "critical";
      confidence = Math.min(0.98, 0.72 + penalty / 100);
    } else if (penalty >= 24) {
      severity = "warning";
      confidence = Math.min(0.94, 0.62 + penalty / 120);
    } else {
      severity = "watch";
      confidence = Math.min(0.88, 0.55 + penalty / 150);
    }

    return {
      anomaly_detected: codes.length > 0,
      severity: severity,
      health_score: Math.round(smoothed),
      confidence: round(confidence, 2),
      anomaly_codes: codes,
      evidence: evidence,
    };
  };
  Detector.prototype.evaluate = function (event) {
    var codes = [];
    var evidence = [];
    var penalty = 0;

    var load = event.spindle_load_pct;
    var expectedLoad = event.expected_load_pct;
    var temp = event.temperature_c;
    var expectedTemp = event.expected_temperature_c;
    var vibration = event.vibration_rms;
    var feed = event.feed_rate_mm_min;
    var phase = event.process_phase;
    var toolWear = event.tool_wear_pct || 0;

    if (load === null || temp === null || vibration === null) {
      codes.push("sensor_dropout");
      evidence.push("Telemetry dropped out for load, vibration, or temperature.");
      penalty += 38;
      return this._result(codes, evidence, penalty);
    }

    var loadResidual = load - expectedLoad;
    var tempResidual = temp - expectedTemp;
    var loadZ = this._zscore(loadResidual, this.loadResiduals);
    var tempZ = this._zscore(tempResidual, this.temperatureResiduals);
    var vibrationZ = this._zscore(vibration, this.vibrationValues);

    if (Math.abs(loadResidual) > 11 || Math.abs(loadZ) > 2.8) {
      codes.push("load_residual");
      evidence.push("Spindle load is " + (loadResidual >= 0 ? "+" : "") + loadResidual.toFixed(1) + " percentage points from expected.");
      penalty += 18;
    }
    if (tempResidual > 7.0 || tempZ > 2.8) {
      codes.push("thermal_drift");
      evidence.push("Temperature is " + (tempResidual >= 0 ? "+" : "") + tempResidual.toFixed(1) + " C above expected process behavior.");
      penalty += 20;
    }
    if (vibration > this._vibrationLimit(phase) || vibrationZ > 3.0) {
      codes.push("chatter_risk");
      evidence.push("Vibration RMS is " + vibration.toFixed(2) + ", above the phase limit.");
      penalty += 22;
    }
    if (toolWear >= 32) {
      codes.push("tool_wear");
      evidence.push("Estimated tool wear is " + toolWear.toFixed(1) + "%.");
      penalty += 15;
    }
    if (!this._feedInRange(phase, feed)) {
      codes.push("feed_mismatch");
      evidence.push("Feed rate " + feed.toFixed(0) + " mm/min is outside the " + phase + " window.");
      penalty += 18;
    }

    this._push(this.loadResiduals, loadResidual, this.windowSize);
    this._push(this.temperatureResiduals, tempResidual, this.windowSize);
    this._push(this.vibrationValues, vibration, this.windowSize);
    return this._result(codes, evidence, penalty);
  };

  // ---- recommender -------------------------------------------------------------------
  function recommend(event, detection) {
    var codes = detection.anomaly_codes || [];
    var has = function (c) { return codes.indexOf(c) !== -1; };
    var severity = detection.severity || "normal";
    var confidence = Number(detection.confidence || 0);
    var maxc = function (v) { return Math.max(confidence, v); };

    if (has("sensor_dropout")) {
      return {
        decision: "do_not_proceed",
        action: "Pause automated decisions until telemetry is restored.",
        confidence: 0.97,
        required_check: "Verify load, vibration, and temperature sensors before continuing.",
        rationale: "The model should not recommend process changes when the data stream is incomplete.",
      };
    }
    if (has("feed_mismatch")) {
      return {
        decision: "do_not_proceed",
        action: "Reject the current parameter set and restore the validated feed-rate window.",
        confidence: maxc(0.9),
        required_check: "Confirm the operation phase and active feed override.",
        rationale: "Feed rate is outside the validated window for this operation phase.",
      };
    }
    if (has("chatter_risk") && has("load_residual")) {
      return {
        decision: "human_review",
        action: "Reduce feed 10-15%, inspect fixturing, and check tool engagement.",
        confidence: maxc(0.88),
        required_check: "Confirm vibration trend and inspect the cut surface before resuming nominal parameters.",
        rationale: "High vibration with elevated load is consistent with chatter or unstable engagement.",
      };
    }
    if (has("tool_wear")) {
      return {
        decision: "schedule_intervention",
        action: "Schedule tool inspection or replacement at the next safe stop.",
        confidence: maxc(0.84),
        required_check: "Compare tool-wear estimate against part count and surface finish.",
        rationale: "Tool wear is high enough to affect load, vibration, and dimensional repeatability.",
      };
    }
    if (has("thermal_drift")) {
      return {
        decision: "human_review",
        action: "Check coolant, ambient conditions, and thermal compensation before continuing.",
        confidence: maxc(0.86),
        required_check: "Verify temperature sensor and inspect dimensional-critical features.",
        rationale: "Actual temperature is above the expected process model and may affect tolerances.",
      };
    }
    if (has("load_residual")) {
      return {
        decision: "watch",
        action: "Continue under observation and compare the next 5-10 samples against expected load.",
        confidence: maxc(0.76),
        required_check: "Inspect chip load and part setup if residual persists.",
        rationale: "Load is drifting from the expected model but no second signal confirms a hard stop.",
      };
    }
    if (severity === "normal") {
      return {
        decision: "proceed",
        action: "Continue process under nominal monitoring.",
        confidence: 0.92,
        required_check: "No additional check required.",
        rationale: "Signals are inside expected process limits.",
      };
    }
    return {
      decision: "watch",
      action: "Continue under observation and wait for additional evidence.",
      confidence: confidence,
      required_check: "Review recent signal trends.",
      rationale: "A weak anomaly signal was detected, but the evidence does not justify stopping the process.",
    };
  }

  // ---- orchestrator (mirrors app.py) -------------------------------------------------
  function Engine(seed) {
    this.simulator = new Simulator(seed);
    this.detector = new Detector();
    this.history = [];
  }
  Engine.prototype.reset = function () {
    this.simulator.reset();
    this.detector.reset();
    this.history = [];
    return this.payload(null);
  };
  Engine.prototype._nextRecord = function () {
    var event = this.simulator.nextEvent();
    var detection = this.detector.evaluate(event);
    var recommendation = recommend(event, detection);
    var record = { event: event, detection: detection, recommendation: recommendation };
    this.history.push(record);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    return record;
  };
  Engine.prototype.next = function (count) {
    var n = Math.max(1, Math.min(count || 1, 25));
    var record = null;
    for (var i = 0; i < n; i++) record = this._nextRecord();
    return this.payload(record);
  };
  Engine.prototype.summary = function () {
    if (!this.history.length) {
      return { samples: 0, health_score: 100, active_severity: "normal", anomaly_counts: {}, phase: "not_started" };
    }
    var latest = this.history[this.history.length - 1];
    var counts = {};
    this.history.forEach(function (r) {
      r.detection.anomaly_codes.forEach(function (c) {
        counts[c] = (counts[c] || 0) + 1;
      });
    });
    return {
      samples: this.history.length,
      health_score: latest.detection.health_score,
      active_severity: latest.detection.severity,
      anomaly_counts: counts,
      phase: latest.event.process_phase,
      part_id: latest.event.part_id,
      machine_id: latest.event.machine_id,
      topic: latest.event.topic,
    };
  };
  Engine.prototype.payload = function (record) {
    var latest = record || (this.history.length ? this.history[this.history.length - 1] : null);
    return { latest: latest, history: this.history.slice(), summary: this.summary() };
  };

  // CSV export equivalent to app.py's /api/export.csv
  Engine.prototype.toCsv = function () {
    if (!this.history.length) return "message\nNo samples generated yet.\n";
    var rows = this.history.map(function (r) {
      var out = {};
      Object.keys(r.event).forEach(function (k) { out[k] = r.event[k]; });
      out.detected_severity = r.detection.severity;
      out.detected_codes = r.detection.anomaly_codes.join("|");
      out.health_score = r.detection.health_score;
      out.recommendation_decision = r.recommendation.decision;
      out.recommendation_action = r.recommendation.action;
      return out;
    });
    var fields = Object.keys(rows[0]);
    var esc = function (v) {
      if (v === null || v === undefined) v = "";
      v = String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var lines = [fields.join(",")];
    rows.forEach(function (row) {
      lines.push(fields.map(function (f) { return esc(row[f]); }).join(","));
    });
    return lines.join("\n") + "\n";
  };

  global.TwinEngine = new Engine(7);
})(window);
