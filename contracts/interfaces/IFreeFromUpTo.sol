// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IFreeFromUpTo {
    function freeFromUpTo(address from, uint256 value) external returns (uint256 freed);
}