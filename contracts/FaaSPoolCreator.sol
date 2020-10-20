// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./FaaSPool.sol";

contract FaaSPoolCreator {
    function newBPool() external returns (BPool) {
        return new FaaSPool(msg.sender);
    }
}
