// SPDX-License-Identifier: MIT
pragma abicoder v2;
pragma solidity 0.7.6;

interface IStakePoolController {
    event MasterCreated(address indexed farm, address indexed pair, uint version, address timelock, address stakePoolRewardFund, uint totalStakePool);
    event SetWhitelistStakingFor(address indexed contractAddress, bool value);
    event SetWhitelistStakePool(address indexed contractAddress, int8 value);
    event SetStakePoolCreator(address indexed contractAddress, uint verion);
    event SetWhitelistRewardRebaser(address indexed contractAddress, bool value);
    event SetWhitelistRewardMultiplier(address indexed contractAddress, bool value);
    event SetStakePoolVerifier(address indexed contractAddress, bool value);
    event ChangeGovernance(address indexed governance);
    event SetFeeCollector(address indexed feeCollector);
    event SetFeeToken(address indexed token);
    event SetFeeAmount(uint indexed amount);

    struct PoolRewardInfo {
        address rewardToken;
        address rewardRebaser;
        address rewardMultiplier;
        uint256 startBlock;
        uint256 endRewardBlock;
        uint256 rewardPerBlock;
        uint256 lockRewardPercent;
        uint256 startVestingBlock;
        uint256 endVestingBlock;
        uint unstakingFrozenTime;
        uint rewardFundAmount;
    }

    function allStakePools(uint) external view returns (address stakePool);

    function isStakePool(address contractAddress) external view returns (bool);
    function isStakePoolVerifier(address contractAddress) external view returns (bool);

    function isWhitelistStakingFor(address contractAddress) external view returns (bool);
    function isWhitelistStakePool(address contractAddress) external view returns (int8);
    function setStakePoolVerifier(address contractAddress, bool state) external;
    function setWhitelistStakingFor(address contractAddress, bool state) external;

    function setWhitelistStakePool(address contractAddress, int8 state) external;
    function addStakePoolCreator(address contractAddress) external;

    function isWhitelistRewardRebaser(address contractAddress) external view returns (bool);

    function setWhitelistRewardRebaser(address contractAddress, bool state) external;

    function isWhitelistRewardMultiplier(address contractAddress) external view returns (bool);

    function setWhitelistRewardMultiplier(address contractAddress, bool state) external;
    function setEnableWhitelistRewardRebaser(bool value) external;
    function setEnableWhitelistRewardMultiplier(bool value) external;
    function allStakePoolsLength() external view returns (uint);

    function create(uint version, address pair, uint delayTimeLock, PoolRewardInfo calldata poolRewardInfo, uint8 flag) external returns (address);

    function createPair(uint version, address tokenA, address tokenB, uint32 tokenWeightA, uint32 swapFee, uint delayTimeLock, PoolRewardInfo calldata poolRewardInfo, uint8 flag) external returns (address);

    function setGovernance(address) external;

    function setFeeCollector(address _address) external;
    function setFeeToken(address _token) external;
    function setFeeAmount(uint _token) external;

}