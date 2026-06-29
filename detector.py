from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass, asdict
from typing import Any


@dataclass(frozen=True)
class DetectionResult:
    anomaly_detected: bool
    severity: str
    health_score: int
    confidence: float
    anomaly_codes: list[str]
    evidence: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AnomalyDetector:
    """Lightweight detector for a simulated manufacturing process stream."""

    def __init__(self, window_size: int = 24) -> None:
        self.window_size = window_size
        self.load_residuals: deque[float] = deque(maxlen=window_size)
        self.temperature_residuals: deque[float] = deque(maxlen=window_size)
        self.vibration_values: deque[float] = deque(maxlen=window_size)
        self.recent_health: deque[int] = deque(maxlen=12)

    def reset(self) -> None:
        self.load_residuals.clear()
        self.temperature_residuals.clear()
        self.vibration_values.clear()
        self.recent_health.clear()

    def evaluate(self, event: dict[str, Any]) -> DetectionResult:
        codes: list[str] = []
        evidence: list[str] = []
        penalty = 0

        load = event.get("spindle_load_pct")
        expected_load = event.get("expected_load_pct")
        temp = event.get("temperature_c")
        expected_temp = event.get("expected_temperature_c")
        vibration = event.get("vibration_rms")
        feed = event.get("feed_rate_mm_min")
        phase = event.get("process_phase")
        tool_wear = event.get("tool_wear_pct", 0)

        if load is None or temp is None or vibration is None:
            codes.append("sensor_dropout")
            evidence.append("Telemetry dropped out for load, vibration, or temperature.")
            penalty += 38
            return self._result(codes, evidence, penalty)

        load_residual = float(load) - float(expected_load)
        temp_residual = float(temp) - float(expected_temp)

        load_z = self._z_score(load_residual, self.load_residuals)
        temp_z = self._z_score(temp_residual, self.temperature_residuals)
        vibration_z = self._z_score(float(vibration), self.vibration_values)

        if abs(load_residual) > 11 or abs(load_z) > 2.8:
            codes.append("load_residual")
            evidence.append(
                f"Spindle load is {load_residual:+.1f} percentage points from expected."
            )
            penalty += 18

        if temp_residual > 7.0 or temp_z > 2.8:
            codes.append("thermal_drift")
            evidence.append(
                f"Temperature is {temp_residual:+.1f} C above expected process behavior."
            )
            penalty += 20

        if float(vibration) > self._vibration_limit(str(phase)) or vibration_z > 3.0:
            codes.append("chatter_risk")
            evidence.append(f"Vibration RMS is {float(vibration):.2f}, above the phase limit.")
            penalty += 22

        if float(tool_wear) >= 32:
            codes.append("tool_wear")
            evidence.append(f"Estimated tool wear is {float(tool_wear):.1f}%.")
            penalty += 15

        if not self._feed_in_range(str(phase), float(feed)):
            codes.append("feed_mismatch")
            evidence.append(f"Feed rate {float(feed):.0f} mm/min is outside the {phase} window.")
            penalty += 18

        self.load_residuals.append(load_residual)
        self.temperature_residuals.append(temp_residual)
        self.vibration_values.append(float(vibration))
        return self._result(codes, evidence, penalty)

    def _result(self, codes: list[str], evidence: list[str], penalty: int) -> DetectionResult:
        health = max(0, min(100, 100 - penalty))
        self.recent_health.append(health)
        smoothed_health = round(statistics.mean(self.recent_health)) if self.recent_health else health

        if not codes:
            severity = "normal"
            confidence = 0.92
            evidence = ["Signals are within expected process limits."]
        elif penalty >= 42:
            severity = "critical"
            confidence = min(0.98, 0.72 + penalty / 100)
        elif penalty >= 24:
            severity = "warning"
            confidence = min(0.94, 0.62 + penalty / 120)
        else:
            severity = "watch"
            confidence = min(0.88, 0.55 + penalty / 150)

        return DetectionResult(
            anomaly_detected=bool(codes),
            severity=severity,
            health_score=int(smoothed_health),
            confidence=round(confidence, 2),
            anomaly_codes=codes,
            evidence=evidence,
        )

    @staticmethod
    def _z_score(value: float, history: deque[float]) -> float:
        if len(history) < 8:
            return 0.0
        mean = statistics.mean(history)
        stdev = statistics.pstdev(history)
        if stdev < 1e-6:
            return 0.0
        return (value - mean) / stdev

    @staticmethod
    def _vibration_limit(phase: str) -> float:
        if phase == "roughing":
            return 0.82
        if phase == "finishing":
            return 0.58
        if phase == "warmup":
            return 0.42
        return 0.32

    @staticmethod
    def _feed_in_range(phase: str, feed: float) -> bool:
        windows = {
            "warmup": (240, 460),
            "roughing": (650, 980),
            "finishing": (410, 660),
            "inspection": (90, 220),
        }
        low, high = windows.get(phase, (0, 2000))
        return low <= feed <= high
