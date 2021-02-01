pragma solidity 0.7.6;

import "../interfaces/IAggregatorInterface.sol";

// https://etherscan.io/address/0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419#readContract (EACAggregatorProxy)
// decimals = 8
contract EthPriceFeedMock is IAggregatorInterface {
    int256 public ethPrice;

    constructor(int256 _ethPrice) {
        ethPrice = _ethPrice;
    }

    function setEthPrice(int256 _ethPrice) external {
        ethPrice = _ethPrice;
    }

    function latestAnswer() external override view returns (int256) {
        return ethPrice;
    }
}
