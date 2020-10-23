// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./FaaSPoolLite.sol";

contract FaaSPoolCreatorLite {
    function newBPool() external returns (BPoolLite) {
        return new FaaSPoolLite(msg.sender);
    }
}
