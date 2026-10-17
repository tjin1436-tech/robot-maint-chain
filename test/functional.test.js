const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const H = require("./helpers");
const { Role, Status, F } = H;

describe("Full system (all checks enabled)", function () {
  const fixture = () => H.deploySystem(F.ALL);

  describe("Access control", function () {
    it("initializes the deployer as an authorized supervisor", async function () {
      const s = await loadFixture(fixture);
      expect(await s.ac.hasRole(s.supervisor.address, Role.SUPERVISOR)).to.equal(true);
    });
    it("rejects registration by a non-supervisor", async function () {
      const s = await loadFixture(fixture);
      await expect(s.ac.connect(s.outsider).registerNode(s.outsider.address, Role.SUPERVISOR)).to.be.revertedWith("AC: caller is not supervisor");
    });
    it("rejects duplicate registration", async function () {
      const s = await loadFixture(fixture);
      await expect(s.ac.registerNode(s.maint1.address, Role.MAINTENANCE)).to.be.revertedWith("AC: node exists");
    });
    it("does not grant a role before authorization", async function () {
      const s = await loadFixture(fixture);
      await s.ac.registerNode(s.outsider.address, Role.MAINTENANCE);
      expect(await s.ac.hasRole(s.outsider.address, Role.MAINTENANCE)).to.equal(false);
    });
    it("removes the role on revocation and emits an event", async function () {
      const s = await loadFixture(fixture);
      await expect(s.ac.revoke(s.maint2.address)).to.emit(s.ac, "NodeRevoked");
      expect(await s.ac.hasRole(s.maint2.address, Role.MAINTENANCE)).to.equal(false);
    });
  });

  describe("Fault diagnosis: source verification", function () {
    it("accepts device-signed data relayed by an authorized gateway", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      const f = await s.fd.getFault(faultId);
      expect(f.device).to.equal(s.devices[0].address);
      expect(f.submitter).to.equal(s.gateway.address);
    });
    it("rejects uploads from callers without the ROBOT_DEVICE role", async function () {
      const s = await loadFixture(fixture);
      await expect(H.upload(s, { from: s.outsider })).to.be.revertedWith("FD: caller is not robot device");
    });
    it("rejects data signed by a key other than the claimed device", async function () {
      const s = await loadFixture(fixture);
      const d = s.devices[0];
      const ind = [150000, 80000, 30000];
      const raw = ethers.id("raw");
      const sig = await H.signUpload(s, s.devices[1], ind, raw, H.ZERO, 4, 1);
      await expect(s.fd.connect(s.gateway).uploadData(d.address, ind, raw, H.ZERO, 4, 1, sig)).to.be.revertedWith("FD: invalid device signature");
    });
    it("rejects a payload whose indicators were altered after signing", async function () {
      const s = await loadFixture(fixture);
      const d = s.devices[0];
      const raw = ethers.id("raw");
      const sig = await H.signUpload(s, d, [150000, 80000, 30000], raw, H.ZERO, 4, 1);
      await expect(s.fd.connect(s.gateway).uploadData(d.address, [190000, 80000, 30000], raw, H.ZERO, 4, 1, sig)).to.be.revertedWith("FD: invalid device signature");
    });
    it("rejects a replayed payload", async function () {
      const s = await loadFixture(fixture);
      const d = s.devices[0];
      const ind = [150000, 80000, 30000];
      const raw = ethers.id("raw");
      const sig = await H.signUpload(s, d, ind, raw, H.ZERO, 4, 1);
      await s.fd.connect(s.gateway).uploadData(d.address, ind, raw, H.ZERO, 4, 1, sig);
      await expect(s.fd.connect(s.gateway).uploadData(d.address, ind, raw, H.ZERO, 4, 1, sig)).to.be.revertedWith("FD: replayed payload");
    });
    it("rejects data from a revoked device", async function () {
      const s = await loadFixture(fixture);
      await s.ac.revoke(s.devices[2].address);
      await expect(H.upload(s, { device: s.devices[2] })).to.be.revertedWith("FD: device not authorized");
    });
    it("rejects an edge severity above 5", async function () {
      const s = await loadFixture(fixture);
      await expect(H.upload(s, { edgeSeverity: 6 })).to.be.revertedWith("FD: severity out of range");
    });
    it("stores the raw-data commitment and model hash", async function () {
      const s = await loadFixture(fixture);
      const raw = ethers.id("waveform");
      const model = ethers.id("model-v1");
      const { faultId } = await H.upload(s, { rawHash: raw, modelHash: model });
      const f = await s.fd.getFault(faultId);
      expect(f.rawDataHash).to.equal(raw);
      expect(f.modelHash).to.equal(model);
    });
  });

  describe("Fault diagnosis: confirmation", function () {
    it("emits the work order trigger at or above the threshold", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s, { edgeSeverity: 3 });
      await expect(s.fd.connect(s.maint1).submitDiagnosis(faultId, 3)).to.emit(s.fd, "WorkOrderTriggered");
    });
    it("does not emit the trigger below the threshold", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s, { edgeSeverity: 2 });
      await expect(s.fd.connect(s.maint1).submitDiagnosis(faultId, 2)).not.to.emit(s.fd, "WorkOrderTriggered");
    });
    it("allows a manufacturer to diagnose", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await expect(s.fd.connect(s.manufacturer).submitDiagnosis(faultId, 4)).to.emit(s.fd, "FaultDiagnosed");
    });
    it("rejects diagnosis by an unauthorized role", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await expect(s.fd.connect(s.gateway).submitDiagnosis(faultId, 4)).to.be.revertedWith("FD: caller cannot diagnose");
    });
    it("rejects diagnosis of a nonexistent fault", async function () {
      const s = await loadFixture(fixture);
      await expect(s.fd.connect(s.maint1).submitDiagnosis(99, 4)).to.be.revertedWith("FD: fault not found");
    });
    it("rejects a severity inconsistent with the attested edge severity", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s, { edgeSeverity: 1 });
      await expect(s.fd.connect(s.maint1).submitDiagnosis(faultId, 4)).to.be.revertedWith("FD: inconsistent with attested data");
    });
    it("rejects a second diagnosis of the same fault", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      await expect(s.fd.connect(s.maint1).submitDiagnosis(faultId, 4)).to.be.revertedWith("FD: already diagnosed");
    });
  });

  describe("Work orders", function () {
    it("creates an order for an eligible fault", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      const { orderId } = await H.createOrder(s, faultId);
      expect(await s.wo.statusOf(orderId)).to.equal(Status.PENDING);
    });
    it("rejects orders from non-supervisors", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      await expect(s.wo.connect(s.maint1).createOrder(faultId, s.maint1.address)).to.be.revertedWith("WO: caller is not supervisor");
    });
    it("rejects an assignee without the MAINTENANCE role", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      await expect(s.wo.createOrder(faultId, s.manufacturer.address)).to.be.revertedWith("WO: assignee is not maintainer");
    });
    for (const [name, prep] of [
      ["a nonexistent fault", async (s) => 999],
      ["an undiagnosed fault", async (s) => (await H.upload(s)).faultId],
      ["a sub-threshold fault", async (s) => { const { faultId } = await H.upload(s, { edgeSeverity: 2 }); await H.diagnose(s, faultId, 2); return faultId; }],
    ]) {
      it(`rejects an order for ${name}`, async function () {
        const s = await loadFixture(fixture);
        const id = await prep(s);
        await expect(s.wo.createOrder(id, s.maint1.address)).to.be.revertedWith("WO: fault not diagnosed or below threshold");
      });
    }
    it("rejects a second active order for the same fault", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      await H.createOrder(s, faultId);
      await expect(s.wo.createOrder(faultId, s.maint2.address)).to.be.revertedWith("WO: active order exists for fault");
    });
    it("transitions PENDING to IN_PROGRESS to COMPLETED", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      const { orderId } = await H.createOrder(s, faultId);
      await s.wo.connect(s.maint1).checkIn(orderId);
      expect(await s.wo.statusOf(orderId)).to.equal(Status.IN_PROGRESS);
      await s.wo.connect(s.maint1).submitReport(orderId, ethers.id("r"));
      expect(await s.wo.statusOf(orderId)).to.equal(Status.COMPLETED);
    });
    it("rejects operations by a non-assigned maintainer", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      const { orderId } = await H.createOrder(s, faultId);
      await expect(s.wo.connect(s.maint2).checkIn(orderId)).to.be.revertedWith("WO: caller is not assigned maintainer");
    });
    it("rejects a report before check-in", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      const { orderId } = await H.createOrder(s, faultId);
      await expect(s.wo.connect(s.maint1).submitReport(orderId, ethers.id("r"))).to.be.revertedWith("WO: order not in progress");
    });
    it("rejects work by a maintainer revoked after assignment", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      const { orderId } = await H.createOrder(s, faultId);
      await s.ac.revoke(s.maint1.address);
      await expect(s.wo.connect(s.maint1).checkIn(orderId)).to.be.revertedWith("WO: maintainer authorization revoked");
    });
    it("only lets the acceptance contract close orders", async function () {
      const s = await loadFixture(fixture);
      await expect(s.wo.closeOrder(1, true)).to.be.revertedWith("WO: caller is not acceptance contract");
    });
    it("allows the acceptance contract to be set only once", async function () {
      const s = await loadFixture(fixture);
      await expect(s.wo.setAcceptanceContract(s.outsider.address)).to.be.revertedWith("WO: already set");
    });
  });

  describe("Acceptance", function () {
    async function completedOrder(s) {
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      const { orderId } = await H.createOrder(s, faultId);
      await s.wo.connect(s.maint1).checkIn(orderId);
      await s.wo.connect(s.maint1).submitReport(orderId, ethers.id("r"));
      return orderId;
    }
    it("accepts a qualified repair after dual sign-off", async function () {
      const s = await loadFixture(fixture);
      const orderId = await completedOrder(s);
      const { recordId } = await H.verify(s, orderId);
      expect(await s.wo.statusOf(orderId)).to.equal(Status.COMPLETED);
      await s.acc.connect(s.supervisor).countersign(recordId);
      expect(await s.wo.statusOf(orderId)).to.equal(Status.ACCEPTED);
      expect((await s.acc.getRecord(recordId)).qualified).to.equal(true);
    });
    it("rejects verification of an order that has not completed repair", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.upload(s);
      await H.diagnose(s, faultId, 4);
      const { orderId } = await H.createOrder(s, faultId);
      await expect(H.verify(s, orderId)).to.be.revertedWith("ACC: order not completed");
    });
    it("rejects verification by an unauthorized role", async function () {
      const s = await loadFixture(fixture);
      const orderId = await completedOrder(s);
      await expect(H.verify(s, orderId, { from: s.maint1 })).to.be.revertedWith("ACC: caller cannot verify");
    });
    it("rejects post-repair data not signed by the robot", async function () {
      const s = await loadFixture(fixture);
      const orderId = await completedOrder(s);
      await expect(H.verify(s, orderId, { signer: s.devices[3] })).to.be.revertedWith("ACC: post-repair data not signed by device");
    });
    it("rejects a countersignature from the same role", async function () {
      const s = await loadFixture(fixture);
      const orderId = await completedOrder(s);
      const { recordId } = await H.verify(s, orderId, { from: s.supervisor });
      await expect(s.acc.connect(s.supervisor).countersign(recordId)).to.be.revertedWith("ACC: countersigner must hold the other role");
    });
    it("rejects a second verification while one is pending", async function () {
      const s = await loadFixture(fixture);
      const orderId = await completedOrder(s);
      await H.verify(s, orderId);
      await expect(H.verify(s, orderId)).to.be.revertedWith("ACC: verification already pending");
    });
    it("rejects re-acceptance of an accepted order", async function () {
      const s = await loadFixture(fixture);
      const { orderId } = await H.fullCycle(s);
      await expect(H.verify(s, orderId)).to.be.revertedWith("ACC: order not completed");
    });
    it("returns an unqualified repair for rework and accepts it after re-repair", async function () {
      const s = await loadFixture(fixture);
      const orderId = await completedOrder(s);
      const r1 = await H.verify(s, orderId, { indicators: [120000, 20000, 10000] });
      await s.acc.connect(s.supervisor).countersign(r1.recordId);
      expect(await s.wo.statusOf(orderId)).to.equal(Status.REWORK);
      await s.wo.connect(s.maint1).checkIn(orderId);
      await s.wo.connect(s.maint1).submitReport(orderId, ethers.id("r2"));
      const r2 = await H.verify(s, orderId);
      await s.acc.connect(s.supervisor).countersign(r2.recordId);
      expect(await s.wo.statusOf(orderId)).to.equal(Status.ACCEPTED);
      expect((await s.wo.getOrder(orderId)).reworkCount).to.equal(1);
    });
    it("escalates after the maximum number of rework rounds", async function () {
      const s = await loadFixture(fixture);
      const orderId = await completedOrder(s);
      for (let i = 0; i < 3; i++) {
        const r = await H.verify(s, orderId, { indicators: [120000, 20000, 10000] });
        await s.acc.connect(s.supervisor).countersign(r.recordId);
        if (i < 2) {
          await s.wo.connect(s.maint1).checkIn(orderId);
          await s.wo.connect(s.maint1).submitReport(orderId, ethers.id(`r${i}`));
        }
      }
      expect(await s.wo.statusOf(orderId)).to.equal(Status.ESCALATED);
      expect(await s.wo.activeOrderOfFault((await s.wo.getOrder(orderId)).faultId)).to.equal(0);
    });
    it("frees the fault for a new order once the previous one is accepted", async function () {
      const s = await loadFixture(fixture);
      const { faultId } = await H.fullCycle(s);
      await expect(s.wo.createOrder(faultId, s.maint2.address)).to.emit(s.wo, "OrderCreated");
    });
  });
});

