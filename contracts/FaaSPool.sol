// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./BPool.sol";
import "./IFaaSPool.sol";

interface IFaaSRewardFund {
    function balance(IERC20 _token) external view returns (uint);
    function safeTransfer(IERC20 _token, address _to, uint _value) external;
}

// This implements BPool contract, and allows for generalized staking, yield farming, and token distribution.
contract FaaSPool is BPool, IFaaSPool {
    using SafeMath for uint;

    // Info of each user.
    struct UserInfo {
        uint amount;
        mapping(uint8 => uint) rewardDebt;
        mapping(uint8 => uint) accumulatedEarned; // will accumulate every time user harvest
        uint lastStakeTime;
    }

    // Info of each rewardPool funding.
    struct RewardPoolInfo {
        IERC20 rewardToken;     // Address of rewardPool token contract.
        uint lastRewardBlock;   // Last block number that rewardPool distribution occurs.
        uint endRewardBlock;    // Block number which rewardPool distribution ends.
        uint rewardPerBlock;    // Reward token amount to distribute per block.
        uint accRewardPerShare; // Accumulated rewardPool per share, times 1e18.
    }

    mapping(address => UserInfo) public userInfo;
    RewardPoolInfo[] public rewardPoolInfo;

    IFaaSRewardFund public rewardFund;
    uint public unstakingFrozenTime = 3 days;

    constructor(address _factory) public BPool(_factory) {
    }

    modifier onlyController() {
        require(msg.sender == controller, "!controller");
        _;
    }

    function setRewardFund(IFaaSRewardFund _rewardFund) public onlyController {
        rewardFund = _rewardFund;
    }

    function setUnstakingFrozenTime(uint _unstakingFrozenTime) public onlyController {
        require(unstakingFrozenTime <= 30 days, "please do not lock fund for too long!");
        unstakingFrozenTime = _unstakingFrozenTime;
    }

    function addRewardPool(IERC20 _rewardToken, uint256 _startBlock, uint256 _endRewardBlock, uint256 _rewardPerBlock) public onlyController {
        updateReward();
        rewardPoolInfo.push(RewardPoolInfo({
            rewardToken : _rewardToken,
            lastRewardBlock : (block.number > _startBlock) ? block.number : _startBlock,
            endRewardBlock : _endRewardBlock,
            rewardPerBlock : _rewardPerBlock,
            accRewardPerShare : 0
            }));
    }

    function updateRewardPool(uint8 _pid, uint256 _endRewardBlock, uint256 _rewardPerBlock) public onlyController {
        _updateReward(_pid);
        RewardPoolInfo storage rewardPool = rewardPoolInfo[_pid];
        require(block.number <= rewardPool.endRewardBlock, "Too late to update");
        rewardPool.endRewardBlock = _endRewardBlock;
        rewardPool.rewardPerBlock = _rewardPerBlock;
    }

    function joinPool(uint rewardAmountOut, uint[] calldata maxAmountsIn) external override _lock_ _logs_ {
        _joinPool(rewardAmountOut, maxAmountsIn);
        _stakePoolShare(msg.sender, rewardAmountOut);
    }

    function joinPoolNotStake(uint rewardAmountOut, uint[] calldata maxAmountsIn) external _lock_ _logs_ {
        _joinPool(rewardAmountOut, maxAmountsIn);
        _pushPoolShare(msg.sender, rewardAmountOut);
    }

    function _joinPool(uint rewardAmountOut, uint[] calldata maxAmountsIn) internal {
        require(finalized, "!finalized");

        uint rewardTotal = totalSupply();
        uint ratio = bdiv(rewardAmountOut, rewardTotal);
        require(ratio != 0, "errMathAprox");

        for (uint i = 0; i < _tokens.length; i++) {
            address t = _tokens[i];
            uint bal = _records[t].balance;
            uint tokenAmountIn = bmul(ratio, bal);
            require(tokenAmountIn != 0, "errMathAprox");
            require(tokenAmountIn <= maxAmountsIn[i], "<limIn");
            _records[t].balance = badd(_records[t].balance, tokenAmountIn);
            emit LOG_JOIN(msg.sender, t, tokenAmountIn);
            _pullUnderlying(t, msg.sender, tokenAmountIn);
        }
        _mintPoolShare(rewardAmountOut);
    }

    function stake(uint _shares) external override {
        uint _before = balanceOf(address(this));
        IERC20(address(this)).transferFrom(msg.sender, address(this), _shares);
        uint _after = balanceOf(address(this));
        _shares = bsub(_after, _before); // Additional check for deflationary tokens
        _stakePoolShare(msg.sender, _shares);
    }

    function _stakePoolShare(address _account, uint _shares) internal {
        UserInfo storage user = userInfo[_account];
        updateReward();
        user.amount = user.amount.add(_shares);
        uint8 rewardPoolLength = uint8(rewardPoolInfo.length);
        for (uint8 _pid = 0; _pid < rewardPoolLength; ++_pid) {
            getReward(_pid);
            user.rewardDebt[_pid] = user.rewardDebt[_pid].mul(rewardPoolInfo[_pid].accRewardPerShare).div(1e18);
        }
        user.lastStakeTime = block.timestamp;
    }

    function unfrozenStakeTime(address _account) public view returns (uint) {
        return userInfo[_account].lastStakeTime + unstakingFrozenTime;
    }

    function withdraw(uint _amount) public override {
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= _amount, "_stakedShares < user.amount");
        user.amount = bsub(user.amount, _amount);
        uint8 rewardPoolLength = uint8(rewardPoolInfo.length);
        for (uint8 _pid = 0; _pid < rewardPoolLength; ++_pid) {
            getReward(_pid);
            user.rewardDebt[_pid] = user.amount.mul(rewardPoolInfo[_pid].accRewardPerShare).div(1e18);
        }
        _pushPoolShare(msg.sender, _amount);
    }

    function exit() public override {
        withdraw(userInfo[msg.sender].amount);
    }

    function getAllReward() external override {
        uint8 rewardPoolLength = uint8(rewardPoolInfo.length);
        for (uint8 _pid = 0; _pid < rewardPoolLength; ++_pid) {
            getReward(_pid);
        }
    }

    function getReward(uint8 _pid) public override {
        UserInfo storage user = userInfo[msg.sender];
        RewardPoolInfo storage rewardPool = rewardPoolInfo[_pid];
        uint _pendingReward = user.amount.mul(rewardPool.accRewardPerShare).div(1e18).sub(user.rewardDebt[_pid]);
        if (_pendingReward > 0) {
            user.accumulatedEarned[_pid] = user.accumulatedEarned[_pid].add(_pendingReward);
            rewardFund.safeTransfer(rewardPool.rewardToken, msg.sender, _pendingReward);
        }
    }

    function stakingPower(uint8 _pid, address _account) public override view returns (uint) {
        return userInfo[_account].accumulatedEarned[_pid].add(pendingReward(_pid, _account));
    }

    function pendingReward(uint8 _pid, address _account) public override view returns (uint _pending) {
        UserInfo storage user = userInfo[_account];
        RewardPoolInfo storage rewardPool = rewardPoolInfo[_pid];
        uint _accRewardPerShare = rewardPool.accRewardPerShare;
        uint lpSupply = balanceOf(address(this));
        uint _endRewardBlockApplicable = block.number > rewardPool.endRewardBlock ? rewardPool.endRewardBlock : block.number;
        if (_endRewardBlockApplicable > rewardPool.lastRewardBlock && lpSupply != 0) {
            uint _numBlocks = _endRewardBlockApplicable.sub(rewardPool.lastRewardBlock);
            uint _incRewardPerShare = _numBlocks.mul(rewardPool.rewardPerBlock).mul(1e18).div(lpSupply);
            _accRewardPerShare = _accRewardPerShare.add(_incRewardPerShare);
        }
        _pending = user.amount.mul(_accRewardPerShare).div(1e18).sub(user.rewardDebt[_pid]);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw() external override {
        UserInfo storage user = userInfo[msg.sender];
        _pushPoolShare(msg.sender, user.amount);
        user.amount = 0;
        uint8 rewardPoolLength = uint8(rewardPoolInfo.length);
        for (uint8 _pid = 0; _pid < rewardPoolLength; ++_pid) {
            user.rewardDebt[_pid] = 0;
        }
    }

    function ownedShares(address _account) external override view returns(uint) {
        return balanceOf(msg.sender).add(userInfo[msg.sender].amount);
    }

    function exitPool(uint rewardAmountIn, uint[] calldata minAmountsOut) external override _lock_ _logs_ {
        require(finalized, "!finalized");

        uint rewardTotal = totalSupply();
        uint _exitFee = bmul(rewardAmountIn, exitFee);
        uint pAiAfterExitFee = bsub(rewardAmountIn, _exitFee);
        uint ratio = bdiv(pAiAfterExitFee, rewardTotal);
        require(ratio != 0, "errMathAprox");

        uint _externalShares = balanceOf(msg.sender);
        if (_externalShares < rewardAmountIn) {
            uint _withdrawShares = bsub(rewardAmountIn, _externalShares);
            uint _stakedShares = userInfo[msg.sender].amount;
            require(_stakedShares >= _withdrawShares, "_stakedShares < _withdrawShares");
            withdraw(_withdrawShares);
        }

        _pullPoolShare(msg.sender, rewardAmountIn);
        _pushPoolShare(factory, _exitFee);
        _burnPoolShare(pAiAfterExitFee);

        for (uint i = 0; i < _tokens.length; i++) {
            address t = _tokens[i];
            uint bal = _records[t].balance;
            uint tokenAmountOut = bmul(ratio, bal);
            require(tokenAmountOut != 0, "errMathAprox");
            require(tokenAmountOut >= minAmountsOut[i], "<limO");
            _records[t].balance = bsub(_records[t].balance, tokenAmountOut);
            emit LOG_EXIT(msg.sender, t, tokenAmountOut);
            _pushUnderlying(t, msg.sender, tokenAmountOut);
        }
    }

    function updateReward() public {
        uint8 rewardPoolLength = uint8(rewardPoolInfo.length);
        for (uint8 _pid = 0; _pid < rewardPoolLength; ++_pid) {
            _updateReward(_pid);
        }
    }

    function _updateReward(uint8 _pid) public {
        RewardPoolInfo storage rewardPool = rewardPoolInfo[_pid];
        uint _endRewardBlockApplicable = block.number > rewardPool.endRewardBlock ? rewardPool.endRewardBlock : block.number;
        if (_endRewardBlockApplicable > rewardPool.lastRewardBlock) {
            uint lpSupply = balanceOf(address(this));
            if (lpSupply > 0) {
                uint _numBlocks = _endRewardBlockApplicable.sub(rewardPool.lastRewardBlock);
                uint _incRewardPerShare = _numBlocks.mul(rewardPool.rewardPerBlock).mul(1e18).div(lpSupply);
                rewardPool.accRewardPerShare = rewardPool.accRewardPerShare.add(_incRewardPerShare);
            }
            rewardPool.lastRewardBlock = _endRewardBlockApplicable;
        }
    }
}
