// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {RobotAccessControl} from "./RobotAccessControl.sol";
import {Flags} from "./Flags.sol";

/// @title Records device-attested condition data and the confirmed diagnosis.
contract FaultDiagnosis {
    uint8 public constant THRESHOLD = 3;

    struct Fault {
        address device;          // robot whose key attested the data
        address submitter;       // gateway account that sent the transaction
        uint32[3] indicators;    // fixed-point condition indicators (x1000)
        bytes32 rawDataHash;     // commitment to the raw off-chain signal
        bytes32 modelHash;       // edge diagnostic model version
        uint8 edgeSeverity;      // severity attested by the edge model (0 = normal)
        uint8 severity;          // severity confirmed by the diagnostician
        bool diagnosed;
        address diagnostician;
        uint64 timestamp;
    }

    RobotAccessControl public immutable ac;
    uint8 public immutable flags;

    mapping(uint256 => Fault) private faults;
    uint256 public faultCount;
    mapping(address => uint256) public lastSeq;

    event FaultUploaded(uint256 indexed faultId, address indexed device, uint8 edgeSeverity, bytes32 rawDataHash);
    event FaultDiagnosed(uint256 indexed faultId, uint8 severity, address indexed diagnostician);
    event WorkOrderTriggered(uint256 indexed faultId, uint8 severity);

    constructor(RobotAccessControl ac_, uint8 flags_) {
        ac = ac_;
        flags = flags_;
    }

    function payloadHash(
        address device,
        uint32[3] calldata indicators,
        bytes32 rawDataHash,
        bytes32 modelHash,
        uint8 edgeSeverity,
        uint256 seq
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), device, indicators, rawDataHash, modelHash, edgeSeverity, seq));
    }

    function uploadData(
        address device,
        uint32[3] calldata indicators,
        bytes32 rawDataHash,
        bytes32 modelHash,
        uint8 edgeSeverity,
        uint256 seq,
        bytes calldata signature
    ) external returns (uint256 faultId) {
        require(ac.hasRole(msg.sender, RobotAccessControl.Role.ROBOT_DEVICE), "FD: caller is not robot device");
        require(edgeSeverity <= 5, "FD: severity out of range");
        if (Flags.on(flags, Flags.SOURCE)) {
            require(ac.hasRole(device, RobotAccessControl.Role.ROBOT_DEVICE), "FD: device not authorized");
            require(seq > lastSeq[device], "FD: replayed payload");
            bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
                payloadHash(device, indicators, rawDataHash, modelHash, edgeSeverity, seq)
            );
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
            require(err == ECDSA.RecoverError.NoError && signer == device, "FD: invalid device signature");
            lastSeq[device] = seq;
        }
        faultId = ++faultCount;
        Fault storage f = faults[faultId];
        f.device = device;
        f.submitter = msg.sender;
        f.indicators = indicators;
        f.rawDataHash = rawDataHash;
        f.modelHash = modelHash;
        f.edgeSeverity = edgeSeverity;
        f.timestamp = uint64(block.timestamp);
        emit FaultUploaded(faultId, device, edgeSeverity, rawDataHash);
    }

    function submitDiagnosis(uint256 faultId, uint8 severity) external {
        require(
            ac.hasRole(msg.sender, RobotAccessControl.Role.MAINTENANCE) ||
                ac.hasRole(msg.sender, RobotAccessControl.Role.MANUFACTURER),
            "FD: caller cannot diagnose"
        );
        Fault storage f = faults[faultId];
        require(f.timestamp != 0, "FD: fault not found");
        require(!f.diagnosed, "FD: already diagnosed");
        require(severity >= 1 && severity <= 5, "FD: severity out of range");
        if (Flags.on(flags, Flags.CONSIST)) {
            require(severity == f.edgeSeverity, "FD: inconsistent with attested data");
        }
        f.severity = severity;
        f.diagnosed = true;
        f.diagnostician = msg.sender;
        emit FaultDiagnosed(faultId, severity, msg.sender);
        if (severity >= THRESHOLD) emit WorkOrderTriggered(faultId, severity);
    }

    function isEligibleForOrder(uint256 faultId) external view returns (bool) {
        Fault storage f = faults[faultId];
        return f.diagnosed && f.severity >= THRESHOLD;
    }

    function deviceOf(uint256 faultId) external view returns (address) {
        return faults[faultId].device;
    }

    function getFault(uint256 faultId) external view returns (Fault memory) {
        return faults[faultId];
    }
}
