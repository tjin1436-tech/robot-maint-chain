// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Baseline in which an off-chain workflow engine anchors event hashes on-chain.
/// @dev No business rule is evaluated on-chain; the contract only records who anchored what.
contract AnchorOnly {
    struct Anchor { bytes32 eventHash; uint8 kind; address submitter; uint64 timestamp; }

    mapping(address => bool) public engines;
    mapping(uint256 => Anchor) public anchors;
    uint256 public anchorCount;
    address public immutable owner;

    event Anchored(uint256 indexed id, uint8 indexed kind, bytes32 eventHash);

    constructor() {
        owner = msg.sender;
        engines[msg.sender] = true;
    }

    function setEngine(address engine, bool allowed) external {
        require(msg.sender == owner, "A: not owner");
        engines[engine] = allowed;
    }

    function anchor(uint8 kind, bytes32 eventHash) external returns (uint256 id) {
        require(engines[msg.sender], "A: caller is not engine");
        id = ++anchorCount;
        anchors[id] = Anchor(eventHash, kind, msg.sender, uint64(block.timestamp));
        emit Anchored(id, kind, eventHash);
    }
}
