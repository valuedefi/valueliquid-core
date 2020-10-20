// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IFaaSPool {
    function stake(uint) external;
    function withdraw(uint) external;
    function exit() external;
    function getReward(uint8 _pid) external;
    function getAllReward() external;
    function ownedShares(address _account) external view returns (uint);
    function stakingPower(uint8 _pid, address _account) external view returns (uint);
    function pendingReward(uint8 _pid, address _account) external view returns (uint);
    function emergencyWithdraw() external;
}
