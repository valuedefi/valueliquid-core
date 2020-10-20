// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

// Token pool of arbitrary ERC20 token.
// This is owned and used by a parent Geyser
contract FaaSRewardFund {
    using SafeERC20 for IERC20;
    address public faasPool;

    constructor(address _faasPool) public {
        faasPool = _faasPool;
    }

    function balance(IERC20 _token) public view returns (uint256) {
        return _token.balanceOf(address(this));
    }

    function safeTransfer(IERC20 _token, address _to, uint256 _value) external {
        require(msg.sender == faasPool, "!faasPool");
        uint256 _tokenBal = balance(_token);
        _token.safeTransfer(_to, _tokenBal > _value ? _value : _tokenBal);
    }
}
