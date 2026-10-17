const { ethers } = require("hardhat");

const Role = { NONE: 0, ROBOT_DEVICE: 1, MAINTENANCE: 2, MANUFACTURER: 3, SUPERVISOR: 4 };
const Status = { NONE: 0, PENDING: 1, IN_PROGRESS: 2, COMPLETED: 3, ACCEPTED: 4, REJECTED: 5, REWORK: 6, ESCALATED: 7 };
const F = { PREREQ: 1, SOURCE: 2, CONSIST: 4, LIFECYCLE: 8, ALL: 15 };
const VARIANTS = [
  { name: "V0 RBAC only", flags: 0 },
  { name: "V1 +prerequisite", flags: F.PREREQ },
  { name: "V2 +source", flags: F.PREREQ | F.SOURCE },
  { name: "V3 +consistency", flags: F.PREREQ | F.SOURCE | F.CONSIST },
  { name: "V4 full", flags: F.ALL },
];
const DEFAULT_LIMITS = [100000, 50000, 20000]; // temperature 100, vibration 50, current 20 (x1000)
const ZERO = ethers.ZeroHash;

function deviceWallet(i) {
  return new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(`robot-device-${i}`)));
}

async function deploySystem(flags = F.ALL, limits = DEFAULT_LIMITS, nDevices = 4) {
  const signers = await ethers.getSigners();
  const [supervisor, gateway, maint1, maint2, manufacturer, rogueGateway, outsider] = signers;
  const ac = await (await ethers.getContractFactory("RobotAccessControl")).deploy();
  const fd = await (await ethers.getContractFactory("FaultDiagnosis")).deploy(ac, flags);
  const wo = await (await ethers.getContractFactory("MaintenanceWorkOrder")).deploy(ac, fd, flags);
  const acc = await (await ethers.getContractFactory("Acceptance")).deploy(ac, fd, wo, limits, flags);
  await wo.setAcceptanceContract(acc);
  const devices = [...Array(nDevices)].map((_, i) => deviceWallet(i));
  const reg = async (addr, role) => { await ac.registerNode(addr, role); await ac.authorize(addr); };
  await reg(gateway.address, Role.ROBOT_DEVICE);
  await reg(rogueGateway.address, Role.ROBOT_DEVICE);
  for (const d of devices) await reg(d.address, Role.ROBOT_DEVICE);
  await reg(maint1.address, Role.MAINTENANCE);
  await reg(maint2.address, Role.MAINTENANCE);
  await reg(manufacturer.address, Role.MANUFACTURER);
  const sys = { ac, fd, wo, acc, flags, supervisor, gateway, maint1, maint2, manufacturer, rogueGateway, outsider, devices, seq: {}, postSeq: {} };
  return sys;
}

function nextSeq(map, addr) {
  map[addr] = (map[addr] || 0) + 1;
  return map[addr];
}

async function signUpload(sys, device, indicators, rawHash, modelHash, edgeSeverity, seq) {
  const h = await sys.fd.payloadHash(device.address, indicators, rawHash, modelHash, edgeSeverity, seq);
  return device.signMessage(ethers.getBytes(h));
}

async function signPost(sys, device, orderId, indicators, rawHash, seq) {
  const h = await sys.acc.payloadHash(orderId, device.address, indicators, rawHash, seq);
  return device.signMessage(ethers.getBytes(h));
}

/** Upload device-signed data through the gateway; returns {faultId, receipt}. */
async function upload(sys, { device = sys.devices[0], indicators = [150000, 80000, 30000], edgeSeverity = 4, rawHash, modelHash = ZERO, from } = {}) {
  rawHash = rawHash || ethers.keccak256(ethers.toUtf8Bytes(`raw-${Date.now()}-${Math.random()}`));
  const seq = nextSeq(sys.seq, device.address);
  const sig = await signUpload(sys, device, indicators, rawHash, modelHash, edgeSeverity, seq);
  const tx = await sys.fd.connect(from || sys.gateway).uploadData(device.address, indicators, rawHash, modelHash, edgeSeverity, seq, sig);
  const receipt = await tx.wait();
  return { faultId: await sys.fd.faultCount(), receipt };
}

async function diagnose(sys, faultId, severity, from) {
  return (await sys.fd.connect(from || sys.maint1).submitDiagnosis(faultId, severity)).wait();
}

async function createOrder(sys, faultId, maintainer) {
  const receipt = await (await sys.wo.connect(sys.supervisor).createOrder(faultId, (maintainer || sys.maint1).address)).wait();
  return { orderId: await sys.wo.orderCount(), receipt };
}

async function verify(sys, orderId, { indicators = [60000, 20000, 10000], device = sys.devices[0], from, signer } = {}) {
  const rawHash = ethers.keccak256(ethers.toUtf8Bytes(`post-${orderId}-${Math.random()}`));
  const seq = nextSeq(sys.postSeq, device.address);
  const sig = await signPost(sys, signer || device, orderId, indicators, rawHash, seq);
  const receipt = await (await sys.acc.connect(from || sys.manufacturer).submitVerification(orderId, indicators, rawHash, seq, sig)).wait();
  return { recordId: await sys.acc.recordCount(), receipt };
}

/** Drive one fault through diagnosis, order, repair and (dual) acceptance. */
async function fullCycle(sys, opts = {}) {
  const device = opts.device || sys.devices[0];
  const { faultId } = await upload(sys, { device, edgeSeverity: 4 });
  await diagnose(sys, faultId, 4);
  const { orderId } = await createOrder(sys, faultId);
  await (await sys.wo.connect(sys.maint1).checkIn(orderId)).wait();
  await (await sys.wo.connect(sys.maint1).submitReport(orderId, ethers.id("report"))).wait();
  const { recordId } = await verify(sys, orderId, { device, indicators: opts.post });
  if (sys.flags & F.LIFECYCLE) await (await sys.acc.connect(sys.supervisor).countersign(recordId)).wait();
  return { faultId, orderId, recordId };
}

module.exports = { Role, Status, F, VARIANTS, DEFAULT_LIMITS, ZERO, deviceWallet, deploySystem, upload, diagnose, createOrder, verify, fullCycle, signUpload, signPost, nextSeq };
