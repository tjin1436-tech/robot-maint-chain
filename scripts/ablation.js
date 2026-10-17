// Ablation matrix: 13 invalid-operation categories x 5 variants, 20 attempts each.
// An attempt counts as "admitted" if its transaction is mined (the invalid record or
// transition is committed), and as "intercepted" if it reverts.
const { ethers } = require("hardhat");
const fs = require("fs");
const H = require("../test/helpers");
const { F, Status } = H;
const N = 20;

async function tryTx(fn) {
  try { await fn(); return true; } catch (e) { return false; }
}

async function eligibleFault(s, sev = 4) {
  const { faultId } = await H.upload(s, { edgeSeverity: sev });
  await H.diagnose(s, faultId, sev);
  return faultId;
}
async function completedOrder(s) {
  const faultId = await eligibleFault(s);
  const { orderId } = await H.createOrder(s, faultId);
  await (await s.wo.connect(s.maint1).checkIn(orderId)).wait();
  await (await s.wo.connect(s.maint1).submitReport(orderId, ethers.id("r"))).wait();
  return orderId;
}

const ATTACKS = [
  { id: "A1", layer: "prerequisite", name: "Work order for nonexistent fault",
    run: async (s, i) => tryTx(() => s.wo.createOrder(100000 + i, s.maint1.address)) },
  { id: "A2", layer: "prerequisite", name: "Work order for undiagnosed fault",
    run: async (s) => { const { faultId } = await H.upload(s); return tryTx(() => s.wo.createOrder(faultId, s.maint1.address)); } },
  { id: "A3", layer: "prerequisite", name: "Work order for sub-threshold fault",
    run: async (s) => { const f = await eligibleFault(s, 2); return tryTx(() => s.wo.createOrder(f, s.maint1.address)); } },
  { id: "A4", layer: "prerequisite", name: "Acceptance of incomplete work order",
    run: async (s) => { const f = await eligibleFault(s); const { orderId } = await H.createOrder(s, f); return tryTx(() => H.verify(s, orderId)); } },
  { id: "A5", layer: "source", name: "Fabricated data signed by a non-device key",
    run: async (s) => {
      const d = s.devices[0], ind = [180000, 100000, 40000], raw = ethers.id(`fake-${Math.random()}`);
      const seq = H.nextSeq(s.seq, d.address);
      const sig = await s.rogueGateway.signMessage(ethers.getBytes(await s.fd.payloadHash(d.address, ind, raw, H.ZERO, 5, seq)));
      return tryTx(() => s.fd.connect(s.rogueGateway).uploadData(d.address, ind, raw, H.ZERO, 5, seq, sig));
    } },
  { id: "A6", layer: "source", name: "Replay of a previously accepted payload",
    run: async (s) => {
      const d = s.devices[1], ind = [150000, 80000, 30000], raw = ethers.id(`orig-${Math.random()}`);
      const seq = H.nextSeq(s.seq, d.address);
      const sig = await H.signUpload(s, d, ind, raw, H.ZERO, 4, seq);
      await (await s.fd.connect(s.gateway).uploadData(d.address, ind, raw, H.ZERO, 4, seq, sig)).wait();
      return tryTx(() => s.fd.connect(s.rogueGateway).uploadData(d.address, ind, raw, H.ZERO, 4, seq, sig));
    } },
  { id: "A7", layer: "source", name: "Indicators altered after device signing",
    run: async (s) => {
      const d = s.devices[2], raw = ethers.id(`t-${Math.random()}`);
      const seq = H.nextSeq(s.seq, d.address);
      const sig = await H.signUpload(s, d, [60000, 20000, 10000], raw, H.ZERO, 0, seq);
      return tryTx(() => s.fd.connect(s.rogueGateway).uploadData(d.address, [180000, 100000, 40000], raw, H.ZERO, 0, seq, sig));
    } },
  { id: "A8", layer: "consistency", name: "Diagnosis inflated above attested severity",
    run: async (s) => { const { faultId } = await H.upload(s, { edgeSeverity: 1 }); return tryTx(() => s.fd.connect(s.maint1).submitDiagnosis(faultId, 4)); } },
  { id: "A9", layer: "lifecycle", name: "Duplicate work order for the same fault",
    run: async (s) => { const f = await eligibleFault(s); await H.createOrder(s, f); return tryTx(() => s.wo.createOrder(f, s.maint2.address)); } },
  { id: "A10", layer: "prerequisite", name: "Re-acceptance of an already closed order",
    run: async (s) => { const { orderId } = await H.fullCycle(s); return tryTx(() => H.verify(s, orderId)); } },
  { id: "A11", layer: "lifecycle", name: "Work continued by a revoked maintainer",
    run: async (s) => {
      const f = await eligibleFault(s);
      const { orderId } = await H.createOrder(s, f, s.maint2);
      await (await s.ac.revoke(s.maint2.address)).wait();
      const ok = await tryTx(() => s.wo.connect(s.maint2).checkIn(orderId));
      await (await s.ac.authorize(s.maint2.address)).wait();
      return ok;
    } },
  { id: "A12", layer: "lifecycle", name: "Acceptance finalized by a single party",
    run: async (s) => {
      const orderId = await completedOrder(s);
      if (!(s.flags & F.LIFECYCLE)) { await H.verify(s, orderId, { from: s.supervisor }); return (await s.wo.statusOf(orderId)) === BigInt(Status.ACCEPTED); }
      const { recordId } = await H.verify(s, orderId, { from: s.supervisor });
      return tryTx(() => s.acc.connect(s.supervisor).countersign(recordId));
    } },
  { id: "A13", layer: "source", name: "Post-repair data entered without device signature",
    run: async (s) => { const orderId = await completedOrder(s); return tryTx(() => H.verify(s, orderId, { signer: s.manufacturer })); } },
];

async function main() {
  const out = { attempts: N, variants: H.VARIANTS.map((v) => v.name), attacks: [] };
  const recordCounts = {};
  for (const a of ATTACKS) {
    const row = { id: a.id, layer: a.layer, name: a.name, admitted: [] };
    for (const v of H.VARIANTS) {
      const s = await H.deploySystem(v.flags);
      let admitted = 0;
      for (let i = 0; i < N; i++) if (await a.run(s, i)) admitted++;
      row.admitted.push(admitted);
    }
    out.attacks.push(row);
    console.log(a.id.padEnd(4), a.name.padEnd(52), row.admitted.map((x) => String(x).padStart(3)).join(" "));
  }
  out.totals = H.VARIANTS.map((_, j) => out.attacks.reduce((t, r) => t + r.admitted[j], 0));
  console.log("TOTAL admitted".padEnd(57), out.totals.map((x) => String(x).padStart(3)).join(" "), "of", ATTACKS.length * N);
  fs.writeFileSync("results/ablation.json", JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
