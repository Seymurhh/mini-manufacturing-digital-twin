"""Render a runtime digital-twin monitoring dashboard as an animated GIF.

Drives the project's *actual* simulator -> detector -> recommender pipeline and
animates the resulting live process monitor: spindle load, vibration, and
temperature streaming in against their expected process models, with detected
anomaly windows shaded, a running health score, and the human-in-the-loop
recommendation updating as evidence accrues. This is the runtime ("monitor")
end of the digital thread that the Additive Build Advisor hands off to.

Run:  python examples/make_dashboard_animation.py
Output: output/twin_dashboard.gif
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.animation import FuncAnimation, PillowWriter  # noqa: E402
from matplotlib.gridspec import GridSpec  # noqa: E402

from detector import AnomalyDetector  # noqa: E402
from recommender import recommend  # noqa: E402
from simulator import ManufacturingProcessSimulator  # noqa: E402

# Publication / LaTeX-style look to match the Additive Build Advisor figures.
plt.rcParams.update({
    "font.family": "serif",
    "mathtext.fontset": "cm",
    "axes.titlesize": 10,
    "axes.labelsize": 8.5,
    "xtick.labelsize": 7.5,
    "ytick.labelsize": 7.5,
    "axes.edgecolor": "#3a4350",
    "axes.linewidth": 0.8,
    "figure.facecolor": "white",
})

N_SAMPLES = 214          # covers chatter, tool wear, thermal drift, feed, dropout
STRIDE = 3               # animate every 3rd sample to keep the GIF light
FPS = 8

SEV_COLOR = {
    "normal": "#2f855a",
    "watch": "#d69e2e",
    "warning": "#dd6b20",
    "critical": "#e53e3e",
}
ACTUAL = "#2b6cb0"
EXPECTED = "#8a94a0"
LIMIT = "#c05621"


def _vib_limit(phase: str) -> float:
    return {"roughing": 0.82, "finishing": 0.58, "warmup": 0.42}.get(phase, 0.32)


def _wrap(text: str, width: int = 34) -> str:
    out, line = [], ""
    for word in text.split():
        if len(line) + len(word) + 1 > width:
            out.append(line); line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        out.append(line)
    return "\n".join(out)


def simulate():
    sim = ManufacturingProcessSimulator(seed=7)
    det = AnomalyDetector()
    rows = []
    for _ in range(N_SAMPLES):
        ev = sim.next_event().to_dict()
        dt = det.evaluate(ev).to_dict()
        rc = recommend(ev, dt).to_dict()
        rows.append((ev, dt, rc))
    return rows


def anomaly_segments(severity):
    """Contiguous index runs where severity != normal, with the run's worst severity."""
    order = {"normal": 0, "watch": 1, "warning": 2, "critical": 3}
    segs, start = [], None
    worst = "normal"
    for i, s in enumerate(severity + ["normal"]):
        if s != "normal":
            if start is None:
                start, worst = i, s
            elif order[s] > order[worst]:
                worst = s
        else:
            if start is not None:
                segs.append((start, i - 1, worst))
                start, worst = None, "normal"
    return segs


