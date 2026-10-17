// Upload and read all 1000 synthetic records (Table 2) on V1 (original design) and V4 (full design).
const { ethers } = require("hardhat");
const fs = require("fs");
const H = require("../test/helpers");
const { generate } = require("./dataset");

const stats = (xs) => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n; return { n, mean: m, sd: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)), p95: [...xs].sort((a, b) => a - b)[Math.floor(0.95 * n)] }; };

async function run(flags) {
  const s = await H.deploySystem(flags);
  const data = generate();
  const lat = [], gas = [], sign = [];
  const t0all = process.hrtime.bigint();
  for (let i = 0; i < data.length; i++) {
    const d = s.devices[i % s.devices.length];
    const raw = ethers.id(`synthetic-${i}`);
    const seq = H.nextSeq(s.seq, d.address);
    const ts = process.hrtime.bigint();
    const sig = await H.signUpload(s, d, data[i].indicators, raw, H.ZERO, data[i].level, seq);
    sign.push(Number(process.hrtime.bigint() - ts) / 1e6);
    const t0 = process.hrtime.bigint();
    const r = await (await s.fd.connect(s.gateway).uploadData(d.address, data[i].indicators, raw, H.ZERO, data[i].level, seq, sig)).wait();
    lat.push(Number(process.hrtime.bigint() - t0) / 1e6);
    gas.push(Number(r.gasUsed));
  }
  const totalMs = Number(process.hrtime.bigint() - t0all) / 1e6;
  const reads = [];
  for (let i = 1; i <= data.length; i++) { const t0 = process.hrtime.bigint(); await s.fd.getFault(i); reads.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  return { records: data.length, write: stats(lat), gas: stats(gas), edgeSigningMs: stats(sign), read: stats(reads), totalWallClockMs: totalMs, throughputTxPerSec: data.length / (totalMs / 1000) };
}
async function main() {
  const out = { V1: await run(H.F.PREREQ), V4: await run(H.F.ALL) };
  fs.writeFileSync("results/perf.json", JSON.stringify(out, null, 2));
  for (const k of ["V1", "V4"]) {
    const o = out[k];
    console.log(k, `write ${o.write.mean.toFixed(2)}±${o.write.sd.toFixed(2)} ms (p95 ${o.write.p95.toFixed(2)}), gas ${o.gas.mean.toFixed(0)}±${o.gas.sd.toFixed(0)}, sign ${o.edgeSigningMs.mean.toFixed(2)} ms, read ${o.read.mean.toFixed(2)}±${o.read.sd.toFixed(2)} ms, ${o.throughputTxPerSec.toFixed(1)} rec/s`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
