pragma solidity =0.7.6;

import '../libraries/UniswapV2Library.sol';
import '../interfaces/IERC20.sol';
import '../interfaces/IWETH.sol';
import "../interfaces/IUniswapV2Callee.sol";
import "../interfaces/IValueLiquidFactory.sol";
import "../interfaces/IValueLiquidRouter.sol";
import "../interfaces/IValueLiquidFormula.sol";

contract ExampleFlashSwap is IUniswapV2Callee {
    IValueLiquidFactory factoryV2;
    IValueLiquidRouter routerV2;
    IValueLiquidFormula formula;
    IERC20 tokenMain;

    constructor(address _factoryV2, address _formula, address _routerV2, address _tokenMain) public {
        factoryV2 = IValueLiquidFactory(_factoryV2);
        formula = IValueLiquidFormula(_formula);
        routerV2 = IValueLiquidRouter(_routerV2);
        tokenMain = IERC20(_tokenMain);
    }

    // needs to accept ETH from any V1 exchange and WETH. ideally this could be enforced, as in the router,
    // but it's not possible because it requires a call to the v1 factory, which takes too much gas
    receive() external payable {}

    // gets tokens/tokenMain via a V2 flash swap, swaps for the tokenMain/tokens on V1, repays V2, and keeps the rest!
    function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external override {
        address[] memory path = new address[](2);
        address[] memory pairs = new address[](1);
        uint amountToken;
        uint amountMain;
        { // scope for token{0,1}, avoids stack too deep errors
        address token0 = IValueLiquidPair(msg.sender).token0();
        address token1 = IValueLiquidPair(msg.sender).token1();

        assert(amount0 == 0 || amount1 == 0); // this strategy is unidirectional
        path[0] = amount0 == 0 ? token0 : token1;
        path[1] = amount0 == 0 ? token1 : token0;
        amountToken = token0 == address(tokenMain) ? amount1 : amount0;
        amountMain = token0 == address(tokenMain) ? amount0 : amount1;
        }

        IERC20 token = IERC20(path[0] == address(tokenMain) ? path[1] : path[0]);

        if (amountToken > 0) {
            (uint minTokenMain) = abi.decode(data, (uint)); // slippage parameter for V1, passed in by caller

            //pairArbitrage
            pairs[0] = IValueLiquidFactory(factoryV2).getPair(path[0], path[1], 50, 6);
            token.approve(address(routerV2), amountToken);
            uint amountReceived = _swapOutPutV2(
                path[0] == address(tokenMain) ? path[1] : path[0],
                address(tokenMain), amountToken, minTokenMain, pairs
            );

            pairs[0] = msg.sender;
            uint amountRequired = formula.getAmountsIn(path[0], path[1], amountToken, pairs)[0];

            transferProfit(amountReceived, amountRequired, sender, tokenMain);
        } else {
            (uint minTokens) = abi.decode(data, (uint)); // slippage parameter for V1, passed in by caller

            //pairArbitrage
            pairs[0] = IValueLiquidFactory(factoryV2).getPair(path[0], path[1], 50, 6);
            tokenMain.approve(address(routerV2), amountMain);
            uint amountReceived = _swapOutPutV2(
                path[0] == address(tokenMain) ? path[0] : path[1],
                path[0] == address(tokenMain) ? path[1] : path[0],
                amountMain, minTokens, pairs
            );

            pairs[0] = msg.sender;
            uint amountRequired = formula.getAmountsIn(path[0], path[1], amountMain, pairs)[0];

            transferProfit(amountReceived, amountRequired, sender, token);
        }
    }

    function transferProfit(uint amountReceived, uint amountRequired, address sender, IERC20 tokenProfit) internal {
        assert(amountReceived > amountRequired); // fail if we didn't get enough ETH back to repay our flash loan
        assert(tokenProfit.transfer(msg.sender, amountRequired)); // return TokenMain to V2 pair
        assert(tokenProfit.transfer(sender, amountReceived - amountRequired)); // return tokenProfit to V2 pair
    }

    function _swapOutPutV2(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOutMin,
        address[] memory path
    ) internal returns(uint256 amountReceived) {
        uint256[] memory amountReceiveds = routerV2.swapExactTokensForTokens(
            tokenIn,
            tokenOut,
            amountIn, amountOutMin, path, address(this), uint256(-1), uint8(0)
        );
        amountReceived = amountReceiveds[amountReceiveds.length - 1];
    }
}
