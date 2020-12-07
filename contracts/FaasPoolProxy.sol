// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IBPool.sol";
import "./interfaces/IFreeFromUpTo.sol";
import "./interfaces/IBFactory.sol";
import "./interfaces/IValueLiquidRegistry.sol";
import "./interfaces/IWETH.sol";
import "./FaaSRewardFund.sol";

contract FaasPoolProxy {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    IFreeFromUpTo public constant chi = IFreeFromUpTo(0x0000000000004946c0e9F43F4Dee607b0eF1fA1c);

    modifier discountCHI(uint8 flag) {
        if ((flag & 0x1) == 0) {
            _;
        } else {
            uint256 gasStart = gasleft();
            _;
            uint256 gasSpent = 21000 + gasStart - gasleft() + 16 * msg.data.length;
            chi.freeFromUpTo(msg.sender, (gasSpent + 14154) / 41130);
        }
    }

    IWETH weth;
    address private constant ETH_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    address public governance;
    address public exchangeProxy;

    constructor(address _weth,address _exchangeProxy) public {
        weth = IWETH(_weth);
        governance = tx.origin;
        exchangeProxy = _exchangeProxy;
    }
    struct PoolRewardInfo {
        IERC20 rewardToken;
        uint256 startBlock;
        uint256 endRewardBlock;
        uint256 rewardPerBlock;
        uint256 lockRewardPercent;
        uint256 startVestingBlock;
        uint256 endVestingBlock;
        uint unstakingFrozenTime;
        uint rewardFundAmount;
    }

    struct PoolInfo {
        IBFactory factory;
        address[] tokens;
        uint[] balances;
        uint[] denorms;
        uint swapFee;
        uint initPoolSupply;
    }

    receive() external payable {}

    function setExchangeProxy(address _exchangeProxy) external {
        require(msg.sender == governance, "!governance");
        exchangeProxy = _exchangeProxy;
    }
    function createInternal(
        PoolInfo calldata poolInfo

    ) internal returns (IBPool pool) {
        address[] memory tokens = poolInfo.tokens;
        require(tokens.length == poolInfo.balances.length, "ERR_LENGTH_MISMATCH");
        require(tokens.length == poolInfo.denorms.length, "ERR_LENGTH_MISMATCH");
        pool = poolInfo.factory.newBPool();
        bool containsETH = false;
        for (uint i = 0; i < tokens.length; i++) {
            if (transferFromAllTo(tokens[i], poolInfo.balances[i], address(pool))) {
                containsETH = true;
                tokens[i] = address(weth);
            }
        }
        require(msg.value == 0 || containsETH, "!invalid payable");
        pool.finalize(poolInfo.swapFee, poolInfo.initPoolSupply, tokens, poolInfo.denorms);

    }

    function createFaaSReward(
        PoolInfo calldata poolInfo,
        PoolRewardInfo calldata poolRewardInfo,
        uint8 flag
    ) payable external discountCHI(flag) returns (IBPool pool) {
        pool = createInternal(poolInfo);
        {
            FaaSRewardFund faasRewardFund = new FaaSRewardFund();
            pool.finalizeRewardFundInfo(address(faasRewardFund), poolRewardInfo.unstakingFrozenTime);
            pool.addRewardPool(
                poolRewardInfo.rewardToken,
                poolRewardInfo.startBlock,
                poolRewardInfo.endRewardBlock,
                poolRewardInfo.rewardPerBlock,
                poolRewardInfo.lockRewardPercent,
                poolRewardInfo.startVestingBlock,
                poolRewardInfo.endVestingBlock);
            transferFromAllTo(address(poolRewardInfo.rewardToken), poolRewardInfo.rewardFundAmount, address(faasRewardFund));
            faasRewardFund.initialized(msg.sender, poolRewardInfo.unstakingFrozenTime + 1 days, address(pool));
            pool.setExchangeProxy(exchangeProxy);
            pool.setController(address(faasRewardFund));
        }
        uint lpAmount = pool.balanceOf(address(this));
        if (lpAmount > 0) {
            IERC20(pool).safeTransfer(msg.sender, lpAmount);
        }
    }

    function isETH(IERC20 token) internal pure returns (bool) {
        return (address(token) == ETH_ADDRESS);
    }

    function transferFromAllTo(address token, uint amount, address to) internal returns (bool containsETH) {
        if (isETH(IERC20(token))) {
            require(amount == msg.value, "!invalid amount");
            weth.deposit{value : amount}();
            weth.transfer(to, amount);
            containsETH = true;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, to, amount);
        }
        return containsETH;
    }

    function transferFromAllAndApprove(address token, uint amount, address spender) internal returns (bool containsETH) {
        if (isETH(IERC20(token))) {
            require(amount == msg.value, "!invalid amount");
            weth.deposit{value : amount}();
            if (weth.allowance(address(this), spender) > 0) {
                IERC20(address(weth)).safeApprove(address(spender), 0);
            }
            IERC20(address(weth)).safeApprove(spender, amount);
            containsETH = true;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            if (IERC20(token).allowance(address(this), spender) > 0) {
                IERC20(token).safeApprove(spender, 0);
            }
            IERC20(token).safeApprove(spender, amount);
        }
        return containsETH;
    }
}