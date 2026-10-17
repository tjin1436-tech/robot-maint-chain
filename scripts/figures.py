import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

R = sys.argv[1]; OUT = sys.argv[2]
INK, INK2, MUTED, GRID = "#0b0b0b", "#52514e", "#898781", "#e1e0d9"
SEQ = LinearSegmentedColormap.from_list("blue", ["#f4f8fd", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])
plt.rcParams.update({"font.family": "Liberation Sans", "font.size": 10, "axes.edgecolor": MUTED, "axes.labelcolor": INK2,
                     "xtick.color": INK2, "ytick.color": INK2, "figure.dpi": 200})

# ---- Figure: ablation matrix ----
ab = json.load(open(f"{R}/ablation.json"))
rows = ab["attacks"]
M = [[r["admitted"][j] for j in range(5)] for r in rows]
cols = ["V0\nRBAC only", "V1\n+prerequisite", "V2\n+source", "V3\n+consistency", "V4\nfull"]
fig, ax = plt.subplots(figsize=(7.4, 6.0))
ax.imshow(M, cmap=SEQ, vmin=0, vmax=20, aspect="auto")
for i, r in enumerate(M):
    for j, v in enumerate(r):
        ax.text(j, i, str(v), ha="center", va="center", fontsize=9, color="#ffffff" if v >= 12 else INK)
ax.set_xticks(range(5), cols, fontsize=8.5)
labels = [f'{r["id"]} {r["name"]}  [{r["layer"]}]' for r in rows]
ax.set_yticks(range(len(rows)), labels, fontsize=8.5)
ax.set_xticks([x - 0.5 for x in range(1, 5)], minor=True); ax.set_yticks([y - 0.5 for y in range(1, len(rows))], minor=True)
ax.grid(which="minor", color="#fcfcfb", linewidth=2); ax.tick_params(which="minor", length=0); ax.tick_params(length=0)
for s in ax.spines.values(): s.set_visible(False)
ax.xaxis.tick_top()
tot = ab["totals"]
ax.set_xlabel("Invalid records admitted (out of 20 attempts per cell)", color=INK2, fontsize=8.5, labelpad=8)
fig.tight_layout(); fig.savefig(f"{OUT}/fig_ablation_matrix.png", facecolor="#ffffff"); plt.close(fig)

# ---- Figure: gas per complete maintenance cycle ----
g = json.load(open(f"{R}/gas.json"))
ops = ["uploadData", "submitDiagnosis", "createOrder", "checkIn", "submitReport", "submitVerification", "countersign"]
names = ["V0 RBAC only", "V1 +prerequisite", "V2 +source", "V3 +consistency", "V4 full", "Monolithic", "Anchor-only"]
tot = []
for n in names:
    o = g["variants"][n]["ops"]
    use = ops if n in ("V4 full", "Monolithic", "Anchor-only") else ops[:-1]
    tot.append(sum(o[k]["gas"]["mean"] for k in use) / 1000)
fig, ax = plt.subplots(figsize=(7.0, 3.4))
y = list(range(len(names)))[::-1]
colors = ["#86b6ef"] * 4 + ["#2a78d6", "#89878133", "#89878133"]
colors = ["#86b6ef", "#86b6ef", "#86b6ef", "#86b6ef", "#2a78d6", "#c3c2b7", "#c3c2b7"]
ax.barh(y, tot, color=colors, height=0.62)
for yi, t in zip(y, tot): ax.text(t + 8, yi, f"{t:,.0f}k", va="center", fontsize=9, color=INK)
ax.set_yticks(y, names); ax.set_xlabel("Mean gas per complete maintenance cycle (thousand units, n = 200 cycles)")
ax.set_xlim(0, max(tot) * 1.15); ax.grid(axis="x", color=GRID, linewidth=0.8); ax.set_axisbelow(True)
for s in ["top", "right", "left"]: ax.spines[s].set_visible(False)
ax.tick_params(axis="y", length=0)
fig.tight_layout(); fig.savefig(f"{OUT}/fig_gas_cycle.png", facecolor="#ffffff"); plt.close(fig)

# ---- Figure: edge model confusion matrix (cross-load) ----
m = json.load(open(f"{R}/edge_model_metrics.json"))
cm = m["cross_load"]["confusion"]; lab = ["0\nnormal", "2\n0.007 in", "3\n0.014 in", "4\n0.021 in", "5\n0.028 in"]
fig, ax = plt.subplots(figsize=(4.6, 4.0))
rowsum = [sum(r) for r in cm]
frac = [[v / s for v in r] for r, s in zip(cm, rowsum)]
ax.imshow(frac, cmap=SEQ, vmin=0, vmax=1)
for i in range(5):
    for j in range(5):
        if cm[i][j]: ax.text(j, i, str(cm[i][j]), ha="center", va="center", fontsize=9, color="#ffffff" if frac[i][j] > 0.6 else INK)
ax.set_xticks(range(5), lab, fontsize=8); ax.set_yticks(range(5), lab, fontsize=8)
ax.set_xlabel("Predicted severity grade"); ax.set_ylabel("True severity grade (fault diameter)")
ax.axhline(1.5, color="#eb6834", linewidth=1.2, linestyle="--"); ax.axvline(1.5, color="#eb6834", linewidth=1.2, linestyle="--")
ax.tick_params(length=0)
for s in ax.spines.values(): s.set_visible(False)
fig.tight_layout(); fig.savefig(f"{OUT}/fig_edge_confusion.png", facecolor="#ffffff"); plt.close(fig)
print("figures written", [round(t) for t in tot])
