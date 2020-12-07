// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./IBPool.sol";

interface IBFactory {
    function newBPool() external returns (IBPool);
}