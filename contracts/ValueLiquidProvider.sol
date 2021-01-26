pragma solidity >=0.7.6;
pragma abicoder v2;

import './interfaces/IValueLiquidFactory.sol';
import './interfaces/IValueLiquidFormula.sol';
import './interfaces/IValueLiquidPair.sol';
import './interfaces/IStakePool.sol';
import './libraries/TransferHelper.sol';
import "./interfaces/IERC20.sol";
import './interfaces/IValueLiquidProvider.sol';
import './libraries/SafeMath.sol';
import './interfaces/IWETH.sol';
import './interfaces/IStakePoolController.sol';

contract ValueLiquidProvider is IValueLiquidProvider {
    using SafeMath for uint;
    address public immutable override factory;
    address public immutable override controller;
    address public immutable override formula;
    address public immutable override WETH;
    address private constant ETH_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, 'Router: EXPIRED');
        _;
    }

    constructor(address _factory,address _controller, address _WETH) public {
        factory = _factory;
        controller = _controller;
        formula = IValueLiquidFactory(_factory).formula();
        WETH = _WETH;
    }

    receive() external payable {
        assert(msg.sender == WETH);
        // only accept ETH via fallback from the WETH contract
    }


    function stake(
        address stakePool,
        uint amount,
        uint deadline
    ) external virtual override ensure(deadline) {
        require(IStakePoolController(controller).isStakePool(stakePool), "Router: Invalid stakePool");
        address pair = IStakePool(stakePool).pair();
        IValueLiquidPair(pair).transferFrom(msg.sender, stakePool, amount);
        IStakePool(stakePool).stakeFor(msg.sender);
    }
    function stakeWithPermit(
        address stakePool,
        uint amount,
        uint deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override ensure(deadline) {
        require(IStakePoolController(controller).isStakePool(stakePool), "Router: Invalid stakePool");
        address pair = IStakePool(stakePool).pair();
        IValueLiquidPair(pair).permit(msg.sender, address(this), approveMax ? uint(- 1) : amount, deadline, v, r, s);
        IValueLiquidPair(pair).transferFrom(msg.sender, stakePool, amount);
        IStakePool(stakePool).stakeFor(msg.sender);
    }


    // **** REMOVE LIQUIDITY ****
    function _removeLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to
    ) internal  returns (uint amountA, uint amountB) {
        require(IValueLiquidFactory(factory).isPair(pair), "Router: Invalid pair");
        IValueLiquidPair(pair).transferFrom(msg.sender, pair, liquidity);
        // send liquidity to pair
        (uint amount0, uint amount1) = IValueLiquidPair(pair).burn(to);
        (address token0,) = IValueLiquidFormula(formula).sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'Router: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'Router: INSUFFICIENT_B_AMOUNT');
    }
    function removeLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountA, uint amountB) {
        (amountA, amountB) = _removeLiquidity(pair, tokenA, tokenB, liquidity, amountAMin, amountBMin, to);
    }

    function removeLiquidityETH(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountToken, uint amountETH) {
        (amountToken, amountETH) = _removeLiquidity(
            pair,
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this)
        );
        TransferHelper.safeTransfer(token, to, amountToken);
        transferAll(ETH_ADDRESS, to, amountETH);
    }

    function removeLiquidityWithPermit(
        address pair,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override ensure(deadline) returns (uint amountA, uint amountB) {
        {
            uint value = approveMax ? uint(- 1) : liquidity;
            IValueLiquidPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        }
        (amountA, amountB) = _removeLiquidity(pair, tokenA, tokenB, liquidity, amountAMin, amountBMin, to);
    }

    function removeLiquidityETHWithPermit(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountToken, uint amountETH) {
        uint value = approveMax ? uint(- 1) : liquidity;
        IValueLiquidPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountToken, amountETH) = removeLiquidityETH(pair, token, liquidity, amountTokenMin, amountETHMin, to, deadline);
    }

    // **** REMOVE LIQUIDITY (supporting fee-on-transfer tokens) ****
    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountETH) {
        (, amountETH) = removeLiquidity(
            pair,
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, IERC20(token).balanceOf(address(this)));
        transferAll(ETH_ADDRESS, to, amountETH);
    }

    function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountETH) {
        uint value = approveMax ? uint(- 1) : liquidity;
        IValueLiquidPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        amountETH = removeLiquidityETHSupportingFeeOnTransferTokens(
            pair, token, liquidity, amountTokenMin, amountETHMin, to, deadline
        );
    }

    function transferAll(address token, address to, uint amount) internal returns (bool) {
        if (amount == 0) {
            return true;
        }

        if (isETH(token)) {
            IWETH(WETH).withdraw(amount);
            TransferHelper.safeTransferETH(to, amount);
        } else {
            TransferHelper.safeTransfer(token, to, amount);
        }
        return true;
    }

    function isETH(address token) internal pure returns (bool) {
        return (token == ETH_ADDRESS);
    }
}
