# Mini Manufacturing Digital Twin - Simulation Files

This folder contains the standalone simulation pieces from the mini manufacturing digital twin demo.

## Contents

- `simulator.py` - CNC-style process telemetry generator with repeatable anomaly windows.
- `detector.py` - transparent anomaly detector for load residuals, chatter, thermal drift, feed mismatch, tool wear, and sensor dropout.
- `recommender.py` - human-in-the-loop recommendation logic.
- `app.py` - local dashboard/API runner.
- `static/` - browser dashboard files used by `app.py`.
- `data/sample_run.csv` - deterministic sample simulation run.
- `tests/smoke_test.py` - quick validation that all anomaly types are generated and detected.
- `docs/Technical_Report.md` - detailed technical report.
- `docs/Technical_Report.pdf` - PDF version of the technical report.

## Run From This Folder

```bash
python3 app.py
```

Then open:

```text
http://127.0.0.1:8765
```

## Smoke Test

```bash
python3 tests/smoke_test.py
```

The expected result starts with:

```text
Smoke test passed
```
