// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is disstributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

// Builds new BPools, logging their addresses and providing `isBPool(address) -> (bool)`

import "./BPool.sol";

interface IBPoolCreator {
    function newBPool() external returns (BPool);
}

contract BFactory {
    event LOG_NEW_POOL(
        address indexed caller,
        address indexed pool
    );

    mapping(address=>bool) private _isBPool;
    function isBPool(address b)
        external view returns (bool)
    {
        return _isBPool[b];
    }

    function newBPool()
        external
        returns (BPool)
    {
        BPool bpool = bpoolCreator.newBPool();
        _isBPool[address(bpool)] = true;
        emit LOG_NEW_POOL(msg.sender, address(bpool));
        bpool.setController(msg.sender);
        bpool.setExitFee(defaultExitFee);
        return bpool;
    }

    IBPoolCreator public bpoolCreator;
    address public governance;
    address public collectedToken = 0x49E833337ECe7aFE375e44F4E3e8481029218E5c; // Value Liquidity Token (VALUE)
    address public collectedFund = 0xb7b2Ea8A1198368f950834875047aA7294A2bDAa; // set to insurance fund at start
    uint public defaultExitFee = BConst.DEFAULT_EXIT_FEE;

    constructor() public {
        governance = msg.sender;
    }

    function setBpoolCreator(IBPoolCreator _bpoolCreator) external {
        require(msg.sender == governance, "!governance");
        bpoolCreator = _bpoolCreator;
    }

    function setGovernance(address _governance) external {
        require(msg.sender == governance, "!governance");
        governance = _governance;
    }

    function collect(IERC20 token) external {
        uint collected = token.balanceOf(address(this));
        bool xfer = token.transfer(collectedFund, collected);
        require(xfer, "errErc20");
    }

    function setCollectedFund(address _collectedFund) external {
        require(msg.sender == governance, '!governance');
        collectedFund = _collectedFund;
    }

    function setPoolCollectedFee(BPool pool, uint _collectedFee) external {
        require(msg.sender == governance, '!governance');
        pool.setCollectedFee(_collectedFee);
    }

    function setCollectedToken(address _collectedToken) external {
        require(msg.sender == governance, '!governance');
        collectedToken = _collectedToken;
    }

    function setDefaultExitFee(uint _defaultExitFee) external {
        require(msg.sender == governance, '!governance');
        defaultExitFee = _defaultExitFee;
    }

    /**
     * This function allows governance to take unsupported tokens out of the contract.
     * This is in an effort to make someone whole, should they seriously mess up.
     * There is no guarantee governance will vote to return these.
     * It also allows for removal of airdropped tokens.
     */
    function governanceRecoverUnsupported(IERC20 _token, uint256 amount, address to) external {
        require(msg.sender == governance, "!governance");
        _token.transfer(to, amount);
    }
}
