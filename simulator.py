from __future__ import annotations

import argparse
import csv
import math
import random
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable


PHASES = (
    ("warmup", 28),
    ("roughing", 72),
    ("finishing", 56),
    ("inspection", 24),
)

# Product Lifecycle Management: the released dimensional tolerance for the part feature
# the CMM inspects. Deviations above this drive the QMS non-conformance flow.
PART_TOLERANCE_UM = 25.0


@dataclass(frozen=True)
class ProcessEvent:
    timestamp: str
    sequence: int
    topic: str
    machine_id: str
    part_id: str
    operation: str
    process_phase: str
    spindle_speed_rpm: float
    feed_rate_mm_min: float
    spindle_load_pct: float | None
    vibration_rms: float | None
    temperature_c: float | None
    tool_wear_pct: float
    expected_load_pct: float
    expected_temperature_c: float
    anomaly_label: str
    # Digital-thread enterprise context: the systems of record that surround the machine.
    work_order: str  # MES production order dispatched to the cell
    part_revision: str  # PLM released revision the work order is built to
    tolerance_um: float  # PLM released dimensional tolerance for the inspected feature
    eco_id: str | None  # PLM engineering change order, once a correction is released
    ncr_id: str | None  # QMS non-conformance report, when a part is out of tolerance
    disposition: str | None  # QMS disposition for the non-conformance (rework/scrap/use-as-is)
    cmm_deviation_um: float  # measured deviation from the CMM, fed to the QMS/SPC record
    cmm_verdict: str  # in_tol | out_of_tol
    mes_state: str  # in_process | hold | planning
    oee_pct: float  # machine-data rollup: overall equipment effectiveness

    def to_dict(self) -> dict:
        return asdict(self)


