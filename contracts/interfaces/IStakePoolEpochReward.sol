// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

interface IStakePoolEpochReward {
    event Deposit(address indexed account, uint256 amount);
    event PayRewardPool(uint256 indexed poolId, address indexed rewardToken, address indexed account, uint256 pendingReward, uint256 rebaseAmount, uint256 paidReward);
    event Withdraw(address indexed account, uint256 amount);

    function version() external returns (uint);
    function pair() external returns (address);
    function initialize(address _pair, uint256 _withdrawLockupEpochs, uint256 _rewardLockupEpochs, address _epochController, address _rewardToken, address _rewardFund, address _timelock) external;

    function epoch() external view returns (uint256);

    function nextEpochPoint() external view returns (uint256);

    function nextEpochLength() external view returns (uint256);

    function earned(address _account) external view returns (uint);

    function unlockWithdrawEpoch(address _account) external view returns (uint256);

    function unlockRewardEpoch(address _account) external view returns (uint256);

    function stake(uint) external;

    function stakeFor(address _account) external;

    function withdraw(uint) external;

    function claimReward() external;

    function emergencyWithdraw() external;

    function removeLiquidity(
        address provider,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB);

    function removeLiquidityETH(
        address provider,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountToken, uint amountETH);

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address provider,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountETH);
}
