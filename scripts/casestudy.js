// End-to-end case study on real bearing vibration data (CWRU, 1 hp load, model trained at 0 hp).
const { ethers } = require("hardhat");
const fs = require("fs");
const H = require("../test/helpers");
const { Status } = H;

async function main() {
  const D = JSON.parse(fs.readFileSync("results/cwru_test_windows.json"));
  const wins = D.cross_load_windows;
  const s = await H.deploySystem(H.F.ALL, D.limits);
  const modelHash = D.model_hash;
  const normals = wins.filter((w) => w.true === 0);
  let ni = 0;
  const nextNormal = () => normals[ni++ % normals.length];
  const c = { windows: wins.length, uploaded: 0, diagnosed: 0, orders: 0, accepted: 0, reworkRounds: 0, escalated: 0,
              commitmentsVerified: 0, ordersByTrue: {}, lifecycleGas: [], postNormalQualified: 0, postNormalTotal: 0, falseReworks: 0, plannedFailures: 0 };
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    const device = s.devices[i % s.devices.length];
    const raw = ethers.keccak256(w.raw_hex);
    let gas = 0;
    const g = async (p) => { const r = await (await p).wait(); gas += Number(r.gasUsed); return r; };
    const seq = H.nextSeq(s.seq, device.address);
    const sig = await H.signUpload(s, device, w.indicators, raw, modelHash, w.pred, seq);
    await g(s.fd.connect(s.gateway).uploadData(device.address, w.indicators, raw, modelHash, w.pred, seq, sig));
    c.uploaded++;
    const faultId = await s.fd.faultCount();
    const f = await s.fd.getFault(faultId);
    if (f.rawDataHash === ethers.keccak256(w.raw_hex) && f.modelHash === modelHash) c.commitmentsVerified++;
    if (w.pred === 0) continue;
    await g(s.fd.connect(s.maint1).submitDiagnosis(faultId, w.pred));
    c.diagnosed++;
    if (w.pred < 3) continue;
    await g(s.wo.createOrder(faultId, s.maint1.address));
    const orderId = await s.wo.orderCount();
    c.orders++;
    c.ordersByTrue[w.true] = (c.ordersByTrue[w.true] || 0) + 1;
    // every fifth order: first repair attempt fails (post-repair data is still the faulty signal)
    const planned = c.orders % 5 === 0;
    if (planned) c.plannedFailures++;
    for (let a = 0; a <= 2; a++) {
      const post = planned && a === 0 ? w : nextNormal();
      await g(s.wo.connect(s.maint1).checkIn(orderId));
      await g(s.wo.connect(s.maint1).submitReport(orderId, ethers.id(`report-${orderId}`)));
      const praw = ethers.keccak256(post.raw_hex);
      const pseq = H.nextSeq(s.postSeq, device.address);
      const psig = await H.signPost(s, device, orderId, post.indicators, praw, pseq);
      await g(s.acc.connect(s.manufacturer).submitVerification(orderId, post.indicators, praw, pseq, psig));
      await g(s.acc.connect(s.supervisor).countersign(await s.acc.recordCount()));
      const rec = await s.acc.getRecord(await s.acc.recordCount());
      if (post.true === 0) { c.postNormalTotal++; if (rec.qualified) c.postNormalQualified++; }
      const st = Number(await s.wo.statusOf(orderId));
      if (st === Status.ACCEPTED) { c.accepted++; break; }
      if (st === Status.REWORK) { c.reworkRounds++; if (!(planned && a === 0)) c.falseReworks++; }
      if (st === Status.ESCALATED) { c.escalated++; break; }
    }
    c.lifecycleGas.push(gas);
  }
  const lg = c.lifecycleGas;
  c.lifecycleGasMean = lg.reduce((a, b) => a + b, 0) / lg.length;
  c.lifecycleGasMin = Math.min(...lg); c.lifecycleGasMax = Math.max(...lg);
  delete c.lifecycleGas;
  fs.writeFileSync("results/casestudy.json", JSON.stringify(c, null, 2));
  console.log(c);
}
main().catch((e) => { console.error(e); process.exit(1); });