class ManufacturingProcessSimulator:
    """Synthetic CNC process stream with repeatable normal and abnormal behavior."""

    def __init__(self, seed: int = 7) -> None:
        self.seed = seed
        self.random = random.Random(seed)
        self.sequence = 0
        self.start_time = datetime.now(timezone.utc).replace(microsecond=0)
        self.machine_id = "SEAS-CNC-01"
        self.part_id = f"BRACKET-{self.random.randint(1000, 9999)}"
        self.operation = "adaptive_cnc_milling"
        self._last_normal_load = 45.0
        self._oee = 84.0

    def reset(self) -> None:
        self.random = random.Random(self.seed)
        self.sequence = 0
        self.start_time = datetime.now(timezone.utc).replace(microsecond=0)
        self.part_id = f"BRACKET-{self.random.randint(1000, 9999)}"
        self._last_normal_load = 45.0
        self._oee = 84.0

    def next_event(self) -> ProcessEvent:
        phase = self._phase_for_sequence(self.sequence)
        expected_load, expected_temp, rpm, feed = self._expected_values(phase, self.sequence)
        tool_wear = min(98.0, 4.0 + self.sequence * 0.18 + self.random.gauss(0, 0.45))

        label = self._anomaly_for_sequence(self.sequence)
        load = expected_load + self.random.gauss(0, 2.2)
        vibration = self._nominal_vibration(phase) + self.random.gauss(0, 0.04)
        temperature = expected_temp + self.random.gauss(0, 0.75)

        if label == "tool_wear":
            load += 10 + (self.sequence % 16) * 0.5
            vibration += 0.12 + (self.sequence % 10) * 0.015
            tool_wear += 18
        elif label == "chatter":
            load += self.random.uniform(4, 8)
            vibration += self.random.uniform(0.75, 1.35)
        elif label == "thermal_drift":
            temperature += 9 + (self.sequence % 18) * 0.45
            load += 3
        elif label == "feed_mismatch":
            feed *= 2.35
            vibration += 0.28
            load += 8
        elif label == "sensor_dropout":
            # Simulate a partial telemetry failure while preserving the event envelope.
            load = None
            vibration = None
            temperature = None

        if load is not None:
            self._last_normal_load = load

        thread = self._thread_snapshot(self.sequence)

        event_time = self.start_time + timedelta(seconds=self.sequence * 2)
        event = ProcessEvent(
            timestamp=event_time.isoformat(),
            sequence=self.sequence,
            topic=f"factory/{self.machine_id}/process",
            machine_id=self.machine_id,
            part_id=self.part_id,
            operation=self.operation,
            process_phase=phase,
            spindle_speed_rpm=round(rpm, 1),
            feed_rate_mm_min=round(feed, 1),
            spindle_load_pct=round(load, 2) if load is not None else None,
            vibration_rms=round(vibration, 3) if vibration is not None else None,
            temperature_c=round(temperature, 2) if temperature is not None else None,
            tool_wear_pct=round(max(0.0, min(tool_wear, 100.0)), 2),
            expected_load_pct=round(expected_load, 2),
            expected_temperature_c=round(expected_temp, 2),
            anomaly_label=label,
            work_order=thread["work_order"],
            part_revision=thread["part_revision"],
            tolerance_um=thread["tolerance_um"],
            eco_id=thread["eco_id"],
            ncr_id=thread["ncr_id"],
            disposition=thread["disposition"],
            cmm_deviation_um=thread["cmm_deviation_um"],
            cmm_verdict=thread["cmm_verdict"],
            mes_state=thread["mes_state"],
            oee_pct=thread["oee_pct"],
        )
        self.sequence += 1
        return event

    def _thread_snapshot(self, sequence: int) -> dict:
        """Evolve the enterprise systems of record (PLM / MES / QMS / machine data)
        around a repeatable closed-loop event.

        The first part (cycle 0) hits the scripted thermal-drift window during
        finishing, so its finished surface runs hot. When it reaches the CMM in the
        inspection phase it measures out of tolerance, the QMS raises a non-conformance,
        PLM releases an engineering change, and MES re-dispatches the corrected
        revision. Subsequent parts run clean. This mirrors design -> make -> inspect ->
        correct -> re-release, which is the loop the digital thread is meant to close.
        """
        rand = self.random

        rev = "A"
        work_order = "WO-1041"
        mes_state = "in_process"
        ncr_id: str | None = None
        disposition: str | None = None
        eco_id: str | None = None
        verdict = "in_tol"
        deviation = round(8.0 + abs(rand.gauss(0, 1.4)), 1)
        oee_target = 84.0

        if 156 <= sequence <= 179:
            # Part #1 inspected after the finishing thermal drift: out of tolerance.
            mes_state = "hold"
            ncr_id = "NCR-207"
            disposition = "rework"
            verdict = "out_of_tol"
            deviation = round(31.0 + abs(rand.gauss(0, 1.8)), 1)
            eco_id = "ECO-118" if sequence >= 170 else None  # change opened during QMS review
            oee_target = 63.0
        elif 180 <= sequence <= 189:
            # Engineering change in work: PLM revises the part, MES holds the next release.
            mes_state = "planning"
            ncr_id = "NCR-207"
            disposition = "rework"
            verdict = "out_of_tol"
            deviation = round(31.0 + abs(rand.gauss(0, 1.2)), 1)
            eco_id = "ECO-118"
            oee_target = 68.0
        elif sequence >= 190:
            # Corrected process: rev B released, MES re-dispatches on a new work order.
            rev = "B"
            work_order = "WO-1042"
            eco_id = "ECO-118"
            mes_state = "in_process"
            verdict = "in_tol"
            deviation = round(9.0 + abs(rand.gauss(0, 1.1)), 1)
            oee_target = 86.0

        # Smooth OEE toward its target so the machine-data rollup reads like a live KPI.
        self._oee += (oee_target - self._oee) * 0.25

        return {
            "work_order": work_order,
            "part_revision": rev,
            "tolerance_um": PART_TOLERANCE_UM,
            "eco_id": eco_id,
            "ncr_id": ncr_id,
            "disposition": disposition,
            "cmm_deviation_um": deviation,
            "cmm_verdict": verdict,
            "mes_state": mes_state,
            "oee_pct": round(self._oee, 1),
        }

    def generate(self, count: int) -> Iterable[ProcessEvent]:
        for _ in range(count):
            yield self.next_event()

    def _phase_for_sequence(self, sequence: int) -> str:
        cycle_length = sum(length for _, length in PHASES)
        position = sequence % cycle_length
        cursor = 0
        for phase, length in PHASES:
            if cursor <= position < cursor + length:
                return phase
            cursor += length
        return PHASES[-1][0]

    def _expected_values(self, phase: str, sequence: int) -> tuple[float, float, float, float]:
        wave = math.sin(sequence / 11.0)
        if phase == "warmup":
            return 28 + wave * 2.0, 28 + sequence % 20 * 0.12, 4500, 340
        if phase == "roughing":
            return 62 + wave * 4.5, 43 + wave * 1.2, 7800, 820
        if phase == "finishing":
            return 43 + wave * 2.5, 38 + wave * 0.8, 9200, 520
        return 18 + wave * 1.0, 32 + wave * 0.4, 2500, 140

    def _nominal_vibration(self, phase: str) -> float:
        if phase == "roughing":
            return 0.42
        if phase == "finishing":
            return 0.28
        if phase == "warmup":
            return 0.18
        return 0.12

    def _anomaly_for_sequence(self, sequence: int) -> str:
        # Fixed windows make the demo explainable and repeatable.
        if 46 <= sequence <= 54:
            return "chatter"
        if 91 <= sequence <= 108:
            return "tool_wear"
        if 137 <= sequence <= 153:
            return "thermal_drift"
        if 174 <= sequence <= 180:
            return "feed_mismatch"
        if 208 <= sequence <= 213:
            return "sensor_dropout"

        # Add sparse surprises after the scripted windows so long demos keep moving.
        if sequence > 235:
            roll = self.random.random()
            if roll < 0.018:
                return "chatter"
            if roll < 0.032:
                return "thermal_drift"
            if roll < 0.044:
                return "feed_mismatch"
        return "normal"


def write_sample_csv(path: Path, count: int = 260, seed: int = 7) -> None:
    simulator = ManufacturingProcessSimulator(seed=seed)
    events = [event.to_dict() for event in simulator.generate(count)]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(events[0].keys()))
        writer.writeheader()
        writer.writerows(events)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic CNC process data.")
    parser.add_argument("--count", type=int, default=260)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--output", type=Path, default=Path("data/sample_run.csv"))
    args = parser.parse_args()
    write_sample_csv(args.output, count=args.count, seed=args.seed)
    print(f"Wrote {args.count} events to {args.output}")


if __name__ == "__main__":
    main()
