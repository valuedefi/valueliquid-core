// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "./interfaces/IStakePoolRewardFund.sol";
import "./interfaces/IStakePool.sol";
import "./interfaces/IStakePoolRewardRebaser.sol";
import "./interfaces/IStakePoolRewardMultiplier.sol";
import "./interfaces/IERC20.sol";
import './libraries/SafeMath.sol';
import './libraries/TransferHelper.sol';
import "./interfaces/IStakePool.sol";
contract StakePoolRewardFund is IStakePoolRewardFund {
    uint256 public constant BLOCKS_PER_DAY = 6528;
    address public stakePool;
    address public timelock;
    bool private _initialized;

    function initialize(address _stakePool, address _timelock) external override {
        require(_initialized == false, "StakePoolRewardFund: already initialized");
        stakePool = _stakePool;
        timelock = _timelock;
        _initialized = true;
    }

    function safeTransfer(address _token, address _to, uint256 _value) external override {
        require(msg.sender == stakePool, "StakePoolRewardFund: !stakePool");
        TransferHelper.safeTransfer(_token, _to, _value);
    }

    function recoverRewardToken(
        address _token,
        uint256 _amount,
        address _to
    ) external  {
        require(msg.sender == timelock, "StakePoolRewardFund: !timelock");
        uint256 length = IStakePool(stakePool).rewardPoolInfoLength();
        for (uint8 pid = 0; pid < length; ++pid) {
            (address rewardToken,uint endRewardBlock) = IStakePool(stakePool).getEndRewardBlock(pid);
            if (rewardToken == _token) {
                // do not allow to drain reward token if less than 2 months after pool ends
                require(block.number >= (endRewardBlock + (BLOCKS_PER_DAY * 30)), "StakePoolRewardFund: blockNumber < 30 days since endRewardBlock");
            }
        }
        TransferHelper.safeTransfer(_token, _to, _amount);
    }
}
