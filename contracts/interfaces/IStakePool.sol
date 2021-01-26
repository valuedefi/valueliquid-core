// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

interface IStakePool {
    event Deposit(address indexed account, uint256 amount);
    event AddRewardPool(uint256 indexed poolId);
    event UpdateRewardPool(uint256 indexed poolId, uint256 endRewardBlock, uint256 rewardPerBlock);
    event PayRewardPool(uint256 indexed poolId, address indexed rewardToken, address indexed account, uint256 pendingReward, uint256 rebaseAmount, uint256 paidReward);
    event UpdateRewardRebaser(uint256 indexed poolId, address rewardRebaser);
    event UpdateRewardMultiplier(uint256 indexed poolId, address rewardMultiplier);
    event Withdraw(address indexed account, uint256 amount);
    function version() external returns (uint);
    function pair() external returns (address);
    function initialize(address _pair, uint _unstakingFrozenTime, address _rewardFund, address _timelock) external;

    function stake(uint) external;

    function stakeFor(address _account) external;

    function withdraw(uint) external;

    function getReward(uint8 _pid, address _account) external;

    function getAllRewards(address _account) external;

    function pendingReward(uint8 _pid, address _account) external view returns (uint);

    function getEndRewardBlock(uint8 _pid) external view returns (address, uint);
    function getRewardPerBlock(uint8 pid) external view returns (uint);
    function rewardPoolInfoLength() external view returns (uint);

    function unfrozenStakeTime(address _account) external view returns (uint);

    function emergencyWithdraw() external;

    function updateReward() external;

    function updateReward(uint8 _pid) external;

    function updateRewardPool(uint8 _pid, uint256 _endRewardBlock, uint256 _rewardPerBlock) external;

    function getRewardMultiplier(uint8 _pid, uint _from, uint _to, uint _rewardPerBlock) external view returns (uint);

    function getRewardRebase(uint8 _pid, address _rewardToken, uint _pendingReward) external view returns (uint);

    function updateRewardRebaser(uint8 _pid, address _rewardRebaser) external;

    function updateRewardMultiplier(uint8 _pid, address _rewardMultiplier) external;

    function getUserInfo(uint8 _pid, address _account) external view returns (uint amount, uint rewardDebt, uint accumulatedEarned, uint lockReward, uint lockRewardReleased);

    function addRewardPool(
        address _rewardToken,
        address _rewardRebaser,
        address _rewardMultiplier,
        uint256 _startBlock,
        uint256 _endRewardBlock,
        uint256 _rewardPerBlock,
        uint256 _lockRewardPercent,
        uint256 _startVestingBlock,
        uint256 _endVestingBlock
    ) external;


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
