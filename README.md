# robot-maint-chain

Code, data-processing scripts and raw results for the manuscript
"Multi-Layer Write-Time Verification of Data Provenance and Workflow Integrity for Blockchain-Based Robot Maintenance Records" (v9).

## Layout

| Path | Content |
|---|---|
| `contracts/` | `RobotAccessControl`, `FaultDiagnosis`, `MaintenanceWorkOrder`, `Acceptance` (the modular design), `MonolithicMaintenance` and `AnchorOnly` (baselines), `Flags` (deploy-time layer switches) |
| `test/` | 46 Mocha tests (`functional.test.js`) and shared helpers |
| `foundry/test/Invariants.t.sol` | Handler and invariants I1–I7 for stateful fuzzing |
| `scripts/` | `ablation.js` (13 attacks × 5 variants), `gas.js` (200 cycles per design), `perf.js` (1000 records), `casestudy.js` (CWRU end to end), `dataset.js` (synthetic data), `figures.py` |
| `edge/train.py` | CWRU feature extraction, random-forest model, on-chain indicators and acceptance limits |
| `figures/` | All figures of the manuscript (`arch.js` draws Figures 1–3) |
| `results/` | Raw outputs behind every number in the manuscript |
| `foundry/inv-*.txt`, `foundry/metrics-*.csv` | Invariant results and state-reach counts per variant (FLAGS = 15, 7, 3, 1, 0 = V4, V3, V2, V1, V0) |

Layer flags: PREREQ = 1, SOURCE = 2, CONSIST = 4, LIFECYCLE = 8. V0 = 0, V1 = 1, V2 = 3, V3 = 7, V4 = 15.

## Reproduce

Requirements: Node.js 22, Python 3 with numpy, scipy and scikit-learn, Foundry (forge 1.5.x).

```bash
npm install --legacy-peer-deps
# forge-std is vendored in lib/. Optional: put a native solc 0.8.28 at bin/solc;
# otherwise Hardhat downloads the compiler.
# CWRU data (12 kHz drive end): download from https://engineering.case.edu/bearingdatacenter
# the files B/IR 007–028, OR 007–021 @6, Normal for 0 hp and 1 hp, and place them as
#   data/cwru_0hp/B007_0.mat ... Normal_0.mat
#   data/cwru_1hp/B007_1.mat ... Normal_1.mat
bash run_all.sh   # set FORGE=/path/to/forge if forge is not on PATH
python3 scripts/figures.py results figures
```

Gas figures are deterministic. Latency figures depend on the machine; the values in the manuscript were
measured in a Kaggle notebook (4 vCPUs, Intel Xeon 2.20 GHz, 31 GB RAM) with the Hardhat local network;
`results/machine.txt` records the exact environment. The model hash depends on the installed scikit-learn/numpy
versions (it hashes the pickled model), and through the calldata it shifts the minimum lifecycle gas of the case
study by a few units; predictions and all other results are unaffected.

## Notes

- `foundry.toml` points `solc` to `bin/solc` and runs offline. Without a local binary, replace that line with
  `solc_version = "0.8.28"` and remove `offline = true`.

- Indicators are fixed-point integers. The synthetic dataset uses a scale of 10^3 (comment in `FaultDiagnosis.sol`);
  the CWRU case study uses 10^6.
- Slither: no high-severity findings; see `results/slither.json` for the medium/low findings discussed in Section 4.3.

## License

MIT, see `LICENSE`.
