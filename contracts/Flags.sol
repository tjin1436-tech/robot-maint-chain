// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Deployment-time switches used to derive the ablation variants.
/// Each business contract stores the bitmask as an immutable, so a disabled
/// check is skipped entirely rather than evaluated and ignored.
library Flags {
    uint8 internal constant PREREQ = 1;    // cross-contract prerequisite state verification
    uint8 internal constant SOURCE = 2;    // device signature, replay protection, data commitment
    uint8 internal constant CONSIST = 4;   // diagnosis must match device-attested edge severity
    uint8 internal constant LIFECYCLE = 8; // one active order per fault, role re-check, rework, countersign
    uint8 internal constant ALL = 15;

    function on(uint8 flags, uint8 f) internal pure returns (bool) {
        return flags & f != 0;
    }
}
