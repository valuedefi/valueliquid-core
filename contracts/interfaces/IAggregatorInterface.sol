// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0;

interface IAggregatorInterface {
    function latestAnswer() external view returns (int256);
}
