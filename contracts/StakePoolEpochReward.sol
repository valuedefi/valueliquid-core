// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "./interfaces/IEpochController.sol";
import "./interfaces/IStakePoolEpochReward.sol";
import "./interfaces/IValueLiquidProvider.sol";
import "./interfaces/IStakePoolController.sol";
import "./interfaces/IStakePoolRewardRebaser.sol";
import "./interfaces/IStakePoolRewardMultiplier.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IValueLiquidPair.sol";
import './libraries/SafeMath.sol';
import './libraries/TransferHelper.sol';
import "./interfaces/IStakePoolRewardFund.sol";

// This implements BPool contract, and allows for generalized staking, yield farming (by epoch), and token distribution.
contract StakePoolEpochReward is IStakePoolEpochReward {
    using SafeMath for uint;
    uint public override version;

    /* ========== DATA STRUCTURES ========== */

    struct UserInfo {
        uint256 amount;
        uint256 lastSnapshotIndex;
        uint256 rewardEarned;
        uint256 epochTimerStart;
    }

    struct Snapshot {
        uint256 time;
        uint256 rewardReceived;
        uint256 rewardPerShare;
    }

    /* ========== STATE VARIABLES ========== */

    address epochController;
    address rewardToken;

    uint256 public withdrawLockupEpochs;
    uint256 public rewardLockupEpochs;

    mapping(address => UserInfo) public userInfo;
    Snapshot[] public snapshotHistory;

    address public override pair;
    address public rewardFund;
    address public timelock;
    address public controller;

    uint public balance;
    uint private _unlocked = 1;
    bool private _initialized = false;
    bool public emergencyWithdrawAllowed = false;

    constructor(address _controller, uint _version) public {
        controller = _controller;
        timelock = _controller;
        version = _version;
    }

    modifier lock() {
        require(_unlocked == 1, 'StakePoolEpochReward: LOCKED');
        _unlocked = 0;
        _;
        _unlocked = 1;
    }

    modifier onlyTimeLock() {
        require(msg.sender == timelock, "StakePoolEpochReward: !timelock");
        _;
    }

    modifier allowEmergencyWithdraw() {
        require(emergencyWithdrawAllowed, "StakePoolEpochReward: !emergencyWithdrawAllowed");
        _;
    }

    modifier updateReward(address _account) {
        if (_account != address(0)) {
            UserInfo memory user = userInfo[_account];
            user.rewardEarned = earned(_account);
            user.lastSnapshotIndex = latestSnapshotIndex();
            userInfo[_account] = user;
        }
        _;
    }

    // called once by the factory at time of deployment
    function initialize(address _pair, uint256 _withdrawLockupEpochs, uint256 _rewardLockupEpochs, address _epochController, address _rewardToken, address _rewardFund, address _timelock) external override {
        require(_initialized == false, "StakePoolEpochReward: Initialize must be false.");
        pair = _pair;
        withdrawLockupEpochs = _withdrawLockupEpochs;
        rewardLockupEpochs = _rewardLockupEpochs;
        epochController = _epochController;
        rewardToken = _rewardToken;
        rewardFund = _rewardFund;
        timelock = _timelock;
        _initialized = true;
    }

    /* ========== VIEW FUNCTIONS ========== */

    // =========== Epoch getters

    function epoch() public override view returns (uint256) {
        return IEpochController(epochController).epoch();
    }

    function nextEpochPoint() external override view returns (uint256) {
        return IEpochController(epochController).nextEpochPoint();
    }

    function nextEpochLength() external override view returns (uint256) {
        return IEpochController(epochController).nextEpochLength();
    }

    // =========== Snapshot getters

    function latestSnapshotIndex() public view returns (uint256) {
        return snapshotHistory.length.sub(1);
    }

    function getLatestSnapshot() internal view returns (Snapshot memory) {
        return snapshotHistory[latestSnapshotIndex()];
    }

    function getLastSnapshotIndexOf(address _account) public view returns (uint256) {
        return userInfo[_account].lastSnapshotIndex;
    }

    function getLastSnapshotOf(address _account) internal view returns (Snapshot memory) {
        return snapshotHistory[getLastSnapshotIndexOf(_account)];
    }

    // =========== _account getters

    function rewardPerShare() public view returns (uint256) {
        return getLatestSnapshot().rewardPerShare;
    }

    function earned(address _account) public override view returns (uint256) {
        uint256 latestRPS = getLatestSnapshot().rewardPerShare;
        uint256 storedRPS = getLastSnapshotOf(_account).rewardPerShare;

        UserInfo memory user = userInfo[_account];
        return user.amount.mul(latestRPS.sub(storedRPS)).div(1e18).add(user.rewardEarned);
    }

    function canWithdraw(address _account) external view returns (bool) {
        return userInfo[_account].epochTimerStart.add(withdrawLockupEpochs) <= epoch();
    }

    function canClaimReward(address _account) external view returns (bool) {
        return userInfo[_account].epochTimerStart.add(rewardLockupEpochs) <= epoch();
    }

    function unlockWithdrawEpoch(address _account) public override view returns (uint) {
        return userInfo[_account].epochTimerStart.add(withdrawLockupEpochs);
    }

    function unlockRewardEpoch(address _account) public override view returns (uint) {
        return userInfo[_account].epochTimerStart.add(rewardLockupEpochs);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function stake(uint _amount) external lock override {
        IValueLiquidPair(pair).transferFrom(msg.sender, address(this), _amount);
        _stakeFor(msg.sender);
    }

    function stakeFor(address _account) external lock override {
        require(IStakePoolController(controller).isWhitelistStakingFor(msg.sender), "StakePoolEpochReward: Invalid sender");
        _stakeFor(_account);
    }

    function _stakeFor(address _account) internal {
        uint _amount = IValueLiquidPair(pair).balanceOf(address(this)).sub(balance);
        require(_amount > 0, "StakePoolEpochReward: Invalid balance");
        balance = balance.add(_amount);
        UserInfo memory user = userInfo[_account];
        user.epochTimerStart = epoch(); // reset timer
        user.amount = user.amount.add(_amount);
        userInfo[_account] = user;
        emit Deposit(_account, _amount);
    }

    function removeStakeInternal(uint _amount) internal {
        UserInfo memory user = userInfo[msg.sender];
        require(user.epochTimerStart.add(withdrawLockupEpochs) <= epoch(), "StakePoolEpochReward: still in withdraw lockup");
        require(user.amount >= _amount, "StakePoolEpochReward: invalid withdraw amount");
        claimReward();
        balance = balance.sub(_amount);
        user.amount = user.amount.sub(_amount);
        user = userInfo[msg.sender];
    }

    function withdraw(uint _amount) external lock override {
        removeStakeInternal(_amount);
        IValueLiquidPair(pair).transfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
    }

    function claimReward() public override updateReward(msg.sender) {
        UserInfo memory user = userInfo[msg.sender];
        uint256 _reward = user.rewardEarned;
        if (_reward > 0) {
            uint256 _epoch = epoch();
            require(user.epochTimerStart.add(rewardLockupEpochs) <= _epoch, "Boardroom: still in reward lockup");
            user.epochTimerStart = _epoch; // reset timer
            user.rewardEarned = 0;
            userInfo[msg.sender] = user;
            // Safe reward transfer, just in case if rounding error causes pool to not have enough reward amount
            uint256 _rewardBalance = IERC20(rewardToken).balanceOf(rewardFund);
            uint256 _paidAmount = _rewardBalance > _reward ? _reward : _rewardBalance;
            IStakePoolRewardFund(rewardFund).safeTransfer(rewardToken, msg.sender, _paidAmount);
            emit PayRewardPool(0, rewardToken, msg.sender, _reward, _reward, _paidAmount);
        }
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw() external lock allowEmergencyWithdraw override {
        UserInfo memory user = userInfo[msg.sender];
        uint amount = user.amount;
        balance = balance.sub(amount);
        user.amount = 0;
        userInfo[msg.sender] = user;
        IValueLiquidPair(pair).transfer(msg.sender, amount);
    }

    function removeLiquidity(
        address provider,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public override lock returns (uint amountA, uint amountB) {
        require(IStakePoolController(controller).isWhitelistStakingFor(provider),"StakePoolEpochReward: Invalid provider");
        removeStakeInternal(liquidity);
        IValueLiquidPair(pair).approve(provider, liquidity);
        emit Withdraw(msg.sender, liquidity);
        (amountA, amountB) = IValueLiquidProvider(provider).removeLiquidity(address(pair), tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }

    function removeLiquidityETH(
        address provider,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external override lock returns (uint amountToken, uint amountETH) {
        require(IStakePoolController(controller).isWhitelistStakingFor(provider),"StakePoolEpochReward: Invalid provider");
        removeStakeInternal(liquidity);
        IValueLiquidPair(pair).approve(provider, liquidity);
        emit Withdraw(msg.sender, liquidity);
        (amountToken, amountETH) = IValueLiquidProvider(provider).removeLiquidityETH(address(pair), token, liquidity, amountTokenMin, amountETHMin, to, deadline);
    }

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address provider,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external override lock returns (uint amountETH) {
        require(IStakePoolController(controller).isWhitelistStakingFor(provider),"StakePoolEpochReward: Invalid provider");
        removeStakeInternal(liquidity);
        IValueLiquidPair(pair).approve(provider, liquidity);
        emit Withdraw(msg.sender, liquidity);
        amountETH = IValueLiquidProvider(provider).removeLiquidityETHSupportingFeeOnTransferTokens(address(pair), token, liquidity, amountTokenMin, amountETHMin, to, deadline);
    }
}
