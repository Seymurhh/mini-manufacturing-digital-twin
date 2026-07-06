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
    verdicts = Counter()
    revisions = set()
    work_orders = set()
    ncrs = set()
    ecos = set()

    thread_fields = {
        "work_order",
        "part_revision",
        "tolerance_um",
        "eco_id",
        "ncr_id",
        "disposition",
        "cmm_deviation_um",
        "cmm_verdict",
        "mes_state",
        "oee_pct",
    }

    for event in simulator.generate(240):
        event_dict = event.to_dict()
        assert thread_fields.issubset(event_dict), "event is missing enterprise thread fields"
        detection = detector.evaluate(event_dict).to_dict()
        rec = recommend(event_dict, detection).to_dict()
        labels[event_dict["anomaly_label"]] += 1
        recommendations[rec["decision"]] += 1
        verdicts[event_dict["cmm_verdict"]] += 1
        revisions.add(event_dict["part_revision"])
        work_orders.add(event_dict["work_order"])
        if event_dict["ncr_id"]:
            ncrs.add(event_dict["ncr_id"])
        if event_dict["eco_id"]:
            ecos.add(event_dict["eco_id"])
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

    # Closed-loop digital thread: a part goes out of tolerance, a non-conformance and an
    # engineering change are raised, and a corrected revision is re-dispatched on a new order.
    assert verdicts["out_of_tol"] > 0, "expected at least one out-of-tolerance inspection"
    assert verdicts["in_tol"] > 0
    assert {"A", "B"}.issubset(revisions), "expected the corrective ECO to release revision B"
    assert len(work_orders) >= 2, "expected MES to re-dispatch a corrected work order"
    assert ncrs, "expected a QMS non-conformance report to be raised"
    assert ecos, "expected a PLM engineering change order to be released"

    print("Smoke test passed")
    print(f"Simulated labels: {dict(labels)}")
    print(f"Detected codes: {dict(detected)}")
    print(f"Recommendations: {dict(recommendations)}")
    print(f"CMM verdicts: {dict(verdicts)}")
    print(f"Revisions: {sorted(revisions)} · work orders: {sorted(work_orders)} · NCRs: {sorted(ncrs)} · ECOs: {sorted(ecos)}")


if __name__ == "__main__":
    main()
