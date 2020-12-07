// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IValueLiquidRegistry {
    function getBestPoolsWithLimit(address, address, uint) external view returns (address[] memory);
}