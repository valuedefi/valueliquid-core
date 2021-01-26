pragma solidity >=0.5.16;

import '../ValueLiquidERC20.sol';

contract ValueLiquidERC20Wrapper is ValueLiquidERC20 {
    constructor(string memory _name, string memory _symbol,uint _totalSupply) public {
        super.initialize(_name,_symbol);
        _mint(msg.sender, _totalSupply);
    }
}
