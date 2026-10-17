#!/usr/bin/env bash
# Reproduces every result in results/. Requires bin/solc (0.8.28) and forge on PATH (or FORGE=...).
set -euo pipefail
FORGE=${FORGE:-forge}
npx hardhat test 2>&1 | tee results/tests.log
npx hardhat run scripts/ablation.js 2>&1 | tee results/ablation.log
npx hardhat run scripts/gas.js 2>&1 | tee results/gas.log
npx hardhat run scripts/perf.js 2>&1 | tee results/perf.log
python3 edge/train.py data/cwru_0hp results data/cwru_1hp | tee results/edge_model.log
npx hardhat run scripts/casestudy.js 2>&1 | tee results/casestudy.log
rm -f foundry/metrics-*.csv
for fl in 15 7 3 1 0; do
  rm -rf foundry/cache/invariant
  FLAGS=$fl $FORGE test 2>&1 | grep -E "^\[(PASS|FAIL)" | sed -E 's/counterexample:.*//' | awk '!seen[$0]++' > foundry/inv-$fl.txt || true
done
npx hardhat coverage 2>&1 | tee results/coverage.log
