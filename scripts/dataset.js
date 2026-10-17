// Deterministic synthetic dataset following Table 2 of the manuscript (seeded PRNG).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RANGES = {
  0: [[40, 95], [10, 45], [5, 18]],
  1: [[115, 145], [58, 84], [23, 30]],
  2: [[130, 160], [66, 96], [26, 35]],
  3: [[145, 175], [74, 108], [29, 40]],
  4: [[160, 190], [82, 120], [32, 45]],
  5: [[175, 205], [90, 132], [35, 50]],
};
function generate(seed = 20260923) {
  const rnd = mulberry32(seed);
  const recs = [];
  const push = (level) => {
    const ind = RANGES[level].map(([lo, hi]) => Math.round((lo + rnd() * (hi - lo)) * 1000));
    recs.push({ level, indicators: ind });
  };
  for (let i = 0; i < 600; i++) push(0);
  for (let l = 1; l <= 5; l++) for (let i = 0; i < 80; i++) push(l);
  for (let i = recs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [recs[i], recs[j]] = [recs[j], recs[i]]; }
  return recs;
}
module.exports = { generate, RANGES };
