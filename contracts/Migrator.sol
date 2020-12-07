// SPDX-License-Identifier: MIT

pragma solidity >=0.5.0;

import "./BFactory.sol";
import "./BPool.sol";

interface IToken {
    function balanceOf(address) external view returns (uint);
    function allowance(address, address) external view returns (uint);
    function approve(address, uint) external returns (bool);
    function transfer(address, uint) external returns (bool);
    function transferFrom(address, address, uint) external returns (bool);
    function deposit(uint) external;
    function withdraw(uint) external;
}

interface ILegacyBPool {
    function balanceOf(address whom) external view returns (uint);
    function getFinalTokens() external view returns (address[] memory);
    function exitPool(uint poolAmountIn, uint[] calldata minAmountsOut) external;
    function getDenormalizedWeight(address token) external view returns (uint);
    function getSwapFee() external view returns (uint);
    function isPublicSwap() external view returns (bool);
}

contract Migrator {
    address public chef;
    address public owner;
    BFactory public factory;
    IToken yfv;
    IToken value;
    uint256 public notBeforeBlock;

    constructor(
        address _chef,
        BFactory _factory,
        IToken _yfv,
        IToken _value,
        uint256 _notBeforeBlock
    ) public {
        chef = _chef;
        owner = msg.sender;
        factory = _factory;
        yfv = _yfv;
        value = _value;
        notBeforeBlock = _notBeforeBlock;
        yfv.approve(address(value), type(uint256).max);
    }

    function migrate(ILegacyBPool orig) public returns (BPool) {
        require(msg.sender == chef, "not from master chef");
        require(tx.origin == owner, "not from owner");
        require(block.number >= notBeforeBlock, "too early to migrate");

        uint256 _origBptAmount = orig.balanceOf(msg.sender);
        require(_origBptAmount > 0, "lp balance must be greater than zero");

        address[] memory _tokens = orig.getFinalTokens();
        uint i;
        for (i = 0; i < _tokens.length; i++) {
            // Transfer tokens to owner before migrate (to ensure all tokens is empty)
            IToken _token = IToken(_tokens[i]);
            uint _tokenBal = _token.balanceOf(address(this));
            if (_tokenBal > 0) {
                _pushUnderlying(address(_token), owner, _tokenBal);
            }
        }
        _pullUnderlying(address(orig), msg.sender, _origBptAmount);
        uint[] memory minAmountsOut = new uint[](_tokens.length);
        orig.exitPool(_origBptAmount, minAmountsOut);

        BPool _newPool = factory.newBPool();
        _newPool.setInitPoolSupply(_origBptAmount);
        _newPool.setSwapFee(orig.getSwapFee());
        _newPool.setPublicSwap(orig.isPublicSwap());

        for (i = 0; i < _tokens.length; i++) {
            IToken _token = IToken(_tokens[i]);
            uint _tokenBal = _token.balanceOf(address(this));
            uint _denormWeight = orig.getDenormalizedWeight(_tokens[i]);
            if (_tokens[i] == address(yfv)) {
                value.deposit(_tokenBal);
                require(value.balanceOf(address(this)) == _tokenBal, "bal(value) != bal(yfv)");
                _tokens[i] = address(value);
                _token = value;
            }
            uint _tokenAllow = _token.allowance(address(this), address(_newPool));
            if (_tokenAllow < _tokenBal) {
                if (_tokenAllow > 0) _token.approve(address(_newPool), 0);
                _token.approve(address(_newPool), _tokenBal);
            }
            _newPool.bind(_tokens[i], _tokenBal, _denormWeight);
        }
        _newPool.finalize();
        _pushUnderlying(address(_newPool), msg.sender, _origBptAmount);

        return _newPool;
    }

    function _pullUnderlying(address erc20, address from, uint amount)
    internal
    {
        bool xfer = IToken(erc20).transferFrom(from, address(this), amount);
        require(xfer, "errErc20");
    }

    function _pushUnderlying(address erc20, address to, uint amount)
    internal
    {
        bool xfer = IToken(erc20).transfer(to, amount);
        require(xfer, "errErc20");
    }
}