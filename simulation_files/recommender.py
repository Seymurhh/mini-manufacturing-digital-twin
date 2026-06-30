from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass(frozen=True)
class Recommendation:
    decision: str
    action: str
    confidence: float
    required_check: str
    rationale: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def recommend(event: dict[str, Any], detection: dict[str, Any]) -> Recommendation:
    codes = set(detection.get("anomaly_codes", []))
    severity = detection.get("severity", "normal")
    confidence = float(detection.get("confidence", 0.0))

    if "sensor_dropout" in codes:
        return Recommendation(
            decision="do_not_proceed",
            action="Pause automated decisions until telemetry is restored.",
            confidence=0.97,
            required_check="Verify load, vibration, and temperature sensors before continuing.",
            rationale="The model should not recommend process changes when the data stream is incomplete.",
        )

    if "feed_mismatch" in codes:
        return Recommendation(
            decision="do_not_proceed",
            action="Reject the current parameter set and restore the validated feed-rate window.",
            confidence=max(confidence, 0.9),
            required_check="Confirm the operation phase and active feed override.",
            rationale="Feed rate is outside the validated window for this operation phase.",
        )

    if "chatter_risk" in codes and "load_residual" in codes:
        return Recommendation(
            decision="human_review",
            action="Reduce feed 10-15%, inspect fixturing, and check tool engagement.",
            confidence=max(confidence, 0.88),
            required_check="Confirm vibration trend and inspect the cut surface before resuming nominal parameters.",
            rationale="High vibration with elevated load is consistent with chatter or unstable engagement.",
        )

    if "tool_wear" in codes:
        return Recommendation(
            decision="schedule_intervention",
            action="Schedule tool inspection or replacement at the next safe stop.",
            confidence=max(confidence, 0.84),
            required_check="Compare tool-wear estimate against part count and surface finish.",
            rationale="Tool wear is high enough to affect load, vibration, and dimensional repeatability.",
        )

    if "thermal_drift" in codes:
        return Recommendation(
            decision="human_review",
            action="Check coolant, ambient conditions, and thermal compensation before continuing.",
            confidence=max(confidence, 0.86),
            required_check="Verify temperature sensor and inspect dimensional-critical features.",
            rationale="Actual temperature is above the expected process model and may affect tolerances.",
        )

    if "load_residual" in codes:
        return Recommendation(
            decision="watch",
            action="Continue under observation and compare the next 5-10 samples against expected load.",
            confidence=max(confidence, 0.76),
            required_check="Inspect chip load and part setup if residual persists.",
            rationale="Load is drifting from the expected model but no second signal confirms a hard stop.",
        )

    if severity == "normal":
        return Recommendation(
            decision="proceed",
            action="Continue process under nominal monitoring.",
            confidence=0.92,
            required_check="No additional check required.",
            rationale="Signals are inside expected process limits.",
        )

    return Recommendation(
        decision="watch",
        action="Continue under observation and wait for additional evidence.",
        confidence=confidence,
        required_check="Review recent signal trends.",
        rationale="A weak anomaly signal was detected, but the evidence does not justify stopping the process.",
    )
