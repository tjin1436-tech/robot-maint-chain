"""Compare a fresh run in results/ with the published numbers in results_paper/.

Usage: python3 scripts/compare.py results_paper results
Deterministic quantities must match exactly; timing quantities are printed side by side.
"""
import json, sys

A, B = sys.argv[1], sys.argv[2]
load = lambda d, f: json.load(open(f"{d}/{f}"))
ok = True

def same(label, x, y):
    global ok
    good = x == y
    ok &= good
    print(f"{'OK  ' if good else 'DIFF'} {label}" + ("" if good else f"\n     paper={x}\n     yours={y}"))

a, b = load(A, "ablation.json"), load(B, "ablation.json")
same("ablation totals", a["totals"], b["totals"])
same("ablation per attack", [r["admitted"] for r in a["attacks"]], [r["admitted"] for r in b["attacks"]])

a, b = load(A, "gas.json"), load(B, "gas.json")
for v in a["variants"]:
    same(f"gas {v}", {o: round(x["gas"]["mean"]) for o, x in a["variants"][v]["ops"].items()},
         {o: round(x["gas"]["mean"]) for o, x in b["variants"][v]["ops"].items()})
same("deploy gas", a["deploy"], b["deploy"])
same("bytecode sizes", a["bytecodeBytes"], b["bytecodeBytes"])

a, b = load(A, "edge_model_metrics.json"), load(B, "edge_model_metrics.json")
for k in ["windows_train", "windows_test", "accuracy", "confusion", "acceptance_limits_x1e6", "cross_load"]:
    same(f"edge {k}", a[k], b[k])
# the model hash covers the pickled model, so it changes with the scikit-learn/numpy version
print(f"INFO edge model hash {'same' if a['model_hash_sha256'] == b['model_hash_sha256'] else 'differs (library versions)'}")

a, b = load(A, "casestudy.json"), load(B, "casestudy.json")
# the paper reports the mean lifecycle gas rounded to whole units
for d in (a, b): d["lifecycleGasMean"] = round(d["lifecycleGasMean"])
# min/max lifecycle gas shift by a few units when the model hash (part of the calldata) changes
for k in ("lifecycleGasMin", "lifecycleGasMax"):
    if abs(a[k] - b[k]) <= 64: b[k] = a[k]
same("case study", a, b)

print("\nTiming (machine dependent, replace in Sections 4.1, 4.6, 4.7):")
a, b = load(A, "perf.json"), load(B, "perf.json")
for v in ["V1", "V4"]:
    for k in ["write", "read", "edgeSigningMs"]:
        print(f"  perf {v} {k:14s} paper {a[v][k]['mean']:.2f}±{a[v][k]['sd']:.2f} ms   yours {b[v][k]['mean']:.2f}±{b[v][k]['sd']:.2f} ms")
    print(f"  perf {v} throughput     paper {a[v]['throughputTxPerSec']:.1f}/s   yours {b[v]['throughputTxPerSec']:.1f}/s")
print("\nAll deterministic results match." if ok else "\nSome deterministic results differ; send both folders to Claude.")
