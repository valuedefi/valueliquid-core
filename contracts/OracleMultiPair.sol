// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IOracle.sol";
import "./interfaces/IValueLiquidFactory.sol";
import "./interfaces/IValueLiquidPair.sol";
import "./interfaces/IEpochController.sol";
import "./interfaces/IAggregatorInterface.sol";
import "./interfaces/IERC20.sol";
import "./libraries/FixedPoint.sol";
import "./libraries/UQ112x112.sol";

// fixed window oracle that recomputes the average price for the entire epochPeriod once every epochPeriod
// note that the price average is only guaranteed to be over at least 1 epochPeriod, but may be over a longer epochPeriod
contract OracleMultiPair is Ownable, IOracle {
    using FixedPoint for *;
    using SafeMath for uint256;
    using UQ112x112 for uint224;

    /* ========= CONSTANT VARIABLES ======== */

    uint256 public oracleReserveMinimum;

    /* ========== STATE VARIABLES ========== */

    // governance
    address public operator;
    address public factory;

    // epoch
    address public epochController;
    uint256 public maxEpochPeriod;

    // 1-hour update
    uint256 public lastUpdateHour;
    uint256 public updatePeriod;

    mapping(uint256 => uint256) public epochDollarPrice;

    // chain-link price feed
    mapping(address => address) public chainLinkOracle;

    // ValueLiquidPair
    address public mainToken;
    bool[] public isToken0s;
    uint256[] public decimalFactors;
    uint32[] public mainTokenWeights;
    IValueLiquidPair[] public pairs;

    // Pair price for update in cumulative epochPeriod
    uint public priceCumulative;
    uint[] public priceMainCumulativeLast;

    // oracle
    uint256 public priceCumulativeLast;
    FixedPoint.uq112x112 public priceAverage;

    uint32 public blockTimestampCumulativeLast;
    uint32 public blockTimestampLast;

    event Updated(uint256 priceCumulativeLast);

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address[] memory _pairs,
        address _mainToken,
        address _epochController,
        uint256 _maxEpochPeriod,
        uint256 _updatePeriod,
        uint256 _lastUpdateHour,
        address _pairFactory,
        address _defaultOracle,
        uint256 _oracleReserveMinimum
    ) public {
        for (uint256 i = 0; i < _pairs.length; i++) {
            IValueLiquidPair pair = IValueLiquidPair(_pairs[i]);
            {
                (uint reserve0, uint reserve1,) = pair.getReserves();
                require(reserve0 != 0 && reserve1 != 0, "OracleMultiPair: NO_RESERVES"); // ensure that there's liquidity in the pair
            }

            pairs.push(pair);
            bool isToken0 = pair.token0() == _mainToken;
            isToken0s.push(isToken0);
            priceMainCumulativeLast.push(0);
            {
                uint decimal = IERC20(isToken0 ? pair.token1() : pair.token0()).decimals();
                decimalFactors.push(10 ** (uint256(18).sub(decimal)));
            }
            (uint32 _tokenWeight0, uint32 _tokenWeight1,) = IValueLiquidFactory(_pairFactory).getWeightsAndSwapFee(_pairs[i]);
            mainTokenWeights.push(isToken0 ? _tokenWeight0 : _tokenWeight1);
        }

        epochController = _epochController;
        maxEpochPeriod = _maxEpochPeriod;
        lastUpdateHour = _lastUpdateHour;
        updatePeriod = _updatePeriod;
        factory = _pairFactory;
        mainToken = _mainToken;
        chainLinkOracle[address(0)] = _defaultOracle;
        oracleReserveMinimum = _oracleReserveMinimum;

        updateCumulative();
        lastUpdateHour = _lastUpdateHour;
        priceCumulativeLast = priceCumulative;
        blockTimestampLast = blockTimestampCumulativeLast;
        operator = msg.sender;
    }

    /* ========== GOVERNANCE ========== */

    function setOperator(address _operator) external onlyOperator {
        operator = _operator;
    }

    function setEpochController(address _epochController) external onlyOperator {
        epochController = _epochController;
    }

    function setChainLinkOracle(address _token, address _priceFeed) external onlyOperator {
        chainLinkOracle[_token] = _priceFeed;
    }

    function setOracleReserveMinimum(uint256 _oracleReserveMinimum) external onlyOperator {
        oracleReserveMinimum = _oracleReserveMinimum;
    }

    function setMaxEpochPeriod(uint256 _maxEpochPeriod) external onlyOperator {
        require(_maxEpochPeriod <= 48 hours, '_maxEpochPeriod is not valid');
        maxEpochPeriod = _maxEpochPeriod;
    }

    function setLastUpdateHour(uint256 _lastUpdateHour) external onlyOperator {
        require(_lastUpdateHour % 3600 == 0, '_lastUpdateHour is not valid');
        lastUpdateHour = _lastUpdateHour;
    }

    function addPair(address _pair) public onlyOperator {
        IValueLiquidPair pair = IValueLiquidPair(_pair);
        (uint reserve0, uint reserve1,) = pair.getReserves();
        require(reserve0 != 0 && reserve1 != 0, "OracleMultiPair: NO_RESERVES");
        // ensure that there's liquidity in the pair

        pairs.push(pair);
        bool isToken0 = pair.token0() == mainToken;
        isToken0s.push(isToken0);
        priceMainCumulativeLast.push(isToken0 ? pair.price0CumulativeLast() : pair.price1CumulativeLast());
        {
            uint decimal = IERC20(isToken0 ? pair.token1() : pair.token0()).decimals();
            decimalFactors.push(10 ** (uint256(18).sub(decimal)));
        }
        (uint32 _tokenWeight0, uint32 _tokenWeight1,) = IValueLiquidFactory(factory).getWeightsAndSwapFee(_pair);
        mainTokenWeights.push(isToken0 ? _tokenWeight0 : _tokenWeight1);
    }

    function removePair(address _pair) public onlyOperator {
        uint last = pairs.length - 1;

        for (uint256 i = 0; i < pairs.length; i++) {
            if (address(pairs[i]) == _pair) {
                pairs[i] = pairs[last];
                isToken0s[i] = isToken0s[last];
                priceMainCumulativeLast[i] = priceMainCumulativeLast[last];
                decimalFactors[i] = decimalFactors[last];
                mainTokenWeights[i] = mainTokenWeights[last];

                pairs.pop();
                isToken0s.pop();
                mainTokenWeights.pop();
                priceMainCumulativeLast.pop();
                decimalFactors.pop();

                break;
            }
        }
    }

    /* =================== Modifier =================== */

    modifier checkEpoch {
        require(block.timestamp >= nextEpochPoint(), "OracleMultiPair: not opened yet");
        _;
    }

    modifier onlyOperator() {
        require(operator == msg.sender, "OracleMultiPair: caller is not the operator");
        _;
    }

    /* ========== VIEW FUNCTIONS ========== */

    function epoch() public override view returns (uint256) {
        return IEpochController(epochController).epoch();
    }

    function nextEpochPoint() public override view returns (uint256) {
        return IEpochController(epochController).nextEpochPoint();
    }

    function nextEpochLength() external view returns (uint256) {
        return IEpochController(epochController).nextEpochLength();
    }

    function nextUpdateHour() public view returns (uint256) {
        return lastUpdateHour.add(updatePeriod);
    }

    /* ========== MUTABLE FUNCTIONS ========== */
    // update reserves and, on the first call per block, price accumulators
    function updateCumulative() public override {
        uint256 _updatePeriod = updatePeriod;
        uint256 _nextUpdateHour = lastUpdateHour.add(_updatePeriod);
        if (block.timestamp >= _nextUpdateHour) {
            uint totalMainPriceWeight;
            uint totalSidePairBal;

            uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
            if (blockTimestamp != blockTimestampCumulativeLast) {
                for (uint256 i = 0; i < pairs.length; i++) {
                    (uint priceMainCumulative,,
                    uint reserveSideToken) = currentTokenCumulativePriceAndReserves(pairs[i], isToken0s[i], mainTokenWeights[i], blockTimestamp);

                    uint _decimalFactor = decimalFactors[i];
                    uint reserveBal = reserveSideToken.mul(_decimalFactor);
                    require(reserveBal >= oracleReserveMinimum, "!min reserve");

                    totalMainPriceWeight = totalMainPriceWeight.add((priceMainCumulative - priceMainCumulativeLast[i]).mul(reserveSideToken.mul(_decimalFactor)));
                    totalSidePairBal = totalSidePairBal.add(reserveSideToken);
                    priceMainCumulativeLast[i] = priceMainCumulative;
                }

                require(totalSidePairBal <= uint112(- 1), 'OracleMultiPair: OVERFLOW');
                if (totalSidePairBal != 0) {
                    priceCumulative += totalMainPriceWeight.div(totalSidePairBal);
                    blockTimestampCumulativeLast = blockTimestamp;
                }
            }

            for (;;) {
                if (block.timestamp < _nextUpdateHour.add(_updatePeriod)) {
                    lastUpdateHour = _nextUpdateHour;
                    break;
                } else {
                    _nextUpdateHour = _nextUpdateHour.add(_updatePeriod);
                }
            }
        }
    }

    /** @dev Updates 1-day EMA price.  */
    function update() external override checkEpoch {
        updateCumulative();

        uint32 _blockTimestampCumulativeLast = blockTimestampCumulativeLast; // gas saving
        uint32 timeElapsed = _blockTimestampCumulativeLast - blockTimestampLast; // overflow is desired

        if (timeElapsed == 0) {
            // prevent divided by zero
            return;
        }

        // overflow is desired, casting never truncates
        // cumulative price is in (uq112x112 price * seconds) units so we simply wrap it after division by time elapsed
        uint _priceCumulative = priceCumulative; //gas saving
        priceAverage = FixedPoint.uq112x112(uint224((_priceCumulative - priceCumulativeLast) / timeElapsed));

        priceCumulativeLast = _priceCumulative;
        blockTimestampLast = _blockTimestampCumulativeLast;

        epochDollarPrice[epoch()] = consultDollarPrice(address(0), 1e18);
        emit Updated(_priceCumulative);
    }

    // note this will always return 0 before update has been called successfully for the first time.
    function consult(address _token, uint256 _amountIn) public override view returns (uint144 _amountOut) {
        require(_token == mainToken, "OracleMultiPair: INVALID_TOKEN");
        require(block.timestamp.sub(blockTimestampLast) <= maxEpochPeriod, "OracleMultiPair: Price out-of-date");
        _amountOut = priceAverage.mul(_amountIn).decode144();
    }

    function consultDollarPrice(address _sideToken, uint256 _amountIn) public override view returns (uint256 _dollarPrice) {
        address _priceFeed = chainLinkOracle[_sideToken];
        require(_priceFeed != address(0), "OracleMultiPair: No price feed");
        int256 _price = IAggregatorInterface(_priceFeed).latestAnswer();
        uint144 _amountOut = consult(mainToken, _amountIn);
        return uint256(_amountOut).mul(uint256(_price)).div(1e8);
    }

    function twap(uint256 _amountIn) public override view returns (uint144 _amountOut) {
        uint32 timeElapsed = blockTimestampCumulativeLast - blockTimestampLast;
        _amountOut = (timeElapsed == 0) ? priceAverage.mul(_amountIn).decode144() : FixedPoint.uq112x112(uint224((priceCumulative - priceCumulativeLast) / timeElapsed)).mul(_amountIn).decode144();
    }

    function twapDollarPrice(address _sideToken, uint256 _amountIn) external override view returns (uint256 _amountOut) {
        address _priceFeed = chainLinkOracle[_sideToken];
        require(_priceFeed != address(0), "OracleMultiPair: No price feed");
        int256 _price = IAggregatorInterface(_priceFeed).latestAnswer();
        uint144 _amountOut = twap(_amountIn);
        return uint256(_amountOut).mul(uint256(_price)).div(1e8);
    }

    function governanceRecoverUnsupported(IERC20 _token, uint256 _amount, address _to) external onlyOperator {
        _token.transfer(_to, _amount);
    }

    // produces the cumulative price using counterfactuals to save gas and avoid a call to sync
    function currentTokenCumulativePriceAndReserves(
        IValueLiquidPair pair,
        bool isToken0,
        uint32 mainTokenWeight,
        uint32 blockTimestamp
    ) internal view returns (uint _priceCumulative, uint reserveMain, uint reserveSideToken) {
        uint32 _blockTimestampLast;
        if (isToken0) {
            (reserveMain, reserveSideToken, _blockTimestampLast) = pair.getReserves();
            _priceCumulative = pair.price0CumulativeLast();
        } else {
            (reserveSideToken, reserveMain, _blockTimestampLast) = pair.getReserves();
            _priceCumulative = pair.price1CumulativeLast();
        }

        // if time has elapsed since the last update on the pair, mock the accumulated price values
        if (_blockTimestampLast != blockTimestamp) {
            // subtraction overflow is desired
            uint32 timeElapsed = blockTimestamp - _blockTimestampLast;
            // addition overflow is desired
            // counterfactual
            uint112 mReserveMain = uint112(reserveMain) * (100 - mainTokenWeight);
            uint112 mReserveSide = uint112(reserveSideToken) * mainTokenWeight;
            _priceCumulative += uint(FixedPoint.fraction(mReserveSide, mReserveMain)._x) * timeElapsed;
        }
    }
}
