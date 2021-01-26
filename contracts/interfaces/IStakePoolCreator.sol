// SPDX-License-Identifier: MIT
pragma abicoder v2;
pragma solidity 0.7.6;

interface IStakePoolCreator {
    function version() external returns (uint);
    function create() external returns (address);
}