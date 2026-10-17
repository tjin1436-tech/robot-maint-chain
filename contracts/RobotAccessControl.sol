// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Role-based access control shared by all business contracts.
contract RobotAccessControl {
    enum Role { NONE, ROBOT_DEVICE, MAINTENANCE, MANUFACTURER, SUPERVISOR }

    struct Node {
        Role role;
        bool authorized;
        uint64 authorizedAt;
    }

    mapping(address => Node) public nodes;

    event NodeRegistered(address indexed node, Role role);
    event NodeAuthorized(address indexed node, uint64 at);
    event NodeRevoked(address indexed node, uint64 at);

    modifier onlySupervisor() {
        require(hasRole(msg.sender, Role.SUPERVISOR), "AC: caller is not supervisor");
        _;
    }

    constructor() {
        nodes[msg.sender] = Node(Role.SUPERVISOR, true, uint64(block.timestamp));
        emit NodeRegistered(msg.sender, Role.SUPERVISOR);
        emit NodeAuthorized(msg.sender, uint64(block.timestamp));
    }

    function registerNode(address node, Role role) external onlySupervisor {
        require(node != address(0) && role != Role.NONE, "AC: invalid node");
        require(nodes[node].role == Role.NONE, "AC: node exists");
        nodes[node] = Node(role, false, 0);
        emit NodeRegistered(node, role);
    }

    function authorize(address node) external onlySupervisor {
        require(nodes[node].role != Role.NONE, "AC: unknown node");
        nodes[node].authorized = true;
        nodes[node].authorizedAt = uint64(block.timestamp);
        emit NodeAuthorized(node, uint64(block.timestamp));
    }

    function revoke(address node) external onlySupervisor {
        require(nodes[node].authorized, "AC: not authorized");
        nodes[node].authorized = false;
        emit NodeRevoked(node, uint64(block.timestamp));
    }

    function hasRole(address node, Role role) public view returns (bool) {
        Node storage n = nodes[node];
        return n.authorized && n.role == role;
    }

    function roleOf(address node) external view returns (Role) {
        return nodes[node].authorized ? nodes[node].role : Role.NONE;
    }
}
