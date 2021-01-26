pragma solidity =0.7.6;

import '../interfaces/IValueLiquidRouter.sol';

contract RouterEventEmitter {
    event Amounts(uint[] amounts);

    receive() external payable {}

    function swapExactTokensForTokens(
        address router,
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        uint8 flag
    ) external {
        (bool success, bytes memory returnData) = router.delegatecall(abi.encodeWithSelector(
                IValueLiquidRouter(router).swapExactTokensForTokens.selector, tokenIn, tokenOut, amountIn, amountOutMin, path, to, deadline, flag
            ));
        assert(success);
        emit Amounts(abi.decode(returnData, (uint[])));
    }

    function swapTokensForExactTokens(
        address router,
        address tokenIn,
        address tokenOut,
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline,
        uint8 flag
    ) external {
        (bool success, bytes memory returnData) = router.delegatecall(abi.encodeWithSelector(
                IValueLiquidRouter(router).swapTokensForExactTokens.selector, tokenIn, tokenOut, amountOut, amountInMax, path, to, deadline, flag
            ));
        assert(success);
        emit Amounts(abi.decode(returnData, (uint[])));
    }

    function swapExactETHForTokens(
        address router,
        address tokenOut,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        uint8 flag
    ) external payable {
        (bool success, bytes memory returnData) = router.delegatecall(abi.encodeWithSelector(
                IValueLiquidRouter(router).swapExactETHForTokens.selector, tokenOut, amountOutMin, path, to, deadline, flag
            ));
        assert(success);
        emit Amounts(abi.decode(returnData, (uint[])));
    }

    function swapTokensForExactETH(
        address router,
        address tokenIn,
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline,
        uint8 flag
    ) external {
        (bool success, bytes memory returnData) = router.delegatecall(abi.encodeWithSelector(
                IValueLiquidRouter(router).swapTokensForExactETH.selector, tokenIn, amountOut, amountInMax, path, to, deadline, flag
            ));
        assert(success);
        emit Amounts(abi.decode(returnData, (uint[])));
    }

    function swapExactTokensForETH(
        address router,
        address tokenIn,
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        uint8 flag
    ) external {
        (bool success, bytes memory returnData) = router.delegatecall(abi.encodeWithSelector(
                IValueLiquidRouter(router).swapExactTokensForETH.selector, tokenIn, amountIn, amountOutMin, path, to, deadline, flag
            ));
        assert(success);
        emit Amounts(abi.decode(returnData, (uint[])));
    }

    function swapETHForExactTokens(
        address router,
        address tokenOut,
        uint amountOut,
        address[] calldata path,
        address to,
        uint deadline,
        uint8 flag
    ) external payable {
        (bool success, bytes memory returnData) = router.delegatecall(abi.encodeWithSelector(
                IValueLiquidRouter(router).swapETHForExactTokens.selector, tokenOut, amountOut, path, to, deadline, flag
            ));
        assert(success);
        emit Amounts(abi.decode(returnData, (uint[])));
    }
}
