// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {RobotAccessControl} from "../../contracts/RobotAccessControl.sol";
import {FaultDiagnosis} from "../../contracts/FaultDiagnosis.sol";
import {MaintenanceWorkOrder} from "../../contracts/MaintenanceWorkOrder.sol";
import {Acceptance} from "../../contracts/Acceptance.sol";

/// @notice Drives the system with random sequences of honest and adversarial calls.
contract Handler is Test {
    RobotAccessControl public ac;
    FaultDiagnosis public fd;
    MaintenanceWorkOrder public wo;
    Acceptance public acc;

    uint256[3] internal devicePk = [uint256(0xD1), 0xD2, 0xD3];
    uint256 internal constant ROGUE_PK = 0xBAD;
    address public gateway = address(0x6A7E);
    address public maint1 = address(0x1111);
    address public maint2 = address(0x2222);
    address public manufacturer = address(0x3333);
    address public supervisor;

    mapping(address => uint256) internal nextSeq;
    mapping(address => uint256) internal nextPostSeq;

    // ghost state
    mapping(bytes32 => bool) public signedUpload;   // payloads actually signed by the device
    mapping(bytes32 => uint256) public uploadUses;  // how often a signed payload was written
    mapping(bytes32 => bool) public signedPost;
    uint256 public ghostVerifyOnIncomplete;         // verifications written while order not COMPLETED
    uint256 public ghostRevokedTransitions;         // transitions by a revoked maintainer
    uint256 public ghostReplays;                    // signed payload written more than once
    uint256 public calls;
    mapping(bytes4 => uint256) public callsBy;

    constructor(uint8 flags) {
        supervisor = address(this);
        ac = new RobotAccessControl();
        fd = new FaultDiagnosis(ac, flags);
        wo = new MaintenanceWorkOrder(ac, fd, flags);
        uint32[3] memory limits = [uint32(100000), 50000, 20000];
        acc = new Acceptance(ac, fd, wo, limits, flags);
        wo.setAcceptanceContract(address(acc));
        _reg(gateway, RobotAccessControl.Role.ROBOT_DEVICE);
        _reg(vm.addr(ROGUE_PK), RobotAccessControl.Role.ROBOT_DEVICE); // compromised gateway
        for (uint256 i; i < 3; i++) _reg(vm.addr(devicePk[i]), RobotAccessControl.Role.ROBOT_DEVICE);
        _reg(maint1, RobotAccessControl.Role.MAINTENANCE);
        _reg(maint2, RobotAccessControl.Role.MAINTENANCE);
        _reg(manufacturer, RobotAccessControl.Role.MANUFACTURER);
    }

    function _reg(address a, RobotAccessControl.Role r) internal {
        ac.registerNode(a, r);
        ac.authorize(a);
    }

    modifier counted() { calls++; callsBy[msg.sig]++; _; }

    uint256 public okUploads; uint256 public okDiagnoses; uint256 public okOrders; uint256 public okReports;
    uint256 public okVerifications; uint256 public okFinalized;
    function countAccepted() external view returns (uint256 accepted, uint256 rework, uint256 escalated) {
        for (uint256 i = 1; i <= wo.orderCount(); i++) {
            MaintenanceWorkOrder.Status st = wo.statusOf(i);
            if (st == MaintenanceWorkOrder.Status.ACCEPTED) accepted++;
            else if (st == MaintenanceWorkOrder.Status.REWORK) rework++;
            else if (st == MaintenanceWorkOrder.Status.ESCALATED) escalated++;
        }
    }

    function _sign(uint256 pk, bytes32 h) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(h));
        return abi.encodePacked(r, s, v);
    }

    function _uploadKey(address device, uint32[3] memory ind, bytes32 raw, uint8 sev, uint256 seq) internal pure returns (bytes32) {
        return keccak256(abi.encode(device, ind, raw, sev, seq));
    }

    // ---------------- actions ----------------
    /// mode: 0 honest, 1 forged signature, 2 replay last payload, 3 tamper after signing
    function upload(uint256 devSeed, uint32 a, uint32 b, uint32 c, uint8 sev, uint8 mode) external counted {
        uint256 pk = devicePk[devSeed % 3];
        address device = vm.addr(pk);
        sev = sev % 6;
        uint32[3] memory ind = [a % 220000, b % 140000, c % 60000];
        bytes32 raw = keccak256(abi.encode(a, b, c, calls));
        // modes 0-4 honest (biased towards valid traffic), 5 forged, 6 replay, 7 tampered
        mode = mode % 8;
        mode = mode <= 4 ? 0 : mode - 4;
        uint256 seq = mode == 2 && nextSeq[device] > 0 ? nextSeq[device] : nextSeq[device] + 1;
        bytes memory sig;
        if (mode == 2 && nextSeq[device] > 0) {
            // replay: reuse the last honestly signed payload of this device
            (ind, raw, sev) = (lastInd[device], lastRaw[device], lastSev[device]);
            sig = _sign(pk, fd.payloadHash(device, ind, raw, bytes32(0), sev, seq));
        } else if (mode == 1) {
            sig = _sign(ROGUE_PK, fd.payloadHash(device, ind, raw, bytes32(0), sev, seq));
        } else {
            sig = _sign(pk, fd.payloadHash(device, ind, raw, bytes32(0), sev, seq));
            signedUpload[_uploadKey(device, ind, raw, sev, seq)] = true;
            if (mode == 3) ind[0] = ind[0] + 1; // altered in transit
        }
        address sender = mode == 0 ? gateway : vm.addr(ROGUE_PK);
        vm.prank(sender);
        try fd.uploadData(device, ind, raw, bytes32(0), sev, seq, sig) {
            bytes32 k = _uploadKey(device, ind, raw, sev, seq);
            uploadUses[k]++;
            if (uploadUses[k] > 1) ghostReplays++;
            faultKey[fd.faultCount()] = k;
            okUploads++;
            if (mode == 0) { nextSeq[device] = seq; lastInd[device] = ind; lastRaw[device] = raw; lastSev[device] = sev; }
        } catch {}
    }
    mapping(address => uint32[3]) internal lastInd;
    mapping(address => bytes32) internal lastRaw;
    mapping(address => uint8) internal lastSev;
    mapping(uint256 => bytes32) public faultKey;

    function diagnose(uint256 faultSeed, uint8 sev, bool byManufacturer, bool honest) external counted {
        uint256 n = fd.faultCount();
        if (n == 0) return;
        uint256 id = faultSeed % 16 == 0 ? n + 1 : 1 + (faultSeed % n); // occasionally a nonexistent id
        uint8 s = honest && id <= n ? fd.getFault(id).edgeSeverity : 1 + (sev % 5);
        vm.prank(byManufacturer ? manufacturer : maint1);
        try fd.submitDiagnosis(id, s) { okDiagnoses++; } catch {}
    }

    function createOrder(uint256 faultSeed, bool useMaint2) external counted {
        uint256 n = fd.faultCount();
        uint256 id = n == 0 || faultSeed % 16 == 0 ? n + 1 : 1 + (faultSeed % n);
        try wo.createOrder(id, useMaint2 ? maint2 : maint1) { okOrders++; } catch {}
    }

    function checkIn(uint256 orderSeed, bool asOther) external counted {
        uint256 n = wo.orderCount();
        if (n == 0) return;
        uint256 id = 1 + (orderSeed % n);
        address who = asOther ? maint2 : wo.getOrder(id).maintainer;
        bool revoked = !ac.hasRole(who, RobotAccessControl.Role.MAINTENANCE);
        vm.prank(who);
        try wo.checkIn(id) { if (revoked) ghostRevokedTransitions++; } catch {}
    }

    function submitReport(uint256 orderSeed, bool asOther) external counted {
        uint256 n = wo.orderCount();
        if (n == 0) return;
        uint256 id = 1 + (orderSeed % n);
        address who = asOther ? maint2 : wo.getOrder(id).maintainer;
        bool revoked = !ac.hasRole(who, RobotAccessControl.Role.MAINTENANCE);
        vm.prank(who);
        try wo.submitReport(id, keccak256(abi.encode(id, calls))) { okReports++; if (revoked) ghostRevokedTransitions++; } catch {}
    }

    function verify(uint256 orderSeed, bool bySupervisor, bool qualified, bool forgeSig) external counted {
        uint256 n = wo.orderCount();
        if (n == 0) return;
        uint256 id = 1 + (orderSeed % n);
        address device = fd.deviceOf(wo.faultOf(id));
        uint256 pk;
        for (uint256 i; i < 3; i++) if (vm.addr(devicePk[i]) == device) pk = devicePk[i];
        if (pk == 0 || forgeSig) pk = ROGUE_PK;
        uint32[3] memory ind = qualified ? [uint32(60000), 20000, 10000] : [uint32(130000), 20000, 10000];
        bytes32 raw = keccak256(abi.encode("post", id, calls));
        uint256 seq = nextPostSeq[device] + 1;
        bytes memory sig = _sign(pk, acc.payloadHash(id, device, ind, raw, seq));
        if (!forgeSig && pk != ROGUE_PK) signedPost[keccak256(abi.encode(id, device, ind, raw))] = true;
        bool wasCompleted = wo.statusOf(id) == MaintenanceWorkOrder.Status.COMPLETED;
        vm.prank(bySupervisor ? supervisor : manufacturer);
        try acc.submitVerification(id, ind, raw, seq, sig) {
            nextPostSeq[device] = seq;
            okVerifications++;
            if (!wasCompleted) ghostVerifyOnIncomplete++;
        } catch {}
    }

    function countersign(uint256 recordSeed, bool bySupervisor) external counted {
        uint256 n = acc.recordCount();
        if (n == 0) return;
        vm.prank(bySupervisor ? supervisor : manufacturer);
        try acc.countersign(1 + (recordSeed % n)) { okFinalized++; } catch {}
    }

    function toggleMaint2() external counted {
        if (ac.hasRole(maint2, RobotAccessControl.Role.MAINTENANCE)) ac.revoke(maint2);
        else ac.authorize(maint2);
    }
}

