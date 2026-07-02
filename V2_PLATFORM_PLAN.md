# Manufacturing Digital Twin Platform v2 Plan

## Product Goal

Build v2 as an all-in-one engineering education and demonstration platform for manufacturing digital twins. The platform should teach the concepts step by step while showing a realistic CNC machining twin: a physical machine produces telemetry, data protocols move that telemetry through an edge/software stack, a simulation/model runs in parallel, and the operator sees a digital replica with live state, anomaly evidence, and recommended action.

The current project already has the right technical seed: a CNC-style process simulator, expected-vs-actual model, anomaly detector, recommendation engine, API endpoints, live charts, and CSV export. v2 should extend that core instead of discarding it.

## Experience Principles

- Start with the factory floor, not a marketing page.
- Explain each concept by connecting it to a visible system element.
- Make the data path tangible: sensor -> controller/edge -> protocol message -> twin state -> simulation -> dashboard decision.
- Keep the CNC example technically believable, even when data is simulated.
- Show uncertainty and human review rather than pretending the twin fully automates decisions.
- Use interactive controls for exploration: play, pause, step, inject anomaly, inspect sensor, inspect packet, compare physical vs digital.

## Core Platform Layout

The first screen should be a modern engineering operations surface:

- Top telemetry ribbon: machine, part, operation phase, health, severity, sample count, active protocol.
- Main visual area: simplified factory layout with a CNC machine, edge gateway, broker/data layer, simulation model, and human dashboard.
- Animated information flow: sensor readings move from CNC machine to the digital twin platform.
- Digital replica panel: virtual machine state, expected-vs-actual signals, anomaly tags, and recommendation status.
- Learning rail: step-by-step lesson cards that explain the current concept without blocking the live twin.
- Case-study drawer: CNC machining scenario, physical process image/diagram, sensors, data schema, anomaly timeline, and operator response.

## Learning Modules

### 1. What Is a Digital Twin?

Teach that a digital twin is not just a dashboard or CAD model. It is a connected digital representation of a physical system that stays updated with operational data and supports monitoring, simulation, prediction, and decision-making.

Interactive elements:

- Highlight physical asset, data stream, model, digital state, and decision layer.
- Toggle between "dashboard only" and "digital twin" to show the difference.
- Show how expected behavior and live behavior are compared.

### 2. Manufacturing Data Flow

Show how raw machine signals become usable twin state.

Flow:

1. Sensors and controller signals measure the process.
2. Edge gateway normalizes and timestamps readings.
3. Protocol layer publishes messages.
4. Digital twin service validates quality and updates state.
5. Simulation/model compares expected and actual behavior.
6. Dashboard and recommendation logic support the human operator.

Interactive elements:

- Click each node to see role, realistic latency, common failure mode, and example data.
- Animate a telemetry packet moving through the system.
- Show quality flags for missing or stale signals.

### 3. Data Protocols

Teach protocol purpose without becoming abstract.

Protocols to introduce:

- MQTT: lightweight publish/subscribe event streaming, good for telemetry topics like `factory/SEAS-CNC-01/process`.
- OPC UA: industrial interoperability model for machine data, metadata, and structured tags.
- MTConnect: manufacturing equipment data standard commonly used for CNC and machine tools.
- REST/WebSocket: useful for platform APIs and browser updates, less ideal as the only machine-data layer.

Interactive elements:

- Protocol selector that changes the displayed message envelope.
- Live packet inspector with topic, timestamp, machine id, signal values, units, sequence, and quality.
- Failure examples: sensor dropout, delayed packet, invalid unit, out-of-range feed.

### 4. Sensor and Signal Layer

Teach what sensors are used and why.

CNC machining sensor set:

- Spindle load/current: proxy for cutting force and overload.
- Vibration accelerometer: chatter and unstable cutting.
- Temperature sensor or thermal estimate: thermal drift and tolerance risk.
- Spindle speed encoder/controller value: cutting condition verification.
- Feed-rate/controller value: program override and process-window validation.
- Tool wear estimate: inferred from load, vibration, part count, and inspection.
- Optional coolant flow/pressure: thermal control and tool-life context.
- Optional acoustic emission: advanced chatter/tool condition monitoring.

Interactive elements:

- Click sensor hotspots on the CNC machine diagram.
- Show raw value, engineering unit, expected range, sampling rate, and failure mode.
- Connect each sensor to the anomaly detector rule that uses it.

### 5. CNC Machining Case Study

Use one physical process: CNC milling a bracket or similar part.

Scenario:

- Machine: `SEAS-CNC-01`, 3-axis CNC milling center.
- Part: bracket machining cycle.
- Operation phases: warmup, roughing, finishing, inspection.
- Twin objective: monitor stability, thermal behavior, tool wear, feed correctness, and telemetry health.

