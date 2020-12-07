// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IFreeFromUpTo.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/IBPool.sol";
import "./interfaces/IBFactory.sol";
import "./interfaces/IValueLiquidRegistry.sol";

contract ValueLiquidRouter {
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

    struct Pool {
        address pool;
        uint tokenBalanceIn;
        uint tokenWeightIn;
        uint tokenBalanceOut;
        uint tokenWeightOut;
        uint swapFee;
        uint effectiveLiquidity;
    }

    struct Swap {
        address pool;
        address tokenIn;
        address tokenOut;
        uint swapAmount; // tokenInAmount / tokenOutAmount
        uint limitReturnAmount; // minAmountOut / maxAmountIn
        uint maxPrice;
    }

    IWETH weth;
    IValueLiquidRegistry registry;
    address private constant ETH_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    uint private constant BONE = 10 ** 18;

    address public governance;

    constructor(IWETH _weth) public {
        weth = _weth;
        governance = tx.origin;
    }

    function setGovernance(address _governance) external {
        require(msg.sender == governance, "!governance");
        governance = _governance;
    }

    function setRegistry(IValueLiquidRegistry _registry) external {
        require(msg.sender == governance, "!governance");
        registry = _registry;
    }

//    function create(
//        IBFactory factory,
//        address[] calldata tokens,
//        uint[] calldata balances,
//        uint[] calldata denorms,
//        uint swapFee,
//        bool finalize
//    ) payable external returns (IBPool pool) {
//        require(tokens.length == balances.length, "ERR_LENGTH_MISMATCH");
//        require(tokens.length == denorms.length, "ERR_LENGTH_MISMATCH");
//        pool = factory.newBPool();
//        pool.setSwapFee(swapFee);
//        for (uint i = 0; i < tokens.length; i++) {
//            if (transferFromAllAndApprove(tokens[i], balances[i], address(pool))) {
//                pool.bind(address(weth), balances[i], denorms[i]);
//            } else {
//                pool.bind(tokens[i], balances[i], denorms[i]);
//            }
//        }
//        if (finalize) {
//            pool.finalize();
//            IERC20(pool).safeTransfer(msg.sender, pool.balanceOf(address(this)));
//        } else {
//            pool.setPublicSwap(true);
//        }
//    }

    function joinPool(
        address pool,
        uint poolAmountOut,
        uint[] calldata maxAmountsIn
    ) payable external {
        address[] memory tokens = IBPool(pool).getFinalTokens();
        require(maxAmountsIn.length == tokens.length, "ERR_LENGTH_MISMATCH");
        bool containsETH = false;
        for (uint i = 0; i < tokens.length; i++) {
            if (transferFromAllAndApprove(tokens[i], maxAmountsIn[i], pool)) {
                containsETH = true;
            }
        }
        require(msg.value == 0 || containsETH, "!invalid payable");
        IBPool(pool).joinPool(poolAmountOut, maxAmountsIn);
        for (uint i = 0; i < tokens.length; i++) {
            transferAll(tokens[i], getBalance(tokens[i]));
        }
        transferAll(pool, poolAmountOut);
    }


    function exitPool(address pool, uint poolAmountIn, uint[] calldata minAmountsOut) external {
        IERC20(pool).safeTransferFrom(msg.sender, address(this), poolAmountIn);
        IERC20(pool).safeApprove(pool, poolAmountIn);
        IBPool(pool).exitPool(poolAmountIn, minAmountsOut);
        address[] memory tokens = IBPool(pool).getFinalTokens();
        for (uint i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            if (token == address(weth)) {
                transferAll(ETH_ADDRESS, getBalance(tokens[i]));
            } else {
                transferAll(tokens[i], getBalance(tokens[i]));
            }
        }
    }
    //    function exitswapPoolAmountIn(address pool, address tokenOut, uint poolAmountIn, uint minAmountOut) external returns (uint tokenAmountOut) {
    //        IERC20(pool).safeTransferFrom(msg.sender, address(this), poolAmountIn);
    //        IERC20(pool).safeApprove(pool, poolAmountIn);
    //        tokenAmountOut = IBPool(pool).exitswapPoolAmountIn(tokenOut, poolAmountIn, minAmountOut);
    //        IERC20 token = IERC20(tokenOut);
    //        token.safeTransfer(msg.sender, token.balanceOf(address(this)));
    //        return tokenAmountOut;
    //    }

    //    function joinswapExternAmountIn(
    //        address pool,
    //        address tokenIn,
    //        uint tokenAmountIn,
    //        uint minPoolAmountOut
    //    ) external returns (uint poolAmountOut) {
    //        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), tokenAmountIn);
    //        IERC20(tokenIn).safeApprove(pool, tokenAmountIn);
    //        poolAmountOut = IBPool(pool).joinswapExternAmountIn(tokenIn, tokenAmountIn, minPoolAmountOut);
    //        IERC20(pool).safeTransfer(msg.sender, poolAmountOut);
    //        if (IERC20(tokenIn).balanceOf(address(this)) > 0) {
    //            IERC20(tokenIn).safeTransfer(msg.sender, IERC20(tokenIn).balanceOf(address(this)));
    //        }
    //        return poolAmountOut;
    //    }


    //    function joinswapPoolAmountOut(
    //        address pool,
    //        address tokenIn, uint poolAmountOut, uint maxAmountIn
    //    ) external returns (uint tokenAmountIn) {
    //        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);
    //        IERC20(tokenIn).safeApprove(pool, maxAmountIn);
    //        tokenAmountIn = IBPool(pool).joinswapPoolAmountOut(tokenIn, poolAmountOut, maxAmountIn);
    //        IERC20(pool).safeTransfer(msg.sender, poolAmountOut);
    //        if (IERC20(tokenIn).balanceOf(address(this)) > 0) {
    //            IERC20(tokenIn).safeTransfer(msg.sender, IERC20(tokenIn).balanceOf(address(this)));
    //        }
    //        return tokenAmountIn;
    //    }
    //
    //    function exitswapExternAmountOut(address pool, address tokenOut, uint tokenAmountOut,
    //        uint maxPoolAmountIn) external returns (uint poolAmountIn) {
    //        IERC20(pool).safeTransferFrom(msg.sender, address(this), maxPoolAmountIn);
    //        IERC20(pool).safeApprove(pool, maxPoolAmountIn);
    //        poolAmountIn = IBPool(pool).exitswapExternAmountOut(tokenOut, tokenAmountOut, maxPoolAmountIn);
    //        IERC20(tokenOut).safeTransfer(msg.sender, tokenAmountOut);
    //        if (IERC20(pool).balanceOf(address(this)) > 0) {
    //            IERC20(pool).safeTransfer(msg.sender, IERC20(pool).balanceOf(address(this)));
    //        }
    //    }


    function batchSwapExactIn(
        Swap[] memory swaps,
        address tokenIn,
        address tokenOut,
        uint totalAmountIn,
        uint minTotalAmountOut,
        uint8 flag
    )
    public payable discountCHI(flag) returns (uint totalAmountOut) {
        transferFromAll(tokenIn, totalAmountIn);

        for (uint i = 0; i < swaps.length; i++) {
            Swap memory swap = swaps[i];
            IBPool pool = IBPool(swap.pool);
            IERC20(swap.tokenIn).safeApprove(swap.pool, swap.swapAmount);

            (uint tokenAmountOut,) = pool.swapExactAmountIn(
                swap.tokenIn,
                swap.swapAmount,
                swap.tokenOut,
                swap.limitReturnAmount,
                swap.maxPrice
            );
            totalAmountOut = tokenAmountOut.add(totalAmountOut);
        }

        require(totalAmountOut >= minTotalAmountOut, "ERR_LIMIT_OUT");

        transferAll(tokenOut, totalAmountOut);
        transferAll(tokenIn, getBalance(tokenIn));
        return totalAmountOut;
    }

    function batchSwapExactOut(
        Swap[] memory swaps,
        address tokenIn,
        address tokenOut,
        uint maxTotalAmountIn,
        uint8 flag
    )
    public payable discountCHI(flag)
    returns (uint totalAmountIn)
    {
        transferFromAll(tokenIn, maxTotalAmountIn);
        for (uint i = 0; i < swaps.length; i++) {
            Swap memory swap = swaps[i];
            IERC20(swap.tokenIn).safeApprove(swap.pool, swap.limitReturnAmount);
            (uint tokenAmountIn,) = IBPool(swap.pool).swapExactAmountOut(
                swap.tokenIn,
                swap.limitReturnAmount,
                swap.tokenOut,
                swap.swapAmount,
                swap.maxPrice
            );
            totalAmountIn = tokenAmountIn.add(totalAmountIn);
        }
        require(totalAmountIn <= maxTotalAmountIn, "ERR_LIMIT_IN");

        transferAll(tokenOut, getBalance(tokenOut));
        transferAll(tokenIn, getBalance(tokenIn));
        return totalAmountIn;

    }

    function multihopBatchSwapExactIn(
        Swap[][] memory swapSequences,
        address tokenIn,
        address tokenOut,
        uint totalAmountIn,
        uint minTotalAmountOut,
        uint8 flag
    )
    public payable discountCHI(flag)
    returns (uint totalAmountOut)
    {

        transferFromAll(tokenIn, totalAmountIn);

        for (uint i = 0; i < swapSequences.length; i++) {
            uint tokenAmountOut;
            for (uint k = 0; k < swapSequences[i].length; k++) {
                Swap memory swap = swapSequences[i][k];
                IERC20 SwapTokenIn = IERC20(swap.tokenIn);
                if (k == 1) {
                    // Makes sure that on the second swap the output of the first was used
                    // so there is not intermediate token leftover
                    swap.swapAmount = tokenAmountOut;
                }

                IBPool pool = IBPool(swap.pool);
                SwapTokenIn.safeApprove(swap.pool, swap.swapAmount);
                (tokenAmountOut,) = pool.swapExactAmountIn(
                    swap.tokenIn,
                    swap.swapAmount,
                    swap.tokenOut,
                    swap.limitReturnAmount,
                    swap.maxPrice
                );
            }
            // This takes the amountOut of the last swap
            totalAmountOut = tokenAmountOut.add(totalAmountOut);
        }

        require(totalAmountOut >= minTotalAmountOut, "ERR_LIMIT_OUT");

        transferAll(tokenOut, totalAmountOut);
        transferAll(tokenIn, getBalance(tokenIn));

    }

    function multihopBatchSwapExactOut(
        Swap[][] memory swapSequences,
        address tokenIn,
        address tokenOut,
        uint maxTotalAmountIn,
        uint8 flag
    )
    public payable discountCHI(flag)
    returns (uint totalAmountIn)
    {

        transferFromAll(tokenIn, maxTotalAmountIn);

        for (uint i = 0; i < swapSequences.length; i++) {
            uint tokenAmountInFirstSwap;
            // Specific code for a simple swap and a multihop (2 swaps in sequence)
            if (swapSequences[i].length == 1) {
                Swap memory swap = swapSequences[i][0];
                IERC20 SwapTokenIn = IERC20(swap.tokenIn);

                IBPool pool = IBPool(swap.pool);
                SwapTokenIn.safeApprove(swap.pool, swap.limitReturnAmount);
                (tokenAmountInFirstSwap,) = pool.swapExactAmountOut(
                    swap.tokenIn,
                    swap.limitReturnAmount,
                    swap.tokenOut,
                    swap.swapAmount,
                    swap.maxPrice
                );
            } else {
                // Consider we are swapping A -> B and B -> C. The goal is to buy a given amount
                // of token C. But first we need to buy B with A so we can then buy C with B
                // To get the exact amount of C we then first need to calculate how much B we'll need:
                uint intermediateTokenAmount;
                // This would be token B as described above
                Swap memory secondSwap = swapSequences[i][1];
                IBPool poolSecondSwap = IBPool(secondSwap.pool);
                intermediateTokenAmount = poolSecondSwap.calcInGivenOut(
                    poolSecondSwap.getBalance(secondSwap.tokenIn),
                    poolSecondSwap.getDenormalizedWeight(secondSwap.tokenIn),
                    poolSecondSwap.getBalance(secondSwap.tokenOut),
                    poolSecondSwap.getDenormalizedWeight(secondSwap.tokenOut),
                    secondSwap.swapAmount,
                    poolSecondSwap.swapFee()
                );

                //// Buy intermediateTokenAmount of token B with A in the first pool
                Swap memory firstSwap = swapSequences[i][0];
                IERC20 FirstSwapTokenIn = IERC20(firstSwap.tokenIn);
                IBPool poolFirstSwap = IBPool(firstSwap.pool);
                if (FirstSwapTokenIn.allowance(address(this), firstSwap.pool) < uint(- 1)) {
                    FirstSwapTokenIn.safeApprove(firstSwap.pool, uint(- 1));
                }

                (tokenAmountInFirstSwap,) = poolFirstSwap.swapExactAmountOut(
                    firstSwap.tokenIn,
                    firstSwap.limitReturnAmount,
                    firstSwap.tokenOut,
                    intermediateTokenAmount, // This is the amount of token B we need
                    firstSwap.maxPrice
                );

                //// Buy the final amount of token C desired
                IERC20 SecondSwapTokenIn = IERC20(secondSwap.tokenIn);
                if (SecondSwapTokenIn.allowance(address(this), secondSwap.pool) < uint(- 1)) {
                    SecondSwapTokenIn.safeApprove(secondSwap.pool, uint(- 1));
                }

                poolSecondSwap.swapExactAmountOut(
                    secondSwap.tokenIn,
                    secondSwap.limitReturnAmount,
                    secondSwap.tokenOut,
                    secondSwap.swapAmount,
                    secondSwap.maxPrice
                );
            }
            totalAmountIn = tokenAmountInFirstSwap.add(totalAmountIn);
        }

        require(totalAmountIn <= maxTotalAmountIn, "ERR_LIMIT_IN");

        transferAll(tokenOut, getBalance(tokenOut));
        transferAll(tokenIn, getBalance(tokenIn));

    }

    function smartSwapExactIn(
        address tokenIn,
        address tokenOut,
        uint totalAmountIn,
        uint minTotalAmountOut,
        uint nPools,
        uint8 flag
    )
    public payable discountCHI(flag)
    returns (uint totalAmountOut)
    {
        Swap[] memory swaps;
        if (isETH(tokenIn)) {
            (swaps,) = viewSplitExactIn(address(weth), address(tokenOut), totalAmountIn, nPools);
        } else if (isETH(tokenOut)) {
            (swaps,) = viewSplitExactIn(address(tokenIn), address(weth), totalAmountIn, nPools);
        } else {
            (swaps,) = viewSplitExactIn(address(tokenIn), address(tokenOut), totalAmountIn, nPools);
        }

        totalAmountOut = batchSwapExactIn(swaps, tokenIn, tokenOut, totalAmountIn, minTotalAmountOut, 0x0);
    }

    function smartSwapExactOut(
        address tokenIn,
        address tokenOut,
        uint totalAmountOut,
        uint maxTotalAmountIn,
        uint nPools,
        uint8 flag
    )
    public payable discountCHI(flag)
    returns (uint totalAmountIn)
    {
        Swap[] memory swaps;
        if (isETH(tokenIn)) {
            (swaps,) = viewSplitExactOut(address(weth), address(tokenOut), totalAmountOut, nPools);
        } else if (isETH(tokenOut)) {
            (swaps,) = viewSplitExactOut(address(tokenIn), address(weth), totalAmountOut, nPools);
        } else {
            (swaps,) = viewSplitExactOut(address(tokenIn), address(tokenOut), totalAmountOut, nPools);
        }

        totalAmountIn = batchSwapExactOut(swaps, tokenIn, tokenOut, maxTotalAmountIn, 0x0);
    }

    function viewSplitExactIn(
        address tokenIn,
        address tokenOut,
        uint swapAmount,
        uint nPools
    )
    public view
    returns (Swap[] memory swaps, uint totalOutput)
    {
        address[] memory poolAddresses = registry.getBestPoolsWithLimit(tokenIn, tokenOut, nPools);

        Pool[] memory pools = new Pool[](poolAddresses.length);
        uint sumEffectiveLiquidity;
        for (uint i = 0; i < poolAddresses.length; i++) {
            pools[i] = getPoolData(tokenIn, tokenOut, poolAddresses[i]);
            sumEffectiveLiquidity = sumEffectiveLiquidity.add(pools[i].effectiveLiquidity);
        }

        uint[] memory bestInputAmounts = new uint[](pools.length);
        uint totalInputAmount;
        for (uint i = 0; i < pools.length; i++) {
            bestInputAmounts[i] = swapAmount.mul(pools[i].effectiveLiquidity).div(sumEffectiveLiquidity);
            totalInputAmount = totalInputAmount.add(bestInputAmounts[i]);
        }

        if (totalInputAmount < swapAmount) {
            bestInputAmounts[0] = bestInputAmounts[0].add(swapAmount.sub(totalInputAmount));
        } else {
            bestInputAmounts[0] = bestInputAmounts[0].sub(totalInputAmount.sub(swapAmount));
        }

        swaps = new Swap[](pools.length);

        for (uint i = 0; i < pools.length; i++) {
            swaps[i] = Swap({
            pool : pools[i].pool,
            tokenIn : tokenIn,
            tokenOut : tokenOut,
            swapAmount : bestInputAmounts[i],
            limitReturnAmount : 0,
            maxPrice : uint(- 1)
            });
        }

        totalOutput = calcTotalOutExactIn(bestInputAmounts, pools);

        return (swaps, totalOutput);
    }

    function viewSplitExactOut(
        address tokenIn,
        address tokenOut,
        uint swapAmount,
        uint nPools
    )
    public view
    returns (Swap[] memory swaps, uint totalOutput)
    {
        address[] memory poolAddresses = registry.getBestPoolsWithLimit(tokenIn, tokenOut, nPools);

        Pool[] memory pools = new Pool[](poolAddresses.length);
        uint sumEffectiveLiquidity;
        for (uint i = 0; i < poolAddresses.length; i++) {
            pools[i] = getPoolData(tokenIn, tokenOut, poolAddresses[i]);
            sumEffectiveLiquidity = sumEffectiveLiquidity.add(pools[i].effectiveLiquidity);
        }

        uint[] memory bestInputAmounts = new uint[](pools.length);
        uint totalInputAmount;
        for (uint i = 0; i < pools.length; i++) {
            bestInputAmounts[i] = swapAmount.mul(pools[i].effectiveLiquidity).div(sumEffectiveLiquidity);
            totalInputAmount = totalInputAmount.add(bestInputAmounts[i]);
        }

        if (totalInputAmount < swapAmount) {
            bestInputAmounts[0] = bestInputAmounts[0].add(swapAmount.sub(totalInputAmount));
        } else {
            bestInputAmounts[0] = bestInputAmounts[0].sub(totalInputAmount.sub(swapAmount));
        }

        swaps = new Swap[](pools.length);

        for (uint i = 0; i < pools.length; i++) {
            swaps[i] = Swap({
            pool : pools[i].pool,
            tokenIn : tokenIn,
            tokenOut : tokenOut,
            swapAmount : bestInputAmounts[i],
            limitReturnAmount : uint(- 1),
            maxPrice : uint(- 1)
            });
        }

        totalOutput = calcTotalOutExactOut(bestInputAmounts, pools);

        return (swaps, totalOutput);
    }

    function getPoolData(
        address tokenIn,
        address tokenOut,
        address poolAddress
    )
    internal view
    returns (Pool memory)
    {
        IBPool pool = IBPool(poolAddress);
        uint tokenBalanceIn = pool.getBalance(tokenIn);
        uint tokenBalanceOut = pool.getBalance(tokenOut);
        uint tokenWeightIn = pool.getDenormalizedWeight(tokenIn);
        uint tokenWeightOut = pool.getDenormalizedWeight(tokenOut);
        uint swapFee = pool.swapFee();

        uint effectiveLiquidity = calcEffectiveLiquidity(
            tokenWeightIn,
            tokenBalanceOut,
            tokenWeightOut
        );
        Pool memory returnPool = Pool({
        pool : poolAddress,
        tokenBalanceIn : tokenBalanceIn,
        tokenWeightIn : tokenWeightIn,
        tokenBalanceOut : tokenBalanceOut,
        tokenWeightOut : tokenWeightOut,
        swapFee : swapFee,
        effectiveLiquidity : effectiveLiquidity
        });

        return returnPool;
    }

    function calcEffectiveLiquidity(
        uint tokenWeightIn,
        uint tokenBalanceOut,
        uint tokenWeightOut
    )
    internal pure
    returns (uint effectiveLiquidity)
    {

        // Bo * wi/(wi+wo)
        effectiveLiquidity =
        tokenWeightIn.mul(BONE).div(
            tokenWeightOut.add(tokenWeightIn)
        ).mul(tokenBalanceOut).div(BONE);

        return effectiveLiquidity;
    }

    function calcTotalOutExactIn(
        uint[] memory bestInputAmounts,
        Pool[] memory bestPools
    )
    internal pure
    returns (uint totalOutput)
    {
        totalOutput = 0;
        for (uint i = 0; i < bestInputAmounts.length; i++) {
            uint output = IBPool(bestPools[i].pool).calcOutGivenIn(
                bestPools[i].tokenBalanceIn,
                bestPools[i].tokenWeightIn,
                bestPools[i].tokenBalanceOut,
                bestPools[i].tokenWeightOut,
                bestInputAmounts[i],
                bestPools[i].swapFee
            );

            totalOutput = totalOutput.add(output);
        }
        return totalOutput;
    }

    function calcTotalOutExactOut(
        uint[] memory bestInputAmounts,
        Pool[] memory bestPools
    ) internal pure returns (uint totalOutput)
    {
        totalOutput = 0;
        for (uint i = 0; i < bestInputAmounts.length; i++) {
            uint output = IBPool(bestPools[i].pool).calcInGivenOut(
                bestPools[i].tokenBalanceIn,
                bestPools[i].tokenWeightIn,
                bestPools[i].tokenBalanceOut,
                bestPools[i].tokenWeightOut,
                bestInputAmounts[i],
                bestPools[i].swapFee
            );

            totalOutput = totalOutput.add(output);
        }
        return totalOutput;
    }


    function transferFromAllAndApprove(address token, uint amount, address spender) internal returns (bool containsETH) {
        if (isETH(token)) {
            require(amount == msg.value, "!invalid amount");
            weth.deposit{value : amount}();
            IERC20(address(weth)).safeApprove(spender, amount);
            containsETH = true;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            IERC20(token).safeApprove(spender, amount);
        }
        return containsETH;
    }

    function transferFromAll(address token, uint amount) internal returns (bool containsETH) {
        if (isETH(token)) {
            weth.deposit{value : msg.value}();
            containsETH = true;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
        return containsETH;
    }

    function getBalance(address token) internal view returns (uint) {
        if (isETH(token)) {
            return weth.balanceOf(address(this));
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }

    function transferAll(address token, uint amount) internal returns (bool) {
        if (amount == 0) {
            return true;
        }
        if (isETH(token)) {
            weth.withdraw(amount);
            (bool xfer,) = msg.sender.call{value : amount}("");
            require(xfer, "ERR_ETH_FAILED");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        return true;
    }

    function isETH(address token) internal pure returns (bool) {
        return (address(token) == ETH_ADDRESS);
    }

    /**
     * This function allows governance to take unsupported tokens out of the contract.
     * This is in an effort to make someone whole, should they seriously mess up.
     * There is no guarantee governance will vote to return these.
     * It also allows for removal of airdropped tokens.
     */
    function governanceRecoverUnsupported(address _token, uint _amount, address _to) external {
        require(msg.sender == governance, "!governance");
        if (isETH(_token)) {
            (bool xfer,) = _to.call{value : _amount}("");
            require(xfer, "ERR_ETH_FAILED");
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
    }

    receive() external payable {}
}