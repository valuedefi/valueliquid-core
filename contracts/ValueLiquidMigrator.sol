pragma solidity 0.6.12;

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

interface IUniswapV2Pair {
    function balanceOf(address owner) external view returns (uint);
    function transferFrom(address from, address to, uint value) external returns (bool);
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function burn(address to) external returns (uint amount0, uint amount1);
}

contract ValueLiquidMigrator {
    address public governance;
    BFactory public factory;
    IToken public yfv;
    IToken public value;
    bool public useDefaultSwapFee;

    constructor(
        BFactory _factory,
        IToken _yfv,
        IToken _value
    ) public {
        governance = tx.origin;
        factory = _factory;
        yfv = _yfv;
        value = _value;
        useDefaultSwapFee = true;
        yfv.approve(address(value), uint256(-1));
    }

    function setGovernance(address _governance) external {
        require(msg.sender == governance, "!governance");
        governance = _governance;
    }

    function setUseDefaultSwapFee(bool _useDefaultSwapFee) external {
        require(msg.sender == governance, "!governance");
        useDefaultSwapFee = _useDefaultSwapFee;
    }

    function _isUniswapV2Pair(address _addr) private returns (bool) {
        bytes memory uniswapV2PairIoken0FuncSelectorData = abi.encodePacked(bytes4(keccak256("token0()")));
        bool success = false;
        assembly {
            success := call(
            5000,          // gas remaining
            _addr,         // destination address
            0,             // no ether
            add(uniswapV2PairIoken0FuncSelectorData, 32),  // input buffer (starts after the first 32 bytes in the `data` array)
            mload(uniswapV2PairIoken0FuncSelectorData),    // input length (loaded from the first 32 bytes in the `data` array)
            0,              // output buffer
            0               // output length
            )
        }
        return success;
    }

    function migrate(address _orig) public returns (BPool) {
        uint _origAmount = IToken(_orig).balanceOf(msg.sender);
        require(_origAmount > 0, "lp balance must be greater than zero");

        if (_orig == address(yfv)) {
            // wrap YFV -> VALUE and forward back
            _pullUnderlying(_orig, msg.sender, _origAmount);
            value.deposit(_origAmount);
            require(value.balanceOf(address(this)) == _origAmount, "bal(value) != _origAmount");
            _pushUnderlying(address(value), msg.sender, _origAmount);
            return BPool(address(value));
        } else if (_isUniswapV2Pair(_orig)) {
            // is IUniswapV2Pair
            return _migrateUniswapV2Pair(IUniswapV2Pair(_orig), _origAmount);
        } else {
            // is ILegacyBPool
            _pullUnderlying(_orig, msg.sender, _origAmount);
            return _migrateBPool(ILegacyBPool(_orig), _origAmount);
        }
    }

    function _migrateBPool(ILegacyBPool _orig, uint _origAmount) internal returns (BPool) {
        address[] memory _tokens = _orig.getFinalTokens();
        uint[] memory minAmountsOut = new uint[](_tokens.length);
        _orig.exitPool(_origAmount, minAmountsOut);

        BPool _newPool = factory.newBPool();
        _newPool.setInitPoolSupply(_origAmount);
        if (!useDefaultSwapFee) {
            _newPool.setSwapFee(_orig.getSwapFee());
        }
        _newPool.setPublicSwap(_orig.isPublicSwap());

        for (uint8 i = 0; i < _tokens.length; ++i) {
            IToken _token = IToken(_tokens[i]);
            uint _tokenBal = _token.balanceOf(address(this));
            uint _denormWeight = _orig.getDenormalizedWeight(_tokens[i]);
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
        require(_newPool.balanceOf(address(this)) == _origAmount, "bal(_newPool) != _origBptAmount");
        _pushUnderlying(address(_newPool), msg.sender, _origAmount);

        return _newPool;
    }

    function _migrateUniswapV2Pair(IUniswapV2Pair _orig, uint _origAmount) internal returns (BPool) {
        _orig.transferFrom(msg.sender, address(_orig), _origAmount);
        _orig.burn(address(this));

        BPool _newPool = factory.newBPool();
        _newPool.setInitPoolSupply(_origAmount);

        address[] memory _tokens = new address[](2);
        _tokens[0] = _orig.token0();
        _tokens[1] = _orig.token1();

        for (uint8 i = 0; i < 2; ++i) {
            IToken _token = IToken(_tokens[i]);
            uint _tokenBal = _token.balanceOf(address(this));
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
            _newPool.bind(_tokens[i], _tokenBal, 25 ether);
        }

        _newPool.finalize();
        require(_newPool.balanceOf(address(this)) == _origAmount, "bal(_newPool) != _origBptAmount");
        _pushUnderlying(address(_newPool), msg.sender, _origAmount);

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

    /**
     * This function allows governance to take unsupported tokens out of the contract.
     * This is in an effort to make someone whole, should they seriously mess up.
     * There is no guarantee governance will vote to return these.
     * It also allows for removal of airdropped tokens.
     */
    function governanceRecoverUnsupported(IToken _token, uint _amount, address _to) external {
        require(msg.sender == governance, "!governance");
        if (address(_token) == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)) {
            (bool xfer,) = _to.call{value : _amount}("");
            require(xfer, "ERR_ETH_FAILED");
        } else {
            require(_token.transfer(_to, _amount), "ERR_TRANSFER_FAILED");
        }
    }

    receive() external payable {}
}