Parallel physical/digital view:

- Left side: physical CNC process illustration or real machine image.
- Middle: data collection and protocol flow.
- Right side: digital replica with live simulated state and charts.

Anomalies:

- Chatter: vibration spike plus load increase.
- Tool wear: rising load, vibration, and wear estimate.
- Thermal drift: actual temperature above expected model.
- Feed mismatch: feed rate outside validated phase window.
- Sensor dropout: missing data prevents trustworthy automated recommendations.

Operator decisions:

- Proceed when signals are nominal.
- Watch when one weak signal deviates.
- Human review when multiple signals support a process risk.
- Schedule intervention for tool wear.
- Do not proceed when feed is invalid or telemetry is missing.

## Data Model Direction

Keep the current event shape, then add production-style metadata:

- `timestamp`
- `sequence`
- `machine_id`
- `part_id`
- `operation`
- `process_phase`
- `topic`
- `signals`: value, unit, source, quality, expected range
- `expected_model`: expected load, temperature, vibration envelope
- `detection`: severity, health score, anomaly codes, evidence
- `recommendation`: decision, confidence, action, required check

The UI should show that a useful twin needs both values and context: unit, phase, source, timestamp, and quality.

## Implementation Phases

### Phase 1 - Platform Shell and Story

- Replace the simple dashboard layout with an engineering platform shell.
- Add factory-flow visualization and digital twin architecture map.
- Keep existing charts and API working.
- Add lesson navigation for the first three concepts: digital twin, data flow, CNC case study.

Deliverable: a recognizable v2 platform that already teaches the core digital twin loop.

### Phase 2 - Interactive Factory Flow

- Add clickable nodes for CNC machine, sensors, edge gateway, protocol broker, digital twin model, and operator dashboard.
- Add animated data movement between nodes.
- Add packet inspector tied to the latest simulator event.
- Show missing/stale/abnormal signal quality visually.

Deliverable: users can see where data comes from, how it moves, and where decisions are made.

### Phase 3 - Sensor and Protocol Labs

- Add CNC sensor hotspots.
- Add protocol selector for MQTT, OPC UA, MTConnect, and REST/WebSocket.
- Add example message envelopes and realistic field descriptions.
- Add unit, sampling-rate, and failure-mode explanations.

Deliverable: users can learn practical data acquisition concepts interactively.

### Phase 4 - CNC Twin Case Study

- Build the physical-vs-digital split view.
- Add cycle timeline for warmup, roughing, finishing, and inspection.
- Add anomaly timeline and scenario cards.
- Add controls to jump to chatter, tool wear, thermal drift, feed mismatch, and sensor dropout.

Deliverable: the platform demonstrates a realistic CNC machining twin from process to decision.

### Phase 5 - Engineering Polish and Validation

- Improve responsive layout for desktop and tablet.
- Add accessible labels, keyboard support, and stable layout dimensions.
- Add smoke tests for simulator, detector, recommender, and new content/API contracts.
- Update README with v2 run instructions and project narrative.

Deliverable: a polished, explainable platform suitable for demonstrating a realistic manufacturing digital twin workflow.

## First Implementation Slice

The first build should avoid a huge rewrite. The most effective first slice is:

1. Keep the Python server and current `/api/next`, `/api/status`, `/api/reset`, and `/api/export.csv` endpoints.
2. Replace the page structure with a v2 platform shell.
3. Add a simplified factory layout with CNC machine, data path, protocol node, digital twin node, and operator dashboard node.
4. Bind the existing live telemetry to the new visual surface.
5. Add three interactive lesson steps: "What is a twin?", "How data flows", and "CNC machining case study."
6. Keep charts and decision support visible so the technical core remains demonstrable.

This creates a strong first working version while leaving deeper protocol labs, sensor hotspots, and scenario jump controls for the next phases.

## Visual Direction

- Modern, dense engineering interface rather than a landing page.
- Use restrained industrial colors: graphite, white, steel blue, teal, amber, red, green.
- Use clean section bands, not decorative cards inside cards.
- Use diagrams, machine visuals, data-flow lines, status chips, charts, and compact explanatory panels.
- Keep text concise and tied to visible system behavior.
- Make the physical CNC machine and digital replica obvious in the first viewport.

## Technical Notes

- No new backend framework is required for the first v2 version.
- Static HTML/CSS/JavaScript can support the first interactive platform.
- If the platform later needs richer routing, component state, or deployment through Sites, migrate intentionally instead of starting with framework complexity.
- The simulation is synthetic and should be clearly described as such.
- Future production extensions should connect to MQTT, OPC UA, MTConnect, controller APIs, a time-series database, and validated process models.
