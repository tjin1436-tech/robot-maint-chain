// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RobotAccessControl} from "./RobotAccessControl.sol";
import {FaultDiagnosis} from "./FaultDiagnosis.sol";
import {Flags} from "./Flags.sol";

/// @title Work order lifecycle with prerequisite verification against FaultDiagnosis.
contract MaintenanceWorkOrder {
    enum Status { NONE, PENDING, IN_PROGRESS, COMPLETED, ACCEPTED, REJECTED, REWORK, ESCALATED }

    uint8 public constant MAX_REWORK = 2;

    struct Order {
        uint256 faultId;
        address maintainer;
        address creator;
        Status status;
        uint8 reworkCount;
        bytes32 reportHash;
        uint64 createdAt;
        uint64 updatedAt;
    }

    RobotAccessControl public immutable ac;
    FaultDiagnosis public immutable fd;
    uint8 public immutable flags;
    address public acceptanceContract;

    mapping(uint256 => Order) private orders;
    uint256 public orderCount;
    mapping(uint256 => uint256) public activeOrderOfFault;

    event OrderCreated(uint256 indexed orderId, uint256 indexed faultId, address indexed maintainer);
    event OrderStatusChanged(uint256 indexed orderId, Status status);

    constructor(RobotAccessControl ac_, FaultDiagnosis fd_, uint8 flags_) {
        ac = ac_;
        fd = fd_;
        flags = flags_;
    }

    function setAcceptanceContract(address acc) external {
        require(ac.hasRole(msg.sender, RobotAccessControl.Role.SUPERVISOR), "WO: caller is not supervisor");
        require(acceptanceContract == address(0), "WO: already set");
        require(acc != address(0), "WO: zero address");
        acceptanceContract = acc;
    }

    function createOrder(uint256 faultId, address maintainer) external returns (uint256 orderId) {
        require(ac.hasRole(msg.sender, RobotAccessControl.Role.SUPERVISOR), "WO: caller is not supervisor");
        require(ac.hasRole(maintainer, RobotAccessControl.Role.MAINTENANCE), "WO: assignee is not maintainer");
        if (Flags.on(flags, Flags.PREREQ)) {
            require(fd.isEligibleForOrder(faultId), "WO: fault not diagnosed or below threshold");
        }
        orderId = ++orderCount;
        if (Flags.on(flags, Flags.LIFECYCLE)) {
            require(activeOrderOfFault[faultId] == 0, "WO: active order exists for fault");
            activeOrderOfFault[faultId] = orderId;
        }
        orders[orderId] = Order(faultId, maintainer, msg.sender, Status.PENDING, 0, bytes32(0), uint64(block.timestamp), uint64(block.timestamp));
        emit OrderCreated(orderId, faultId, maintainer);
    }

    function checkIn(uint256 orderId) external {
        Order storage o = _assigned(orderId);
        require(
            o.status == Status.PENDING || (Flags.on(flags, Flags.LIFECYCLE) && o.status == Status.REWORK),
            "WO: order not pending"
        );
        _set(orderId, o, Status.IN_PROGRESS);
    }

    function submitReport(uint256 orderId, bytes32 reportHash) external {
        Order storage o = _assigned(orderId);
        require(o.status == Status.IN_PROGRESS, "WO: order not in progress");
        o.reportHash = reportHash;
        _set(orderId, o, Status.COMPLETED);
    }

    /// @notice Called by the acceptance contract when a verification is finalized.
    function closeOrder(uint256 orderId, bool qualified) external {
        require(msg.sender == acceptanceContract, "WO: caller is not acceptance contract");
        Order storage o = orders[orderId];
        if (qualified) {
            _set(orderId, o, Status.ACCEPTED);
            _release(o.faultId, orderId);
        } else if (Flags.on(flags, Flags.LIFECYCLE)) {
            if (o.reworkCount >= MAX_REWORK) {
                _set(orderId, o, Status.ESCALATED);
                _release(o.faultId, orderId);
            } else {
                o.reworkCount += 1;
                _set(orderId, o, Status.REWORK);
            }
        } else {
            _set(orderId, o, Status.REJECTED);
        }
    }

    function statusOf(uint256 orderId) external view returns (Status) {
        return orders[orderId].status;
    }

    function faultOf(uint256 orderId) external view returns (uint256) {
        return orders[orderId].faultId;
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function _assigned(uint256 orderId) private view returns (Order storage o) {
        o = orders[orderId];
        require(o.maintainer == msg.sender, "WO: caller is not assigned maintainer");
        if (Flags.on(flags, Flags.LIFECYCLE)) {
            require(ac.hasRole(msg.sender, RobotAccessControl.Role.MAINTENANCE), "WO: maintainer authorization revoked");
        }
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
