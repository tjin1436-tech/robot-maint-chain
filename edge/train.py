"""Edge diagnostic model on the CWRU bearing dataset (12 kHz drive end, 0 hp load).

Windows of 2048 samples are taken from each recording without overlap. Within each
recording the first 70% of windows are used for training and the remaining 30% for
testing (temporal split), so no test window overlaps a training window.
Severity mapping (fault diameter -> grade): normal 0, 0.007" 2, 0.014" 3, 0.021" 4, 0.028" 5.
"""
import glob, hashlib, json, os, pickle, sys
import numpy as np
from scipy.io import loadmat
from scipy.stats import kurtosis, skew
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix, classification_report

DATA = sys.argv[1]
OUT = sys.argv[2]
CROSS = sys.argv[3] if len(sys.argv) > 3 else None
SCALE = 1_000_000
WIN = 2048
SEV = {"Normal": 0, "007": 2, "014": 3, "021": 4, "028": 5}

def label(fname):
    base = os.path.basename(fname)
    if base.startswith("Normal"):
        return 0, "Normal"
    kind = "IR" if base.startswith("IR") else "B" if base.startswith("B") else "OR"
    size = base[len(kind):len(kind) + 3]
    return SEV[size], kind

def load(fname):
    m = loadmat(fname)
    key = [k for k in m if k.endswith("DE_time")][0]
    return m[key][:, 0].astype(np.float64)

def features(x):
    rms = np.sqrt(np.mean(x ** 2))
    peak = np.max(np.abs(x))
    absmean = np.mean(np.abs(x))
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    bands = np.array_split(spec[1:], 8)
    band_e = np.array([b.sum() for b in bands]); band_e = band_e / band_e.sum()
    return np.concatenate([[rms, np.std(x), peak, peak / rms, kurtosis(x, fisher=False), skew(x),
                            rms / absmean, peak / absmean, peak / np.mean(np.sqrt(np.abs(x))) ** 2], band_e])

def main():
    rng = np.random.default_rng(0)
    Xtr, ytr, Xte, yte, kte, wte, src = [], [], [], [], [], [], []
    for f in sorted(glob.glob(os.path.join(DATA, "*.mat"))):
        sev, kind = label(f)
        x = load(f)
        n = len(x) // WIN
        wins = x[: n * WIN].reshape(n, WIN)
        cut = int(round(0.7 * n))
        for i, w in enumerate(wins):
            feat = features(w)
            if i < cut:
                Xtr.append(feat); ytr.append(sev)
            else:
                Xte.append(feat); yte.append(sev); kte.append(kind); wte.append(w.astype(np.float32)); src.append(os.path.basename(f))
    Xtr, Xte, ytr, yte = map(np.array, (Xtr, Xte, ytr, yte))
    clf = RandomForestClassifier(n_estimators=200, random_state=0, n_jobs=-1).fit(Xtr, ytr)
    pred = clf.predict(Xte)
    blob = pickle.dumps(clf, protocol=4)
    model_hash = "0x" + hashlib.sha256(blob).hexdigest()
    labels = [0, 2, 3, 4, 5]
    cm = confusion_matrix(yte, pred, labels=labels).tolist()
    thr_true, thr_pred = yte >= 3, pred >= 3
    metrics = {
        "windows_train": int(len(ytr)), "windows_test": int(len(yte)), "window": WIN,
        "class_counts_train": {str(c): int((ytr == c).sum()) for c in labels},
        "class_counts_test": {str(c): int((yte == c).sum()) for c in labels},
        "accuracy": accuracy_score(yte, pred), "macro_f1": f1_score(yte, pred, average="macro"),
        "confusion_labels": labels, "confusion": cm,
        "threshold_decision": {
            "accuracy": float(np.mean(thr_true == thr_pred)),
            "false_orders": int(np.sum(~thr_true & thr_pred)), "missed_orders": int(np.sum(thr_true & ~thr_pred)),
            "true_order_cases": int(thr_true.sum()),
        },
        "report": classification_report(yte, pred, labels=labels, output_dict=True, zero_division=0),
        "model_hash_sha256": model_hash,
    }
    # On-chain indicators: RMS, kurtosis, crest factor (x1e6). Acceptance limits from normal training windows.
    ind_idx = [0, 4, 3]
    normal_tr = Xtr[ytr == 0][:, ind_idx]
    limits = [int(np.ceil(v * SCALE * 1.05)) for v in normal_tr.max(axis=0)]
    metrics["acceptance_limits_x1e6"] = limits
    metrics["normal_train_indicator_max"] = normal_tr.max(axis=0).tolist()
    test = []
    for feat, y, p, k, w, s in zip(Xte, yte, pred, kte, wte, src):
        test.append({"src": s, "kind": k, "true": int(y), "pred": int(p),
                     "indicators": [int(round(feat[i] * SCALE)) for i in ind_idx],
                     "raw_hex": "0x" + w.tobytes().hex()})
    cross = []
    if CROSS:
        Xc, yc, kc, wc, sc = [], [], [], [], []
        for f in sorted(glob.glob(os.path.join(CROSS, "*.mat"))):
            sev, kind = label(f)
            x = load(f)
            n = len(x) // WIN
            for w in x[: n * WIN].reshape(n, WIN):
                Xc.append(features(w)); yc.append(sev); kc.append(kind); wc.append(w.astype(np.float32)); sc.append(os.path.basename(f))
        Xc, yc = np.array(Xc), np.array(yc)
        pc = clf.predict(Xc)
        tt, tp = yc >= 3, pc >= 3
        metrics["cross_load"] = {
            "windows": int(len(yc)), "accuracy": accuracy_score(yc, pc), "macro_f1": f1_score(yc, pc, average="macro"),
            "confusion": confusion_matrix(yc, pc, labels=labels).tolist(),
            "threshold_decision": {"accuracy": float(np.mean(tt == tp)), "false_orders": int(np.sum(~tt & tp)),
                                   "missed_orders": int(np.sum(tt & ~tp)), "true_order_cases": int(tt.sum())},
        }
        for feat, y, p_, k, w, s_ in zip(Xc, yc, pc, kc, wc, sc):
            cross.append({"src": s_, "kind": k, "true": int(y), "pred": int(p_),
                          "indicators": [int(round(feat[i] * SCALE)) for i in ind_idx], "raw_hex": "0x" + w.tobytes().hex()})
    with open(os.path.join(OUT, "edge_model_metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)
    with open(os.path.join(OUT, "cwru_test_windows.json"), "w") as fh:
        json.dump({"model_hash": model_hash, "limits": limits, "windows": test, "cross_load_windows": cross}, fh)
    print(json.dumps({k: metrics[k] for k in ["windows_train", "windows_test", "accuracy", "macro_f1", "threshold_decision", "acceptance_limits_x1e6", "confusion"]} | {"cross_load": metrics.get("cross_load")}, indent=1))

if __name__ == "__main__":
    main()
