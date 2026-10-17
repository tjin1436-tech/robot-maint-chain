// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {RobotAccessControl} from "./RobotAccessControl.sol";
import {FaultDiagnosis} from "./FaultDiagnosis.sol";
import {MaintenanceWorkOrder} from "./MaintenanceWorkOrder.sol";
import {Flags} from "./Flags.sol";

/// @title Repair verification with device-attested post-repair data and dual sign-off.
contract Acceptance {
    struct Record {
        uint256 orderId;
        uint32[3] postIndicators;
        bytes32 rawDataHash;
        bool qualified;
        address inspector;
        RobotAccessControl.Role inspectorRole;
        address countersigner;
        bool finalized;
        uint64 timestamp;
    }

    RobotAccessControl public immutable ac;
    FaultDiagnosis public immutable fd;
    MaintenanceWorkOrder public immutable wo;
    uint8 public immutable flags;
    uint32[3] public limits;

    mapping(uint256 => Record) private records;
    uint256 public recordCount;
    mapping(uint256 => uint256) public pendingRecordOfOrder;
    mapping(address => uint256) public lastSeq;

    event VerificationSubmitted(uint256 indexed recordId, uint256 indexed orderId, bool qualified, address indexed inspector);
    event VerificationFinalized(uint256 indexed recordId, uint256 indexed orderId, bool qualified, address countersigner);

    constructor(RobotAccessControl ac_, FaultDiagnosis fd_, MaintenanceWorkOrder wo_, uint32[3] memory limits_, uint8 flags_) {
        ac = ac_;
        fd = fd_;
        wo = wo_;
        limits = limits_;
        flags = flags_;
    }

    function payloadHash(uint256 orderId, address device, uint32[3] calldata indicators, bytes32 rawDataHash, uint256 seq)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), orderId, device, indicators, rawDataHash, seq));
    }

    function submitVerification(
        uint256 orderId,
        uint32[3] calldata indicators,
        bytes32 rawDataHash,
        uint256 seq,
        bytes calldata signature
    ) external returns (uint256 recordId) {
        RobotAccessControl.Role role = _inspectorRole(msg.sender);
        if (Flags.on(flags, Flags.PREREQ)) {
            require(wo.statusOf(orderId) == MaintenanceWorkOrder.Status.COMPLETED, "ACC: order not completed");
        }
        if (Flags.on(flags, Flags.LIFECYCLE)) {
            require(pendingRecordOfOrder[orderId] == 0, "ACC: verification already pending");
        }
        if (Flags.on(flags, Flags.SOURCE)) {
            address device = fd.deviceOf(wo.faultOf(orderId));
            require(ac.hasRole(device, RobotAccessControl.Role.ROBOT_DEVICE), "ACC: device not authorized");
            require(seq > lastSeq[device], "ACC: replayed payload");
            bytes32 digest = MessageHashUtils.toEthSignedMessageHash(payloadHash(orderId, device, indicators, rawDataHash, seq));
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
            require(err == ECDSA.RecoverError.NoError && signer == device, "ACC: post-repair data not signed by device");
            lastSeq[device] = seq;
        }
        bool qualified = indicators[0] < limits[0] && indicators[1] < limits[1] && indicators[2] < limits[2];
        recordId = ++recordCount;
        Record storage r = records[recordId];
        r.orderId = orderId;
        r.postIndicators = indicators;
        r.rawDataHash = rawDataHash;
        r.qualified = qualified;
        r.inspector = msg.sender;
        r.inspectorRole = role;
        r.timestamp = uint64(block.timestamp);
        emit VerificationSubmitted(recordId, orderId, qualified, msg.sender);
        if (Flags.on(flags, Flags.LIFECYCLE)) {
            pendingRecordOfOrder[orderId] = recordId;
        } else {
            _finalize(recordId, r);
        }
    }

    /// @notice Second sign-off by the other inspecting role (MANUFACTURER vs SUPERVISOR).
    function countersign(uint256 recordId) external {
        require(Flags.on(flags, Flags.LIFECYCLE), "ACC: countersign disabled");
        Record storage r = records[recordId];
        require(r.timestamp != 0 && !r.finalized, "ACC: no pending verification");
        RobotAccessControl.Role role = _inspectorRole(msg.sender);
        require(role != r.inspectorRole, "ACC: countersigner must hold the other role");
        if (Flags.on(flags, Flags.PREREQ)) {
            require(wo.statusOf(r.orderId) == MaintenanceWorkOrder.Status.COMPLETED, "ACC: order not completed");
        }
        r.countersigner = msg.sender;
        pendingRecordOfOrder[r.orderId] = 0;
        _finalize(recordId, r);
    }

    function getRecord(uint256 recordId) external view returns (Record memory) {
        return records[recordId];
    }

    function _inspectorRole(address who) private view returns (RobotAccessControl.Role) {
        if (ac.hasRole(who, RobotAccessControl.Role.MANUFACTURER)) return RobotAccessControl.Role.MANUFACTURER;
        if (ac.hasRole(who, RobotAccessControl.Role.SUPERVISOR)) return RobotAccessControl.Role.SUPERVISOR;
        revert("ACC: caller cannot verify");
    }

    function _finalize(uint256 recordId, Record storage r) private {
        r.finalized = true;
        emit VerificationFinalized(recordId, r.orderId, r.qualified, r.countersigner);
        wo.closeOrder(r.orderId, r.qualified);
    }
}
