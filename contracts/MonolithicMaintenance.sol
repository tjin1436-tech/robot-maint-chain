// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Single-contract state-machine baseline with the same checks as the full modular system.
/// @dev Used only for the design comparison in the paper (gas, size, upgradeability).
contract MonolithicMaintenance {
    enum Role { NONE, ROBOT_DEVICE, MAINTENANCE, MANUFACTURER, SUPERVISOR }
    enum Status { NONE, PENDING, IN_PROGRESS, COMPLETED, ACCEPTED, REJECTED, REWORK, ESCALATED }

    uint8 public constant THRESHOLD = 3;
    uint8 public constant MAX_REWORK = 2;

    struct Node { Role role; bool authorized; uint64 authorizedAt; }
    struct Fault {
        address device; address submitter; uint32[3] indicators; bytes32 rawDataHash; bytes32 modelHash;
        uint8 edgeSeverity; uint8 severity; bool diagnosed; address diagnostician; uint64 timestamp;
    }
    struct Order {
        uint256 faultId; address maintainer; address creator; Status status; uint8 reworkCount;
        bytes32 reportHash; uint64 createdAt; uint64 updatedAt;
    }
    struct Record {
        uint256 orderId; uint32[3] postIndicators; bytes32 rawDataHash; bool qualified; address inspector;
        Role inspectorRole; address countersigner; bool finalized; uint64 timestamp;
    }

    mapping(address => Node) public nodes;
    mapping(uint256 => Fault) private faults;
    mapping(uint256 => Order) private orders;
    mapping(uint256 => Record) private records;
    uint256 public faultCount;
    uint256 public orderCount;
    uint256 public recordCount;
    mapping(address => uint256) public lastSeq;
    mapping(address => uint256) public lastPostSeq;
    mapping(uint256 => uint256) public activeOrderOfFault;
    mapping(uint256 => uint256) public pendingRecordOfOrder;
    uint32[3] public limits;

    event NodeRegistered(address indexed node, Role role);
    event NodeAuthorized(address indexed node, uint64 at);
    event NodeRevoked(address indexed node, uint64 at);
    event FaultUploaded(uint256 indexed faultId, address indexed device, uint8 edgeSeverity, bytes32 rawDataHash);
    event FaultDiagnosed(uint256 indexed faultId, uint8 severity, address indexed diagnostician);
    event WorkOrderTriggered(uint256 indexed faultId, uint8 severity);
    event OrderCreated(uint256 indexed orderId, uint256 indexed faultId, address indexed maintainer);
    event OrderStatusChanged(uint256 indexed orderId, Status status);
    event VerificationSubmitted(uint256 indexed recordId, uint256 indexed orderId, bool qualified, address indexed inspector);
    event VerificationFinalized(uint256 indexed recordId, uint256 indexed orderId, bool qualified, address countersigner);

    constructor(uint32[3] memory limits_) {
        limits = limits_;
        nodes[msg.sender] = Node(Role.SUPERVISOR, true, uint64(block.timestamp));
        emit NodeRegistered(msg.sender, Role.SUPERVISOR);
        emit NodeAuthorized(msg.sender, uint64(block.timestamp));
    }

    // ---------------- access control ----------------
    function hasRole(address node, Role role) public view returns (bool) {
        Node storage n = nodes[node];
        return n.authorized && n.role == role;
    }

    function registerNode(address node, Role role) external {
        require(hasRole(msg.sender, Role.SUPERVISOR), "M: caller is not supervisor");
        require(node != address(0) && role != Role.NONE, "M: invalid node");
        require(nodes[node].role == Role.NONE, "M: node exists");
        nodes[node] = Node(role, false, 0);
        emit NodeRegistered(node, role);
    }

    function authorize(address node) external {
        require(hasRole(msg.sender, Role.SUPERVISOR), "M: caller is not supervisor");
        require(nodes[node].role != Role.NONE, "M: unknown node");
        nodes[node].authorized = true;
        nodes[node].authorizedAt = uint64(block.timestamp);
        emit NodeAuthorized(node, uint64(block.timestamp));
    }

    function revoke(address node) external {
        require(hasRole(msg.sender, Role.SUPERVISOR), "M: caller is not supervisor");
        require(nodes[node].authorized, "M: not authorized");
        nodes[node].authorized = false;
        emit NodeRevoked(node, uint64(block.timestamp));
    }

    // ---------------- fault diagnosis ----------------
    function payloadHash(address device, uint32[3] calldata indicators, bytes32 rawDataHash, bytes32 modelHash, uint8 edgeSeverity, uint256 seq)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), device, indicators, rawDataHash, modelHash, edgeSeverity, seq));
    }

    function uploadData(address device, uint32[3] calldata indicators, bytes32 rawDataHash, bytes32 modelHash, uint8 edgeSeverity, uint256 seq, bytes calldata signature)
        external returns (uint256 faultId)
    {
        require(hasRole(msg.sender, Role.ROBOT_DEVICE), "M: caller is not robot device");
        require(edgeSeverity <= 5, "M: severity out of range");
        require(hasRole(device, Role.ROBOT_DEVICE), "M: device not authorized");
        require(seq > lastSeq[device], "M: replayed payload");
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(payloadHash(device, indicators, rawDataHash, modelHash, edgeSeverity, seq));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        require(err == ECDSA.RecoverError.NoError && signer == device, "M: invalid device signature");
        lastSeq[device] = seq;
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
        require(hasRole(msg.sender, Role.MAINTENANCE) || hasRole(msg.sender, Role.MANUFACTURER), "M: caller cannot diagnose");
        Fault storage f = faults[faultId];
        require(f.timestamp != 0, "M: fault not found");
        require(!f.diagnosed, "M: already diagnosed");
        require(severity >= 1 && severity <= 5, "M: severity out of range");
        require(severity == f.edgeSeverity, "M: inconsistent with attested data");
        f.severity = severity;
        f.diagnosed = true;
        f.diagnostician = msg.sender;
        emit FaultDiagnosed(faultId, severity, msg.sender);
        if (severity >= THRESHOLD) emit WorkOrderTriggered(faultId, severity);
    }

    // ---------------- work orders ----------------
    function createOrder(uint256 faultId, address maintainer) external returns (uint256 orderId) {
        require(hasRole(msg.sender, Role.SUPERVISOR), "M: caller is not supervisor");
        require(hasRole(maintainer, Role.MAINTENANCE), "M: assignee is not maintainer");
        Fault storage f = faults[faultId];
        require(f.diagnosed && f.severity >= THRESHOLD, "M: fault not diagnosed or below threshold");
        require(activeOrderOfFault[faultId] == 0, "M: active order exists for fault");
        orderId = ++orderCount;
        activeOrderOfFault[faultId] = orderId;
        orders[orderId] = Order(faultId, maintainer, msg.sender, Status.PENDING, 0, bytes32(0), uint64(block.timestamp), uint64(block.timestamp));
        emit OrderCreated(orderId, faultId, maintainer);
    }

    function checkIn(uint256 orderId) external {
        Order storage o = _assigned(orderId);
        require(o.status == Status.PENDING || o.status == Status.REWORK, "M: order not pending");
        _set(orderId, o, Status.IN_PROGRESS);
    }

    function submitReport(uint256 orderId, bytes32 reportHash) external {
        Order storage o = _assigned(orderId);
        require(o.status == Status.IN_PROGRESS, "M: order not in progress");
        o.reportHash = reportHash;
        _set(orderId, o, Status.COMPLETED);
    }

    // ---------------- acceptance ----------------
    function postPayloadHash(uint256 orderId, address device, uint32[3] calldata indicators, bytes32 rawDataHash, uint256 seq)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), orderId, device, indicators, rawDataHash, seq));
    }

    function submitVerification(uint256 orderId, uint32[3] calldata indicators, bytes32 rawDataHash, uint256 seq, bytes calldata signature)
        external returns (uint256 recordId)
    {
        Role role = _inspectorRole(msg.sender);
        require(orders[orderId].status == Status.COMPLETED, "M: order not completed");
        require(pendingRecordOfOrder[orderId] == 0, "M: verification already pending");
        _checkPostSignature(orderId, indicators, rawDataHash, seq, signature);
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
        pendingRecordOfOrder[orderId] = recordId;
        emit VerificationSubmitted(recordId, orderId, qualified, msg.sender);
    }

    function countersign(uint256 recordId) external {
        Record storage r = records[recordId];
        require(r.timestamp != 0 && !r.finalized, "M: no pending verification");
        Role role = _inspectorRole(msg.sender);
        require(role != r.inspectorRole, "M: countersigner must hold the other role");
        Order storage o = orders[r.orderId];
        require(o.status == Status.COMPLETED, "M: order not completed");
        r.countersigner = msg.sender;
        r.finalized = true;
        pendingRecordOfOrder[r.orderId] = 0;
        if (r.qualified) {
            _set(r.orderId, o, Status.ACCEPTED);
            _release(o.faultId, r.orderId);
        } else if (o.reworkCount >= MAX_REWORK) {
            _set(r.orderId, o, Status.ESCALATED);
            _release(o.faultId, r.orderId);
        } else {
            o.reworkCount += 1;
            _set(r.orderId, o, Status.REWORK);
        }
        emit VerificationFinalized(recordId, r.orderId, r.qualified, msg.sender);
    }

    function statusOf(uint256 orderId) external view returns (Status) { return orders[orderId].status; }
    function getFault(uint256 id) external view returns (Fault memory) { return faults[id]; }
    function getOrder(uint256 id) external view returns (Order memory) { return orders[id]; }
    function getRecord(uint256 id) external view returns (Record memory) { return records[id]; }

    function _checkPostSignature(uint256 orderId, uint32[3] calldata indicators, bytes32 rawDataHash, uint256 seq, bytes calldata signature) private {
        address device = faults[orders[orderId].faultId].device;
        require(hasRole(device, Role.ROBOT_DEVICE), "M: device not authorized");
        require(seq > lastPostSeq[device], "M: replayed payload");
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(postPayloadHash(orderId, device, indicators, rawDataHash, seq));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        require(err == ECDSA.RecoverError.NoError && signer == device, "M: post-repair data not signed by device");
        lastPostSeq[device] = seq;
    }

    function _assigned(uint256 orderId) private view returns (Order storage o) {
        o = orders[orderId];
        require(o.maintainer == msg.sender, "M: caller is not assigned maintainer");
        require(hasRole(msg.sender, Role.MAINTENANCE), "M: maintainer authorization revoked");
    }

    function _inspectorRole(address who) private view returns (Role) {
        if (hasRole(who, Role.MANUFACTURER)) return Role.MANUFACTURER;
        if (hasRole(who, Role.SUPERVISOR)) return Role.SUPERVISOR;
        revert("M: caller cannot verify");
    }

    function _set(uint256 orderId, Order storage o, Status s) private {
        o.status = s;
        o.updatedAt = uint64(block.timestamp);
        emit OrderStatusChanged(orderId, s);
    }

    function _release(uint256 faultId, uint256 orderId) private {
        if (activeOrderOfFault[faultId] == orderId) activeOrderOfFault[faultId] = 0;
    }
}
