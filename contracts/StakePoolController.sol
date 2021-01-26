pragma abicoder v2;
pragma solidity >=0.7.6;

import './interfaces/IStakePoolCreator.sol';
import './interfaces/IStakePoolController.sol';
import './interfaces/IValueLiquidRouter.sol';
import './interfaces/IValueLiquidFactory.sol';
import './interfaces/IStakePool.sol';
import './libraries/TransferHelper.sol';
import './interfaces/IValueLiquidPair.sol';
import './TimeLock.sol';
import "./interfaces/IERC20.sol";
import './StakePoolRewardFund.sol';
import "./interfaces/IFreeFromUpTo.sol";

contract StakePoolController is IStakePoolController {
    IValueLiquidFactory public swapFactory;
    address public governance;

    address public feeCollector;
    address public feeToken;
    uint public  feeAmount;

    mapping(address => bool) private _stakePools;
    mapping(address => bool) private _whitelistStakingFor;
    mapping(address => bool) private _whitelistRewardRebaser;
    mapping(address => bool) private _whitelistRewardMultiplier;
    mapping(address => int8) private _whitelistStakePools;
    mapping(address => bool) public _stakePoolVerifiers;
    mapping(uint => address) public stakePoolCreators;
    address[] public override allStakePools;
    bool public enableWhitelistRewardRebaser = true;
    bool public enableWhitelistRewardMultiplier = true;
    bool private _initialized = false;

    IFreeFromUpTo public constant chi = IFreeFromUpTo(0x0000000000004946c0e9F43F4Dee607b0eF1fA1c);

    modifier discountCHI(uint8 flag) {
        uint256 gasStart = gasleft();
        _;
        if ((flag & 0x1) == 1) {
            uint256 gasSpent = 21000 + gasStart - gasleft() + 16 * msg.data.length;
            chi.freeFromUpTo(msg.sender, (gasSpent + 14154) / 41130);
        }
    }

    function initialize(address _swapFactory) public {
        require(_initialized == false, "StakePoolController: initialized");
        governance = msg.sender;
        swapFactory = IValueLiquidFactory(_swapFactory);
        _initialized = true;
    }

    function isStakePool(address b) external override view returns (bool){
        return _stakePools[b];
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "StakePoolController: !governance");
        _;
    }

    function setFeeCollector(address _address) external onlyGovernance override {
        require(_address != address(0), "StakePoolController: invalid address");
        feeCollector = _address;
        emit SetFeeCollector(_address);
    }
    function setEnableWhitelistRewardRebaser(bool value) external onlyGovernance override {
        enableWhitelistRewardRebaser = value;
    }
    function setEnableWhitelistRewardMultiplier(bool value) external onlyGovernance override {
        enableWhitelistRewardMultiplier = value;
    }
    function setFeeToken(address _token) external onlyGovernance override {
        require(_token != address(0), "StakePoolController: invalid _token");
        feeToken = _token;
        emit SetFeeToken(_token);
    }
    function setFeeAmount(uint _feeAmount) external onlyGovernance override {
        feeAmount = _feeAmount;
        emit SetFeeAmount(_feeAmount);
    }
    function isWhitelistStakingFor(address _address) external override view returns (bool){
        return _whitelistStakingFor[_address];
    }

    function isWhitelistStakePool(address _address) external override view returns (int8){
        return _whitelistStakePools[_address];
    }
    function isStakePoolVerifier(address _address) external override view returns (bool){
        return _stakePoolVerifiers[_address];
    }
    function setWhitelistStakingFor(address _address, bool state) external onlyGovernance override {
        require(_address != address(0), "StakePoolController: invalid address");
        _whitelistStakingFor[_address] = state;
        emit SetWhitelistStakingFor(_address, state);
    }

    function setStakePoolVerifier(address _address, bool state) external onlyGovernance override {
        require(_address != address(0), "StakePoolController: invalid address");
        _stakePoolVerifiers[_address] = state;
        emit SetStakePoolVerifier(_address, state);
    }

    function setWhitelistStakePool(address _address, int8 state) external override {
        require(_address != address(0), "StakePoolController: invalid address");
        require(_stakePoolVerifiers[msg.sender] == true, "StakePoolController: invalid stake pool verifier");
        _whitelistStakePools[_address] = state;
        emit SetWhitelistStakePool(_address, state);
    }

    function addStakePoolCreator(address _address) external onlyGovernance override {
        require(_address != address(0), "StakePoolController: invalid address");
        uint version = IStakePoolCreator(_address).version();
        require(version >= 1000, "Invalid stake pool creator version");
        stakePoolCreators[version] = _address;
        emit SetStakePoolCreator(_address, version);
    }

    function isWhitelistRewardRebaser(address _address) external override view returns (bool){
        if (!enableWhitelistRewardRebaser) return true;
        return _address == address(0) ? true : _whitelistRewardRebaser[_address];
    }

    function setWhitelistRewardRebaser(address _address, bool state) external onlyGovernance override {
        require(_address != address(0), "StakePoolController: invalid address");
        _whitelistRewardRebaser[_address] = state;
        emit SetWhitelistRewardRebaser(_address, state);
    }

    function isWhitelistRewardMultiplier(address _address) external override view returns (bool){
        if (!enableWhitelistRewardMultiplier) return true;
        return _address == address(0) ? true : _whitelistRewardMultiplier[_address];
    }

    function setWhitelistRewardMultiplier(address _address, bool state) external onlyGovernance override {
        require(_address != address(0), "StakePoolController: invalid address");
        _whitelistRewardMultiplier[_address] = state;
        emit SetWhitelistRewardMultiplier(_address, state);
    }

    function setGovernance(address _governance) external onlyGovernance override {
        require(_governance != address(0), "StakePoolController: invalid governance");
        governance = _governance;
        emit ChangeGovernance(_governance);
    }

    function allStakePoolsLength() external override view returns (uint) {
        return allStakePools.length;
    }
    function createPair(uint version, address tokenA, address tokenB, uint32 tokenWeightA, uint32 swapFee, uint delayTimeLock, PoolRewardInfo calldata poolRewardInfo, uint8 flag) public discountCHI(flag)  override returns (address) {
        address pair = swapFactory.getPair(tokenA, tokenB, tokenWeightA, swapFee);
        if (pair == address(0)){
            pair = swapFactory.createPair(tokenA, tokenB, tokenWeightA, swapFee);
        }
        return create(version, pair, delayTimeLock, poolRewardInfo, 0);
    }
    function _addRewardPool(IStakePool pool, PoolRewardInfo calldata poolRewardInfo) internal {
            pool.addRewardPool(
            poolRewardInfo.rewardToken,
            poolRewardInfo.rewardRebaser,
            poolRewardInfo.rewardMultiplier,
            poolRewardInfo.startBlock,
            poolRewardInfo.endRewardBlock,
            poolRewardInfo.rewardPerBlock,
            poolRewardInfo.lockRewardPercent,
            poolRewardInfo.startVestingBlock,
            poolRewardInfo.endVestingBlock);
    }
    function create(uint version, address pair, uint delayTimeLock, PoolRewardInfo calldata poolRewardInfo, uint8 flag) public  discountCHI(flag) override returns (address) {
        require(swapFactory.isPair(pair), "StakePoolController: invalid pair");
        address stakePoolCreator = stakePoolCreators[version];
        require(stakePoolCreator != address(0), "StakePoolController: Invalid stake pool creator version");
        IStakePool pool = IStakePool(IStakePoolCreator(stakePoolCreator).create());

        if (feeCollector != address(0) && feeToken != address(0) && feeAmount > 0) {
            TransferHelper.safeTransferFrom(feeToken, msg.sender, feeCollector, feeAmount);
        }

        allStakePools.push(address(pool));
        _stakePools[address(pool)] = true;
        TimeLock timelock = new TimeLock();
        StakePoolRewardFund stakePoolRewardFund = new StakePoolRewardFund();
        emit MasterCreated(address(pool), pair, IStakePoolCreator(stakePoolCreator).version(), address(timelock), address(stakePoolRewardFund), allStakePools.length);
        timelock.initialize(msg.sender, delayTimeLock);
        stakePoolRewardFund.initialize(address(pool), address(timelock));
        require(IERC20(poolRewardInfo.rewardToken).balanceOf(msg.sender) >= poolRewardInfo.rewardFundAmount , "StakePoolController: Not enough rewardFundAmount");
        TransferHelper.safeTransferFrom(poolRewardInfo.rewardToken, msg.sender, address(stakePoolRewardFund), poolRewardInfo.rewardFundAmount);
        _addRewardPool(pool, poolRewardInfo);
        pool.initialize(pair, poolRewardInfo.unstakingFrozenTime, address(stakePoolRewardFund), address(timelock));
        return address(pool);
    }
}