contract SystemInvariants is Test {
    Handler internal h;

    function setUp() public {
        uint8 flags = uint8(vm.envOr("FLAGS", uint256(15)));
        h = new Handler(flags);
        targetContract(address(h));
    }

    /// I1: every work order references a diagnosed fault at or above the threshold.
    function invariant_I1_orderHasJustification() public view {
        MaintenanceWorkOrder wo = h.wo();
        for (uint256 i = 1; i <= wo.orderCount(); i++) {
            assertTrue(h.fd().isEligibleForOrder(wo.getOrder(i).faultId), "order without justified fault");
        }
    }

    /// I2: no verification record is written for an order that had not completed repair.
    function invariant_I2_verificationNeedsCompletion() public view {
        assertEq(h.ghostVerifyOnIncomplete(), 0, "verification written for incomplete order");
    }

    /// I3: at most one active (non-terminal) work order per fault.
    function invariant_I3_singleActiveOrder() public view {
        MaintenanceWorkOrder wo = h.wo();
        uint256 n = wo.orderCount();
        for (uint256 i = 1; i <= n; i++) {
            MaintenanceWorkOrder.Order memory a = wo.getOrder(i);
            if (!_active(a.status)) continue;
            for (uint256 j = i + 1; j <= n; j++) {
                MaintenanceWorkOrder.Order memory b = wo.getOrder(j);
                if (_active(b.status)) assertTrue(a.faultId != b.faultId, "two active orders for one fault");
            }
        }
    }

    /// I4: every fault record reproduces a payload actually signed by its device, written once.
    function invariant_I4_faultDataIsDeviceAttested() public view {
        FaultDiagnosis fd = h.fd();
        for (uint256 i = 1; i <= fd.faultCount(); i++) {
            assertTrue(h.signedUpload(h.faultKey(i)), "fault data not attested by device");
        }
        assertEq(h.ghostReplays(), 0, "signed payload written twice");
    }

    /// I5: every confirmed diagnosis equals the device-attested edge severity.
    function invariant_I5_diagnosisConsistent() public view {
        FaultDiagnosis fd = h.fd();
        for (uint256 i = 1; i <= fd.faultCount(); i++) {
            FaultDiagnosis.Fault memory f = fd.getFault(i);
            if (f.diagnosed) assertEq(f.severity, f.edgeSeverity, "diagnosis inconsistent with attested data");
        }
    }

    /// I6: every finalized acceptance carries two sign-offs from different roles, on device-signed data.
    function invariant_I6_acceptanceDualAndAttested() public view {
        Acceptance acc = h.acc();
        MaintenanceWorkOrder wo = h.wo();
        for (uint256 i = 1; i <= acc.recordCount(); i++) {
            Acceptance.Record memory r = acc.getRecord(i);
            address device = h.fd().deviceOf(wo.faultOf(r.orderId));
            assertTrue(h.signedPost(keccak256(abi.encode(r.orderId, device, r.postIndicators, r.rawDataHash))), "post-repair data not attested");
            if (r.finalized) assertTrue(r.countersigner != address(0), "acceptance finalized by one party");
        }
    }

    /// I7: revoked maintainers never advance an order; rework rounds stay bounded.
    function invariant_I7_lifecycleBounded() public view {
        assertEq(h.ghostRevokedTransitions(), 0, "revoked maintainer advanced an order");
        MaintenanceWorkOrder wo = h.wo();
        for (uint256 i = 1; i <= wo.orderCount(); i++) assertLe(wo.getOrder(i).reworkCount, wo.MAX_REWORK());
    }

    function afterInvariant() public {
        (uint256 a, uint256 r, uint256 e) = h.countAccepted();
        string memory line = string.concat(
            vm.toString(h.okUploads()), ",", vm.toString(h.okDiagnoses()), ",", vm.toString(h.okOrders()), ",",
            vm.toString(h.okReports()), ",", vm.toString(h.okVerifications()), ",", vm.toString(h.okFinalized()), ",",
            vm.toString(a), ",", vm.toString(r), ",", vm.toString(e)
        );
        vm.writeLine(string.concat("foundry/metrics-", vm.toString(vm.envOr("FLAGS", uint256(15))), ".csv"), line);
    }

    function _active(MaintenanceWorkOrder.Status s) internal pure returns (bool) {
        return s == MaintenanceWorkOrder.Status.PENDING || s == MaintenanceWorkOrder.Status.IN_PROGRESS
            || s == MaintenanceWorkOrder.Status.COMPLETED || s == MaintenanceWorkOrder.Status.REWORK;
    }
}