describe("Reduced variant V1 (prerequisite only, as in the original design)", function () {
  const fixture = () => H.deploySystem(F.PREREQ);
  it("finalizes acceptance with a single sign-off", async function () {
    const s = await loadFixture(fixture);
    const { orderId } = await H.fullCycle(s);
    expect(await s.wo.statusOf(orderId)).to.equal(Status.ACCEPTED);
  });
  it("marks an unqualified repair as rejected (no rework path)", async function () {
    const s = await loadFixture(fixture);
    const { orderId } = await H.fullCycle(s, { post: [120000, 20000, 10000] });
    expect(await s.wo.statusOf(orderId)).to.equal(Status.REJECTED);
  });
});

describe("Monolithic baseline", function () {
  it("executes a complete cycle with the same checks", async function () {
    const [sup, gw, m1, , man] = await ethers.getSigners();
    const M = await (await ethers.getContractFactory("MonolithicMaintenance")).deploy(H.DEFAULT_LIMITS);
    const d = H.deviceWallet(0);
    for (const [a, r] of [[gw.address, Role.ROBOT_DEVICE], [d.address, Role.ROBOT_DEVICE], [m1.address, Role.MAINTENANCE], [man.address, Role.MANUFACTURER]]) {
      await M.registerNode(a, r); await M.authorize(a);
    }
    const ind = [150000, 80000, 30000], raw = ethers.id("raw");
    const sig = await d.signMessage(ethers.getBytes(await M.payloadHash(d.address, ind, raw, H.ZERO, 4, 1)));
    await M.connect(gw).uploadData(d.address, ind, raw, H.ZERO, 4, 1, sig);
    await M.connect(m1).submitDiagnosis(1, 4);
    await M.createOrder(1, m1.address);
    await M.connect(m1).checkIn(1);
    await M.connect(m1).submitReport(1, ethers.id("r"));
    const post = [60000, 20000, 10000], praw = ethers.id("p");
    const psig = await d.signMessage(ethers.getBytes(await M.postPayloadHash(1, d.address, post, praw, 1)));
    await M.connect(man).submitVerification(1, post, praw, 1, psig);
    await M.countersign(1);
    expect(await M.statusOf(1)).to.equal(Status.ACCEPTED);
  });
});