def main() -> int:
    rows = simulate()
    x = np.arange(N_SAMPLES)
    phase = [r[0]["process_phase"] for r in rows]

    def col(key):
        return np.array([(r[0][key] if r[0][key] is not None else np.nan) for r in rows], float)

    load, load_exp = col("spindle_load_pct"), col("expected_load_pct")
    vib = col("vibration_rms")
    temp, temp_exp = col("temperature_c"), col("expected_temperature_c")
    vlim = np.array([_vib_limit(p) for p in phase])
    health = np.array([r[1]["health_score"] for r in rows])
    severity = [r[1]["severity"] for r in rows]
    segs = anomaly_segments(severity)

    fig = plt.figure(figsize=(10.8, 5.4))
    gs = GridSpec(3, 2, width_ratios=[2.35, 1.0], height_ratios=[1, 1, 1],
                  hspace=0.42, wspace=0.18, left=0.07, right=0.985, top=0.9, bottom=0.1)
    ax_load = fig.add_subplot(gs[0, 0])
    ax_vib = fig.add_subplot(gs[1, 0], sharex=ax_load)
    ax_temp = fig.add_subplot(gs[2, 0], sharex=ax_load)
    ax_stat = fig.add_subplot(gs[:, 1])
    ax_stat.axis("off")

    def shade(ax, idx):
        for s0, s1, sev in segs:
            if s0 > idx:
                continue
            ax.axvspan(s0 - 0.5, min(s1, idx) + 0.5, color=SEV_COLOR[sev], alpha=0.13, lw=0)

    def draw(idx):
        for ax in (ax_load, ax_vib, ax_temp):
            ax.cla()
        s = slice(0, idx + 1)

        ax_load.plot(x[s], load_exp[s], color=EXPECTED, lw=1.1, ls="--", label="expected")
        ax_load.plot(x[s], load[s], color=ACTUAL, lw=1.5, label="actual")
        ax_load.set_ylabel("spindle\nload (\\%)")
        ax_load.set_ylim(0, 95)
        ax_load.legend(loc="upper left", fontsize=6.5, ncol=2, frameon=False)

        ax_vib.plot(x[s], vlim[s], color=LIMIT, lw=1.0, ls="--", label="phase limit")
        ax_vib.plot(x[s], vib[s], color=ACTUAL, lw=1.5, label="actual")
        ax_vib.set_ylabel("vibration\nRMS")
        ax_vib.set_ylim(0, 2.0)
        ax_vib.legend(loc="upper left", fontsize=6.5, ncol=2, frameon=False)

        ax_temp.plot(x[s], temp_exp[s], color=EXPECTED, lw=1.1, ls="--", label="expected")
        ax_temp.plot(x[s], temp[s], color=ACTUAL, lw=1.5, label="actual")
        ax_temp.set_ylabel("temp\n($^\\circ$C)")
        ax_temp.set_xlabel("process sample (2 s cadence)")
        ax_temp.set_ylim(20, 70)
        ax_temp.legend(loc="upper left", fontsize=6.5, ncol=2, frameon=False)

        for ax in (ax_load, ax_vib, ax_temp):
            shade(ax, idx)
            ax.axvline(idx, color="#3a4350", lw=0.9, alpha=0.55)
            ax.set_xlim(0, N_SAMPLES - 1)
            ax.grid(True, color="#e2e8f0", lw=0.6)

        ax_load.set_title("Live telemetry vs. expected process model", fontsize=10)

        # --- status / twin-state panel ---
        ax_stat.cla()
        ax_stat.axis("off")
        ev, dt, rc = rows[idx]
        sev = dt["severity"]
        c = SEV_COLOR[sev]
        for spine_y in (0.0,):
            pass
        ax_stat.add_patch(plt.Rectangle((0.02, 0.02), 0.96, 0.96, transform=ax_stat.transAxes,
                                        fill=False, ec=c, lw=2.2))
        ax_stat.text(0.5, 0.93, "DIGITAL TWIN STATE", transform=ax_stat.transAxes,
                     ha="center", va="top", fontsize=9, fontweight="bold", color="#3a4350")
        ax_stat.text(0.5, 0.80, f"{dt['health_score']}", transform=ax_stat.transAxes,
                     ha="center", va="center", fontsize=34, fontweight="bold", color=c)
        ax_stat.text(0.5, 0.665, "health score", transform=ax_stat.transAxes,
                     ha="center", va="center", fontsize=7.5, color="#5b6b7b")
        ax_stat.text(0.5, 0.595, sev.upper(), transform=ax_stat.transAxes, ha="center", va="center",
                     fontsize=10, fontweight="bold", color="white",
                     bbox=dict(boxstyle="round,pad=0.3", fc=c, ec="none"))

        codes = ", ".join(dt["anomaly_codes"]) if dt["anomaly_codes"] else "none"
        info = (f"phase: {ev['process_phase']}\n"
                f"part: {ev['part_id']}\n"
                f"sample: {idx + 1} / {N_SAMPLES}\n"
                f"flags: {codes}")
        ax_stat.text(0.08, 0.47, info, transform=ax_stat.transAxes, ha="left", va="top",
                     fontsize=7.6, family="monospace", color="#2d3748")

        ax_stat.text(0.08, 0.235, "RECOMMENDATION", transform=ax_stat.transAxes, ha="left",
                     va="top", fontsize=7.5, fontweight="bold", color="#3a4350")
        ax_stat.text(0.08, 0.185, rc["decision"].replace("_", " ").upper(), transform=ax_stat.transAxes,
                     ha="left", va="top", fontsize=8.5, fontweight="bold", color=c)
        ax_stat.text(0.08, 0.135, _wrap(rc["action"], 36), transform=ax_stat.transAxes, ha="left",
                     va="top", fontsize=6.8, color="#2d3748")
        return []

    fig.suptitle("Runtime digital twin — live CNC process monitoring",
                 fontsize=12.5, fontweight="bold", y=0.975)

    frames = list(range(0, N_SAMPLES, STRIDE))
    if frames[-1] != N_SAMPLES - 1:
        frames.append(N_SAMPLES - 1)
    anim = FuncAnimation(fig, draw, frames=frames, interval=1000 / FPS)
    out_dir = ROOT / "output"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / "twin_dashboard.gif"
    anim.save(str(out), writer=PillowWriter(fps=FPS))
    plt.close(fig)
    print(f"Wrote {out}  ({len(frames)} frames, {N_SAMPLES} samples)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
