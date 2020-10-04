// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

import "./BToken.sol";
import "./BMath.sol";

interface IBFactory {
    function collectedToken() external view returns(address);
}

contract BPool is BToken, BMath {
    struct Record {
        bool bound;   // is token bound to pool
        uint index;   // private
        uint denorm;  // denormalized weight
        uint balance;
    }

    event LOG_SWAP(
        address indexed caller,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256         tokenAmountIn,
        uint256         tokenAmountOut
    );

    event LOG_JOIN(
        address indexed caller,
        address indexed tokenIn,
        uint256         tokenAmountIn
    );

    event LOG_EXIT(
        address indexed caller,
        address indexed tokenOut,
        uint256         tokenAmountOut
    );
    event LOG_CALL(
        bytes4  indexed sig,
        address indexed caller,
        bytes           data
    ) anonymous;

    modifier _logs_() {
        emit LOG_CALL(msg.sig, msg.sender, msg.data);
        _;
    }
    event LOG_COLLECTED_FUND(
        address indexed collectedToken,
        uint256         collectedAmount
    );

    modifier _lock_() {
        require(!_mutex, "reentry");
        _mutex = true;
        _;
        _mutex = false;
    }

    modifier _viewlock_() {
        require(!_mutex, "reentry");
        _;
    }

    bool private _mutex;

    uint public version = 1001;
    address public factory;    // BFactory address to push token exitFee to
    address public controller; // has CONTROL role
    bool public publicSwap;

    // `setSwapFee` and `finalize` require CONTROL
    // `finalize` sets `PUBLIC can SWAP`, `PUBLIC can JOIN`
    uint public initPoolSupply;
    uint public swapFee;
    uint public collectedFee; // 0.05% | https://yfv.finance/vip-vote/vip_5
    uint public exitFee;
    bool public finalized;

    address[] private _tokens;
    mapping(address => Record) private _records;
    uint private _totalWeight;

    constructor(address _factory) public {
        controller = _factory;
        factory = _factory;
        initPoolSupply = BConst.DEFAULT_INIT_POOL_SUPPLY;
        swapFee = BConst.DEFAULT_FEE;
        collectedFee = BConst.DEFAULT_COLLECTED_FEE;
        exitFee = BConst.DEFAULT_EXIT_FEE;
        publicSwap = false;
        finalized = false;
    }

    function setInitPoolSupply(uint _initPoolSupply) public _logs_ {
        require(!finalized, "finalized");
        require(msg.sender == controller, "!controller");
        require(_initPoolSupply >= BConst.MIN_INIT_POOL_SUPPLY, "<minInitPoolSup");
        require(_initPoolSupply <= BConst.MAX_INIT_POOL_SUPPLY, ">maxInitPoolSup");
        initPoolSupply = _initPoolSupply;
    }

    function setCollectedFee(uint _collectedFee) public _logs_ {
        require(msg.sender == factory, "!factory");
        require(_collectedFee <= BConst.MAX_COLLECTED_FEE, ">maxCoFee");
        require(bmul(_collectedFee, 2) <= swapFee, ">swapFee/2");
        collectedFee = _collectedFee;
    }

    function setExitFee(uint _exitFee) public _logs_ {
        require(!finalized, "finalized");
        require(msg.sender == factory, "!factory");
        require(_exitFee <= BConst.MAX_EXIT_FEE, ">maxExitFee");
        exitFee = _exitFee;
    }

    function isBound(address t)
        external view
        returns (bool)
    {
        return _records[t].bound;
    }

    function getNumTokens()
        external view
        returns (uint) 
    {
        return _tokens.length;
    }

    function getCurrentTokens()
        external view _viewlock_
        returns (address[] memory tokens)
    {
        return _tokens;
    }

    function getFinalTokens()
        external view
        _viewlock_
        returns (address[] memory tokens)
    {
        require(finalized, "!finalized");
        return _tokens;
    }

    function getDenormalizedWeight(address token)
        external view
        _viewlock_
        returns (uint)
    {

        require(_records[token].bound, "!bound");
        return _records[token].denorm;
    }

    function getTotalDenormalizedWeight()
        external view
        _viewlock_
        returns (uint)
    {
        return _totalWeight;
    }

    function getNormalizedWeight(address token)
        external view
        _viewlock_
        returns (uint)
    {

        require(_records[token].bound, "!bound");
        uint denorm = _records[token].denorm;
        return bdiv(denorm, _totalWeight);
    }

    function getBalance(address token)
        external view
        _viewlock_
        returns (uint)
    {

        require(_records[token].bound, "!bound");
        return _records[token].balance;
    }

    function setSwapFee(uint _swapFee)
        external
        _lock_
        _logs_
    {
        require(!finalized, "finalized");
        require(msg.sender == controller, "!controller");
        require(_swapFee >= BConst.MIN_FEE, "<minFee");
        require(_swapFee <= BConst.MAX_FEE, ">maxFee");
        require(bmul(collectedFee, 2) <= _swapFee, "<collectedFee*2");
        swapFee = _swapFee;
    }

    function setController(address _controller)
        external
        _lock_
        _logs_
    {
        require(msg.sender == controller, "!controller");
        controller = _controller;
    }

    function setPublicSwap(bool _publicSwap)
        external
        _lock_
        _logs_
    {
        require(!finalized, "finalized");
        require(msg.sender == controller, "!controller");
        publicSwap = _publicSwap;
    }

    function finalize()
        external
        _lock_
        _logs_
    {
        require(msg.sender == controller, "!controller");
        require(!finalized, "finalized");
        require(_tokens.length >= BConst.MIN_BOUND_TOKENS, "<minTokens");

        finalized = true;
        publicSwap = true;

        _mintPoolShare(initPoolSupply);
        _pushPoolShare(msg.sender, initPoolSupply);
    }


    function bind(address token, uint balance, uint denorm)
        external
        _logs_
        // _lock_  Bind does not lock because it jumps to `rebind`, which does
    {
        require(msg.sender == controller, "!controller");
        require(!_records[token].bound, "bound");
        require(!finalized, "finalized");

        require(_tokens.length < BConst.MAX_BOUND_TOKENS, ">maxTokens");

        _records[token] = Record({
            bound: true,
            index: _tokens.length,
            denorm: 0,    // balance and denorm will be validated
            balance: 0   // and set by `rebind`
        });
        _tokens.push(token);
        rebind(token, balance, denorm);
    }

    function rebind(address token, uint balance, uint denorm)
        public
        _lock_
        _logs_
    {

        require(msg.sender == controller, "!controller");
        require(_records[token].bound, "!bound");
        require(!finalized, "finalized");

        require(denorm >= BConst.MIN_WEIGHT, "<minWeight");
        require(denorm <= BConst.MAX_WEIGHT, ">maxWeight");
        require(balance >= BConst.MIN_BALANCE, "<minBal");

        // Adjust the denorm and totalWeight
        uint oldWeight = _records[token].denorm;
        if (denorm > oldWeight) {
            _totalWeight = badd(_totalWeight, bsub(denorm, oldWeight));
            require(_totalWeight <= BConst.MAX_TOTAL_WEIGHT, ">maxTWeight");
        } else if (denorm < oldWeight) {
            _totalWeight = bsub(_totalWeight, bsub(oldWeight, denorm));
        }        
        _records[token].denorm = denorm;

        // Adjust the balance record and actual token balance
        uint oldBalance = _records[token].balance;
        _records[token].balance = balance;
        if (balance > oldBalance) {
            _pullUnderlying(token, msg.sender, bsub(balance, oldBalance));
        } else if (balance < oldBalance) {
            // In this case liquidity is being withdrawn, so charge EXIT_FEE
            uint tokenBalanceWithdrawn = bsub(oldBalance, balance);
            uint tokenExitFee = bmul(tokenBalanceWithdrawn, exitFee);
            _pushUnderlying(token, msg.sender, bsub(tokenBalanceWithdrawn, tokenExitFee));
            _pushUnderlying(token, factory, tokenExitFee);
        }
    }

    function unbind(address token)
        external
        _lock_
        _logs_
    {

        require(msg.sender == controller, "!controller");
        require(_records[token].bound, "!bound");
        require(!finalized, "finalized");

        uint tokenBalance = _records[token].balance;
        uint tokenExitFee = bmul(tokenBalance, exitFee);

        _totalWeight = bsub(_totalWeight, _records[token].denorm);

        // Swap the token-to-unbind with the last token,
        // then delete the last token
        uint index = _records[token].index;
        uint last = _tokens.length - 1;
        _tokens[index] = _tokens[last];
        _records[_tokens[index]].index = index;
        _tokens.pop();
        _records[token] = Record({
            bound: false,
            index: 0,
            denorm: 0,
            balance: 0
        });

        _pushUnderlying(token, msg.sender, bsub(tokenBalance, tokenExitFee));
        _pushUnderlying(token, factory, tokenExitFee);
    }

    // Absorb any tokens that have been sent to this contract into the pool
    function gulp(address token)
        external
        _logs_
        _lock_
    {
        require(_records[token].bound, "!bound");
        _records[token].balance = IERC20(token).balanceOf(address(this));
    }

    function getSpotPrice(address tokenIn, address tokenOut)
        external view
        _viewlock_
        returns (uint spotPrice)
    {
        require(_records[tokenIn].bound, "!bound");
        require(_records[tokenOut].bound, "!bound");
        Record storage inRecord = _records[tokenIn];
        Record storage outRecord = _records[tokenOut];
        return calcSpotPrice(inRecord.balance, inRecord.denorm, outRecord.balance, outRecord.denorm, swapFee);
    }

    function getSpotPriceSansFee(address tokenIn, address tokenOut)
        external view
        _viewlock_
        returns (uint spotPrice)
    {
        require(_records[tokenIn].bound, "!bound");
        require(_records[tokenOut].bound, "!bound");
        Record storage inRecord = _records[tokenIn];
        Record storage outRecord = _records[tokenOut];
        return calcSpotPrice(inRecord.balance, inRecord.denorm, outRecord.balance, outRecord.denorm, 0);
    }

    function joinPool(uint poolAmountOut, uint[] calldata maxAmountsIn)
        external
        _lock_
        _logs_
    {
        require(finalized, "!finalized");

        uint poolTotal = totalSupply();
        uint ratio = bdiv(poolAmountOut, poolTotal);
        require(ratio != 0, "errMathAprox");

        for (uint i = 0; i < _tokens.length; i++) {
            address t = _tokens[i];
            uint bal = _records[t].balance;
            uint tokenAmountIn = bmul(ratio, bal);
            require(tokenAmountIn != 0, "errMathAprox");
            require(tokenAmountIn <= maxAmountsIn[i], "<limIn");
            _records[t].balance = badd(_records[t].balance, tokenAmountIn);
            emit LOG_JOIN(msg.sender, t, tokenAmountIn);
            _pullUnderlying(t, msg.sender, tokenAmountIn);
        }
        _mintPoolShare(poolAmountOut);
        _pushPoolShare(msg.sender, poolAmountOut);
    }

    function exitPool(uint poolAmountIn, uint[] calldata minAmountsOut)
        external
        _lock_
        _logs_
    {
        require(finalized, "!finalized");

        uint poolTotal = totalSupply();
        uint _exitFee = bmul(poolAmountIn, exitFee);
        uint pAiAfterExitFee = bsub(poolAmountIn, _exitFee);
        uint ratio = bdiv(pAiAfterExitFee, poolTotal);
        require(ratio != 0, "errMathAprox");

        _pullPoolShare(msg.sender, poolAmountIn);
        _pushPoolShare(factory, _exitFee);
        _burnPoolShare(pAiAfterExitFee);

        for (uint i = 0; i < _tokens.length; i++) {
            address t = _tokens[i];
            uint bal = _records[t].balance;
            uint tokenAmountOut = bmul(ratio, bal);
            require(tokenAmountOut != 0, "errMathAprox");
            require(tokenAmountOut >= minAmountsOut[i], "<limO");
            _records[t].balance = bsub(_records[t].balance, tokenAmountOut);
            emit LOG_EXIT(msg.sender, t, tokenAmountOut);
            _pushUnderlying(t, msg.sender, tokenAmountOut);
        }
    }


    function swapExactAmountIn(
        address tokenIn,
        uint tokenAmountIn,
        address tokenOut,
        uint minAmountOut,
        uint maxPrice
    )
        external
        _lock_
        _logs_
        returns (uint tokenAmountOut, uint spotPriceAfter)
    {

        require(_records[tokenIn].bound, "!bound");
        require(_records[tokenOut].bound, "!bound");
        require(publicSwap, "!publicSwap");

        Record storage inRecord = _records[address(tokenIn)];
        Record storage outRecord = _records[address(tokenOut)];

        require(tokenAmountIn <= bmul(inRecord.balance, BConst.MAX_IN_RATIO), ">maxIRat");

        uint spotPriceBefore = calcSpotPrice(
                                    inRecord.balance,
                                    inRecord.denorm,
                                    outRecord.balance,
                                    outRecord.denorm,
                                    swapFee
                                );
        require(spotPriceBefore <= maxPrice, "badLimPrice");

        tokenAmountOut = calcOutGivenIn(
                            inRecord.balance,
                            inRecord.denorm,
                            outRecord.balance,
                            outRecord.denorm,
                            tokenAmountIn,
                            swapFee
                        );
        require(tokenAmountOut >= minAmountOut, "<limO");

        inRecord.balance = badd(inRecord.balance, tokenAmountIn);
        outRecord.balance = bsub(outRecord.balance, tokenAmountOut);

        spotPriceAfter = calcSpotPrice(
                                inRecord.balance,
                                inRecord.denorm,
                                outRecord.balance,
                                outRecord.denorm,
                                swapFee
                            );
        require(spotPriceAfter >= spotPriceBefore, "errMathAprox");
        require(spotPriceAfter <= maxPrice, ">limPrice");
        require(spotPriceBefore <= bdiv(tokenAmountIn, tokenAmountOut), "errMathAprox");

        emit LOG_SWAP(msg.sender, tokenIn, tokenOut, tokenAmountIn, tokenAmountOut);

        _pullUnderlying(tokenIn, msg.sender, tokenAmountIn);
        uint _subTokenAmountIn;
        (_subTokenAmountIn, tokenAmountOut) = _pushCollectedFundGivenOut(tokenIn, tokenAmountIn, tokenOut, tokenAmountOut);
        if (_subTokenAmountIn > 0) inRecord.balance = bsub(inRecord.balance, _subTokenAmountIn);
        _pushUnderlying(tokenOut, msg.sender, tokenAmountOut);

        return (tokenAmountOut, spotPriceAfter);
    }

    function swapExactAmountOut(
        address tokenIn,
        uint maxAmountIn,
        address tokenOut,
        uint tokenAmountOut,
        uint maxPrice
    )
        external
        _lock_
        _logs_
        returns (uint tokenAmountIn, uint spotPriceAfter)
    {
        require(_records[tokenIn].bound, "!bound");
        require(_records[tokenOut].bound, "!bound");
        require(publicSwap, "!publicSwap");

        Record storage inRecord = _records[address(tokenIn)];
        Record storage outRecord = _records[address(tokenOut)];

        require(tokenAmountOut <= bmul(outRecord.balance, BConst.MAX_OUT_RATIO), ">maxORat");

        uint spotPriceBefore = calcSpotPrice(
                                    inRecord.balance,
                                    inRecord.denorm,
                                    outRecord.balance,
                                    outRecord.denorm,
                                    swapFee
                                );
        require(spotPriceBefore <= maxPrice, "badLimPrice");

        tokenAmountIn = calcInGivenOut(
                            inRecord.balance,
                            inRecord.denorm,
                            outRecord.balance,
                            outRecord.denorm,
                            tokenAmountOut,
                            swapFee
                        );
        require(tokenAmountIn <= maxAmountIn, "<limIn");

        inRecord.balance = badd(inRecord.balance, tokenAmountIn);
        outRecord.balance = bsub(outRecord.balance, tokenAmountOut);

        spotPriceAfter = calcSpotPrice(
                                inRecord.balance,
                                inRecord.denorm,
                                outRecord.balance,
                                outRecord.denorm,
                                swapFee
                            );
        require(spotPriceAfter >= spotPriceBefore, "errMathAprox");
        require(spotPriceAfter <= maxPrice, ">limPrice");
        require(spotPriceBefore <= bdiv(tokenAmountIn, tokenAmountOut), "errMathAprox");

        emit LOG_SWAP(msg.sender, tokenIn, tokenOut, tokenAmountIn, tokenAmountOut);

        _pullUnderlying(tokenIn, msg.sender, tokenAmountIn);
        _pushUnderlying(tokenOut, msg.sender, tokenAmountOut);
        uint _collectedFeeAmount = _pushCollectedFundGivenIn(tokenIn, tokenAmountIn);
        if (_collectedFeeAmount > 0) inRecord.balance = bsub(inRecord.balance, _collectedFeeAmount);

        return (tokenAmountIn, spotPriceAfter);
    }


    function joinswapExternAmountIn(address tokenIn, uint tokenAmountIn, uint minPoolAmountOut)
        external
        _lock_
        _logs_
        returns (uint poolAmountOut)

    {        
        require(finalized, "!finalized");
        require(_records[tokenIn].bound, "!bound");
        require(tokenAmountIn <= bmul(_records[tokenIn].balance, BConst.MAX_IN_RATIO), ">maxIRat");

        Record storage inRecord = _records[tokenIn];

        poolAmountOut = calcPoolOutGivenSingleIn(
                            inRecord.balance,
                            inRecord.denorm,
                            _totalSupply,
                            _totalWeight,
                            tokenAmountIn,
                            swapFee
                        );

        require(poolAmountOut >= minPoolAmountOut, "<limO");

        inRecord.balance = badd(inRecord.balance, tokenAmountIn);

        emit LOG_JOIN(msg.sender, tokenIn, tokenAmountIn);

        _mintPoolShare(poolAmountOut);
        _pullUnderlying(tokenIn, msg.sender, tokenAmountIn);
        uint _subTokenAmountIn;
        (_subTokenAmountIn, poolAmountOut) = _pushCollectedFundGivenOut(tokenIn, tokenAmountIn, address(this), poolAmountOut);
        if (_subTokenAmountIn > 0) inRecord.balance = bsub(inRecord.balance, _subTokenAmountIn);
        _pushPoolShare(msg.sender, poolAmountOut);

        return poolAmountOut;
    }

    function joinswapPoolAmountOut(address tokenIn, uint poolAmountOut, uint maxAmountIn)
        external
        _lock_
        _logs_
        returns (uint tokenAmountIn)
    {
        require(finalized, "!finalized");
        require(_records[tokenIn].bound, "!bound");

        Record storage inRecord = _records[tokenIn];

        tokenAmountIn = calcSingleInGivenPoolOut(
                            inRecord.balance,
                            inRecord.denorm,
                            _totalSupply,
                            _totalWeight,
                            poolAmountOut,
                            swapFee
                        );

        require(tokenAmountIn != 0, "errMathAprox");
        require(tokenAmountIn <= maxAmountIn, "<limIn");
        
        require(tokenAmountIn <= bmul(_records[tokenIn].balance, BConst.MAX_IN_RATIO), ">maxIRat");

        inRecord.balance = badd(inRecord.balance, tokenAmountIn);

        emit LOG_JOIN(msg.sender, tokenIn, tokenAmountIn);

        _mintPoolShare(poolAmountOut);
        _pushPoolShare(msg.sender, poolAmountOut);
        _pullUnderlying(tokenIn, msg.sender, tokenAmountIn);
        uint _collectedFeeAmount = _pushCollectedFundGivenIn(tokenIn, tokenAmountIn);
        if (_collectedFeeAmount > 0) inRecord.balance = bsub(inRecord.balance, _collectedFeeAmount);

        return tokenAmountIn;
    }

    function exitswapPoolAmountIn(address tokenOut, uint poolAmountIn, uint minAmountOut)
        external
        _lock_
        _logs_
        returns (uint tokenAmountOut)
    {
        require(finalized, "!finalized");
        require(_records[tokenOut].bound, "!bound");

        Record storage outRecord = _records[tokenOut];

        tokenAmountOut = calcSingleOutGivenPoolIn(
                            outRecord.balance,
                            outRecord.denorm,
                            _totalSupply,
                            _totalWeight,
                            poolAmountIn,
                            swapFee,
                            exitFee
                        );

        require(tokenAmountOut >= minAmountOut, "<limO");
        
        require(tokenAmountOut <= bmul(_records[tokenOut].balance, BConst.MAX_OUT_RATIO), ">maxORat");

        outRecord.balance = bsub(outRecord.balance, tokenAmountOut);

        uint _exitFee = bmul(poolAmountIn, exitFee);

        emit LOG_EXIT(msg.sender, tokenOut, tokenAmountOut);

        _pullPoolShare(msg.sender, poolAmountIn);
        _burnPoolShare(bsub(poolAmountIn, _exitFee));
        _pushPoolShare(factory, _exitFee);
        (, tokenAmountOut) = _pushCollectedFundGivenOut(address(this), poolAmountIn, tokenOut, tokenAmountOut);
        _pushUnderlying(tokenOut, msg.sender, tokenAmountOut);

        return tokenAmountOut;
    }

    function exitswapExternAmountOut(address tokenOut, uint tokenAmountOut, uint maxPoolAmountIn)
        external
        _lock_
        _logs_
        returns (uint poolAmountIn)
    {
        require(finalized, "!finalized");
        require(_records[tokenOut].bound, "!bound");
        require(tokenAmountOut <= bmul(_records[tokenOut].balance, BConst.MAX_OUT_RATIO), ">maxORat");

        Record storage outRecord = _records[tokenOut];

        poolAmountIn = calcPoolInGivenSingleOut(
                            outRecord.balance,
                            outRecord.denorm,
                            _totalSupply,
                            _totalWeight,
                            tokenAmountOut,
                            swapFee,
                            exitFee
                        );

        require(poolAmountIn != 0, "errMathAprox");
        require(poolAmountIn <= maxPoolAmountIn, "<limIn");

        outRecord.balance = bsub(outRecord.balance, tokenAmountOut);

        uint _exitFee = bmul(poolAmountIn, exitFee);

        emit LOG_EXIT(msg.sender, tokenOut, tokenAmountOut);

        _pullPoolShare(msg.sender, poolAmountIn);
        uint _collectedFeeAmount = _pushCollectedFundGivenIn(address(this), poolAmountIn);
        _burnPoolShare(bsub(bsub(poolAmountIn, _exitFee), _collectedFeeAmount));
        _pushPoolShare(factory, _exitFee);
        _pushUnderlying(tokenOut, msg.sender, tokenAmountOut);

        return poolAmountIn;
    }


    // ==
    // 'Underlying' token-manipulation functions make external calls but are NOT locked
    // You must `_lock_` or otherwise ensure reentry-safety

    function _pullUnderlying(address erc20, address from, uint amount)
        internal
    {
        bool xfer = IERC20(erc20).transferFrom(from, address(this), amount);
        require(xfer, "errErc20");
    }

    function _pushUnderlying(address erc20, address to, uint amount)
        internal
    {
        bool xfer = IERC20(erc20).transfer(to, amount);
        require(xfer, "errErc20");
    }

    function _pullPoolShare(address from, uint amount)
        internal
    {
        _pull(from, amount);
    }

    function _pushPoolShare(address to, uint amount)
        internal
    {
        _push(to, amount);
    }

    function _mintPoolShare(uint amount)
        internal
    {
        _mint(amount);
    }

    function _burnPoolShare(uint amount)
        internal
    {
        _burn(amount);
    }

    function _pushCollectedFundGivenOut(address _tokenIn, uint _tokenAmountIn, address _tokenOut, uint _tokenAmountOut) internal returns (uint subTokenAmountIn, uint tokenAmountOut) {
        subTokenAmountIn = 0;
        tokenAmountOut = _tokenAmountOut;
        if (collectedFee > 0) {
            address _collectedToken = IBFactory(factory).collectedToken();
            if (_collectedToken == _tokenIn) {
                subTokenAmountIn = bdiv(bmul(_tokenAmountIn, collectedFee), BConst.BONE);
                _pushUnderlying(_tokenIn, factory, subTokenAmountIn);
                emit LOG_COLLECTED_FUND(_tokenIn, subTokenAmountIn);
            } else {
                uint _collectedFeeAmount = bdiv(bmul(_tokenAmountOut, collectedFee), BConst.BONE);
                _pushUnderlying(_tokenOut, factory, _collectedFeeAmount);
                tokenAmountOut = bsub(_tokenAmountOut, _collectedFeeAmount);
                emit LOG_COLLECTED_FUND(_tokenOut, _collectedFeeAmount);
            }
        }
    }

    // always push out _tokenIn (already have)
    function _pushCollectedFundGivenIn(address _tokenIn, uint _tokenAmountIn) internal returns (uint collectedFeeAmount) {
        collectedFeeAmount = 0;
        if (collectedFee > 0) {
            address _collectedToken = IBFactory(factory).collectedToken();
            if (_collectedToken != address(0)) {
                collectedFeeAmount = bdiv(bmul(_tokenAmountIn, collectedFee), BConst.BONE);
                _pushUnderlying(_tokenIn, factory, collectedFeeAmount);
                emit LOG_COLLECTED_FUND(_tokenIn, collectedFeeAmount);
            }
        }
    }
}
