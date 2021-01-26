// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

interface IFreeFromUpTo {
    function freeFromUpTo(address from, uint256 value) external returns (uint256 freed);
}