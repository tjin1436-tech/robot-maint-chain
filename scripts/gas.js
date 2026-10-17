// Per-operation gas and latency for every variant, the monolithic baseline and the anchor-only baseline,
// plus deployment cost and bytecode size. Latency = send + receipt on Hardhat automine (signing excluded).
const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const H = require("../test/helpers");
const { F, Role } = H;
const CYCLES = Number(process.env.CYCLES || 200);

const stats = (xs) => {
  const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1 || 1));
  return { n, mean: m, sd, min: Math.min(...xs), max: Math.max(...xs) };
};
async function timed(send) {
  const t0 = process.hrtime.bigint();
  const tx = await send();
  const r = await tx.wait();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { gas: Number(r.gasUsed), ms };
}
function collector() {
  const g = {}, l = {};
  return {
    add(op, { gas, ms }) { (g[op] ||= []).push(gas); (l[op] ||= []).push(ms); },
    summary() { const o = {}; for (const k of Object.keys(g)) o[k] = { gas: stats(g[k]), ms: stats(l[k]) }; return o; },
  };
}

async function modularRun(flags) {
  const s = await H.deploySystem(flags);
  const c = collector();
  const lifecycle = flags & F.LIFECYCLE;
  for (let i = 0; i < CYCLES; i++) {
    const d = s.devices[i % s.devices.length];
    const ind = [150000 + i, 80000, 30000], raw = ethers.id(`raw-${i}`);
    const seq = H.nextSeq(s.seq, d.address);
    const sig = await H.signUpload(s, d, ind, raw, H.ZERO, 4, seq);
    c.add("uploadData", await timed(() => s.fd.connect(s.gateway).uploadData(d.address, ind, raw, H.ZERO, 4, seq, sig)));
    const faultId = await s.fd.faultCount();
    c.add("submitDiagnosis", await timed(() => s.fd.connect(s.maint1).submitDiagnosis(faultId, 4)));
    c.add("createOrder", await timed(() => s.wo.createOrder(faultId, s.maint1.address)));
    const orderId = await s.wo.orderCount();
    c.add("checkIn", await timed(() => s.wo.connect(s.maint1).checkIn(orderId)));
    c.add("submitReport", await timed(() => s.wo.connect(s.maint1).submitReport(orderId, ethers.id(`rep-${i}`))));
    const post = [60000, 20000, 10000], praw = ethers.id(`post-${i}`);
    const pseq = H.nextSeq(s.postSeq, d.address);
    const psig = await H.signPost(s, d, orderId, post, praw, pseq);
    c.add("submitVerification", await timed(() => s.acc.connect(s.manufacturer).submitVerification(orderId, post, praw, pseq, psig)));
    if (lifecycle) c.add("countersign", await timed(() => s.acc.connect(s.supervisor).countersign(Number(i + 1))));
  }
  // read latency
  const reads = [];
  for (let i = 1; i <= CYCLES; i++) { const t0 = process.hrtime.bigint(); await s.fd.getFault(i); reads.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  return { ops: c.summary(), read: stats(reads) };
}

async function monolithicRun() {
  const [sup, gw, m1, , man] = await ethers.getSigners();
  const M = await (await ethers.getContractFactory("MonolithicMaintenance")).deploy(H.DEFAULT_LIMITS);
  const devs = [0, 1, 2, 3].map(H.deviceWallet);
  for (const [a, r] of [[gw.address, Role.ROBOT_DEVICE], ...devs.map((d) => [d.address, Role.ROBOT_DEVICE]), [m1.address, Role.MAINTENANCE], [man.address, Role.MANUFACTURER]]) {
    await M.registerNode(a, r); await M.authorize(a);
  }
  const c = collector(); const seq = {}, pseq = {};
  for (let i = 0; i < CYCLES; i++) {
    const d = devs[i % 4];
    const ind = [150000 + i, 80000, 30000], raw = ethers.id(`raw-${i}`);
    const sq = H.nextSeq(seq, d.address);
    const sig = await d.signMessage(ethers.getBytes(await M.payloadHash(d.address, ind, raw, H.ZERO, 4, sq)));
    c.add("uploadData", await timed(() => M.connect(gw).uploadData(d.address, ind, raw, H.ZERO, 4, sq, sig)));
    const f = await M.faultCount();
    c.add("submitDiagnosis", await timed(() => M.connect(m1).submitDiagnosis(f, 4)));
    c.add("createOrder", await timed(() => M.createOrder(f, m1.address)));
    const o = await M.orderCount();
    c.add("checkIn", await timed(() => M.connect(m1).checkIn(o)));
    c.add("submitReport", await timed(() => M.connect(m1).submitReport(o, ethers.id(`rep-${i}`))));
    const post = [60000, 20000, 10000], praw = ethers.id(`post-${i}`);
    const ps = H.nextSeq(pseq, d.address);
    const psig = await d.signMessage(ethers.getBytes(await M.postPayloadHash(o, d.address, post, praw, ps)));
    c.add("submitVerification", await timed(() => M.connect(man).submitVerification(o, post, praw, ps, psig)));
    c.add("countersign", await timed(() => M.countersign(i + 1)));
  }
  return { ops: c.summary() };
}

async function anchorRun() {
  const A = await (await ethers.getContractFactory("AnchorOnly")).deploy();
  const c = collector();
  const ops = ["uploadData", "submitDiagnosis", "createOrder", "checkIn", "submitReport", "submitVerification", "countersign"];
  for (let i = 0; i < CYCLES; i++) for (const [k, op] of ops.entries()) c.add(op, await timed(() => A.anchor(k, ethers.id(`${op}-${i}`))));
  return { ops: c.summary() };
}

async function deployCost() {
  const res = {};
  const size = async (name) => ((await artifacts.readArtifact(name)).deployedBytecode.length - 2) / 2;
  const dep = async (name, args) => {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    const r = await c.deploymentTransaction().wait();
    return { c, gas: Number(r.gasUsed) };
  };
  for (const v of H.VARIANTS) {
    const ac = await dep("RobotAccessControl", []);
    const fd = await dep("FaultDiagnosis", [ac.c, v.flags]);
    const wo = await dep("MaintenanceWorkOrder", [ac.c, fd.c, v.flags]);
    const acc = await dep("Acceptance", [ac.c, fd.c, wo.c, H.DEFAULT_LIMITS, v.flags]);
    const link = Number((await (await wo.c.setAcceptanceContract(acc.c)).wait()).gasUsed);
    res[v.name] = { total: ac.gas + fd.gas + wo.gas + acc.gas + link, parts: { RobotAccessControl: ac.gas, FaultDiagnosis: fd.gas, MaintenanceWorkOrder: wo.gas, Acceptance: acc.gas, link } };
  }
  const mono = await dep("MonolithicMaintenance", [H.DEFAULT_LIMITS]);
  res["Monolithic"] = { total: mono.gas };
  const anc = await dep("AnchorOnly", []);
  res["Anchor-only"] = { total: anc.gas };
  const sizes = {};
  for (const n of ["RobotAccessControl", "FaultDiagnosis", "MaintenanceWorkOrder", "Acceptance", "MonolithicMaintenance", "AnchorOnly"]) sizes[n] = await size(n);
  return { deploy: res, bytecodeBytes: sizes };
}

async function main() {
  const out = { cycles: CYCLES, variants: {} };
  for (const v of H.VARIANTS) { out.variants[v.name] = await modularRun(v.flags); console.log("done", v.name); }
  out.variants["Monolithic"] = await monolithicRun(); console.log("done mono");
  out.variants["Anchor-only"] = await anchorRun(); console.log("done anchor");
  Object.assign(out, await deployCost());
  fs.writeFileSync("results/gas.json", JSON.stringify(out, null, 2));
  const names = Object.keys(out.variants);
  const ops = ["uploadData", "submitDiagnosis", "createOrder", "checkIn", "submitReport", "submitVerification", "countersign"];
  console.log("op".padEnd(20), names.map((n) => n.slice(0, 12).padStart(13)).join(""));
  for (const op of ops) console.log(op.padEnd(20), names.map((n) => (out.variants[n].ops[op] ? Math.round(out.variants[n].ops[op].gas.mean) : "-").toString().padStart(13)).join(""));
  console.log("latency ms");
  for (const op of ops) console.log(op.padEnd(20), names.map((n) => (out.variants[n].ops[op] ? out.variants[n].ops[op].ms.mean.toFixed(2) + "±" + out.variants[n].ops[op].ms.sd.toFixed(2) : "-").padStart(13)).join(""));
  console.log(JSON.stringify(out.deploy), JSON.stringify(out.bytecodeBytes));
}
main().catch((e) => { console.error(e); process.exit(1); });
