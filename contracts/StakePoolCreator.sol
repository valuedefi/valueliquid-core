pragma abicoder v2;
pragma solidity >=0.7.6;

import './interfaces/IStakePoolCreator.sol';
import './interfaces/IValueLiquidRouter.sol';
import './interfaces/IValueLiquidFactory.sol';
import './libraries/TransferHelper.sol';
import './interfaces/IValueLiquidPair.sol';
import './TimeLock.sol';
import './StakePool.sol';

contract StakePoolCreator is IStakePoolCreator {
    uint public override version = 3001;
    function create() external override returns (address) {
        StakePool pool = new StakePool(msg.sender, version);
        return address(pool);
    }
}

