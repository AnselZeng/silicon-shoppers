"""Figure 3: held-out R^2 of the live session model by number of events seen.

    python paper/figures/make_session_r2.py

Reads the numbers straight from the model the store ships
(frontend/public/model/session_model.json, field r2_by_events: the single-visit
table the UI gate uses) and writes session-r2.pdf next to this file.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = Path(__file__).resolve().parent
MODEL = HERE.parents[1] / "frontend" / "public" / "model" / "session_model.json"

# target in the model file -> label in the figure, in fixed color order
SERIES = [
    ("click_to_cart", "click-to-cart", "#2a78d6"),
    ("browsing_pace", "browsing pace", "#eb6834"),
    ("exploration", "exploration", "#1baf7a"),
    ("cart_to_order", "cart-to-order", "#eda100"),
]
INK, MUTED, GRID = "#1f2328", "#5b6470", "#e3e6ea"


def use_paper_font() -> None:
    """Linux Biolinum, the paper's sans, when the TeX tree has it; otherwise the default sans."""
    for root in (Path.home() / "texmf", Path("/usr/share/texlive/texmf-dist"), Path("/usr/share/fonts")):
        for path in root.rglob("LinBiolinum_R*.otf"):
            font_manager.fontManager.addfont(str(path))
    names = {f.name for f in font_manager.fontManager.ttflist}
    if "Linux Biolinum O" in names:
        plt.rcParams["font.family"] = "Linux Biolinum O"


def main(model_path: Path = MODEL) -> None:
    model = json.loads(model_path.read_text())
    gate = float(model["min_r2"])
    use_paper_font()
    plt.rcParams.update({"font.size": 7, "pdf.fonttype": 42, "axes.unicode_minus": False})

    fig, ax = plt.subplots(figsize=(3.33, 1.15))
    for key, label, color in SERIES:
        table = model["targets"][key]["r2_by_events"]
        xs = sorted(int(n) for n in table)
        ys = [table[str(n)] for n in xs]
        ax.plot(xs, ys, color=color, lw=1.3, solid_capstyle="round", solid_joinstyle="round",
                marker="o", ms=3.4, mec="white", mew=0.7, zorder=3)
        # label at the line end, in text ink; the line beside it carries the color
        ax.annotate(f"{label}  {ys[-1]:.2f}", (xs[-1], ys[-1]), xytext=(5, 0), textcoords="offset points",
                    va="center", ha="left", color=INK, fontsize=6.6)

    ax.axhline(gate, color=INK, lw=0.6, zorder=2)
    ax.annotate(f"gate  {gate:.2f}", (6.6, gate), xytext=(0, 1.5), textcoords="offset points",
                va="bottom", ha="left", color=MUTED, fontsize=6.6)

    ax.set_xscale("log")
    ax.set_xticks([3, 5, 10, 20, 40], labels=["3", "5", "10", "20", "40"])
    ax.minorticks_off()
    ax.set_xlim(2.7, 44)
    ax.set_ylim(0, 0.56)
    ax.set_yticks([0, 0.1, 0.2, 0.3, 0.4, 0.5])
    ax.set_xlabel("events seen in the session", color=MUTED, labelpad=1.5)
    ax.set_ylabel("held-out R\u00b2", color=MUTED, labelpad=2)
    ax.grid(axis="y", color=GRID, lw=0.5)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(axis="both", length=0, colors=MUTED, pad=2)

    fig.subplots_adjust(left=0.105, right=0.735, top=0.97, bottom=0.275)
    fig.savefig(HERE / "session-r2.pdf")
    print("wrote", HERE / "session-r2.pdf")


if __name__ == "__main__":
    main()
