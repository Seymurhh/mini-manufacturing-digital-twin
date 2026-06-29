from __future__ import annotations

import argparse
import csv
import json
import mimetypes
from collections import Counter, deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from detector import AnomalyDetector
from recommender import recommend
from simulator import ManufacturingProcessSimulator, write_sample_csv


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
MAX_HISTORY = 180

simulator = ManufacturingProcessSimulator(seed=7)
detector = AnomalyDetector()
history: deque[dict[str, Any]] = deque(maxlen=MAX_HISTORY)


def reset_state() -> None:
    simulator.reset()
    detector.reset()
    history.clear()


def next_record() -> dict[str, Any]:
    event = simulator.next_event().to_dict()
    detection = detector.evaluate(event).to_dict()
    recommendation = recommend(event, detection).to_dict()
    record = {
        "event": event,
        "detection": detection,
        "recommendation": recommendation,
    }
    history.append(record)
    return record


def current_summary() -> dict[str, Any]:
    if not history:
        return {
            "samples": 0,
            "health_score": 100,
            "active_severity": "normal",
            "anomaly_counts": {},
            "phase": "not_started",
        }

    latest = history[-1]
    anomaly_counts: Counter[str] = Counter()
    for record in history:
        for code in record["detection"]["anomaly_codes"]:
            anomaly_counts[code] += 1

    return {
        "samples": len(history),
        "health_score": latest["detection"]["health_score"],
        "active_severity": latest["detection"]["severity"],
        "anomaly_counts": dict(anomaly_counts),
        "phase": latest["event"]["process_phase"],
        "part_id": latest["event"]["part_id"],
        "machine_id": latest["event"]["machine_id"],
        "topic": latest["event"]["topic"],
    }


def response_payload(record: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "latest": record or (history[-1] if history else None),
        "history": list(history),
        "summary": current_summary(),
    }


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "ManufacturingDigitalTwin/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/":
            self._serve_file(STATIC_DIR / "index.html")
        elif path.startswith("/static/"):
            requested = STATIC_DIR / path.removeprefix("/static/")
            self._serve_file(requested)
        elif path == "/api/next":
            params = parse_qs(parsed.query)
            count = int(params.get("count", ["1"])[0])
            count = max(1, min(count, 25))
            record = None
            for _ in range(count):
                record = next_record()
            self._send_json(response_payload(record))
        elif path == "/api/status":
            self._send_json(response_payload())
        elif path == "/api/reset":
            reset_state()
            self._send_json(response_payload())
        elif path == "/api/export.csv":
            self._send_csv()
        elif path == "/data/sample_run.csv":
            self._serve_file(DATA_DIR / "sample_run.csv")
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _send_json(self, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_csv(self) -> None:
        rows = []
        for record in history:
            event = record["event"]
            detection = record["detection"]
            recommendation = record["recommendation"]
            rows.append(
                {
                    **event,
                    "detected_severity": detection["severity"],
                    "detected_codes": "|".join(detection["anomaly_codes"]),
                    "health_score": detection["health_score"],
                    "recommendation_decision": recommendation["decision"],
                    "recommendation_action": recommendation["action"],
                }
            )

        if not rows:
            rows = [{"message": "No samples generated yet."}]

        import io

        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
        encoded = buffer.getvalue().encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="digital_twin_history.csv"')
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _serve_file(self, path: Path) -> None:
        resolved = path.resolve()
        allowed_roots = (STATIC_DIR.resolve(), DATA_DIR.resolve())
        if not any(str(resolved).startswith(str(root)) for root in allowed_roots):
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return
        if not resolved.exists() or not resolved.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        mime_type, _ = mimetypes.guess_type(str(resolved))
        content = resolved.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def run_server(host: str, port: int) -> None:
    server = ThreadingHTTPServer((host, port), DashboardHandler)
    print(f"Mini Manufacturing Digital Twin running at http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the mini manufacturing digital twin dashboard.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--generate-sample", action="store_true")
    parser.add_argument("--sample-count", type=int, default=260)
    args = parser.parse_args()

    if args.generate_sample:
        output = DATA_DIR / "sample_run.csv"
        write_sample_csv(output, count=args.sample_count)
        print(f"Wrote sample data to {output}")
        return

    run_server(args.host, args.port)


if __name__ == "__main__":
    main()
