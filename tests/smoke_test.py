from __future__ import annotations

from collections import Counter
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from detector import AnomalyDetector
from recommender import recommend
from simulator import ManufacturingProcessSimulator


def main() -> None:
    simulator = ManufacturingProcessSimulator(seed=7)
    detector = AnomalyDetector()
    detected = Counter()
    labels = Counter()
    recommendations = Counter()

    for event in simulator.generate(240):
        event_dict = event.to_dict()
        detection = detector.evaluate(event_dict).to_dict()
        rec = recommend(event_dict, detection).to_dict()
        labels[event_dict["anomaly_label"]] += 1
        recommendations[rec["decision"]] += 1
        for code in detection["anomaly_codes"]:
            detected[code] += 1

    assert labels["chatter"] > 0
    assert labels["tool_wear"] > 0
    assert labels["thermal_drift"] > 0
    assert labels["feed_mismatch"] > 0
    assert labels["sensor_dropout"] > 0
    assert detected["chatter_risk"] > 0
    assert detected["thermal_drift"] > 0
    assert detected["tool_wear"] > 0
    assert recommendations["human_review"] > 0
    assert recommendations["do_not_proceed"] > 0

    print("Smoke test passed")
    print(f"Simulated labels: {dict(labels)}")
    print(f"Detected codes: {dict(detected)}")
    print(f"Recommendations: {dict(recommendations)}")


if __name__ == "__main__":
    main()
