const Decimal = require('decimal.js');
const {
    calcSpotPrice,
    calcOutGivenIn,
    calcInGivenOut,
    calcRelativeDiff,
} = require('../lib/calc_comparisons');

const FaaSPool = artifacts.require('FaaSPool');
const FaaSPoolCreator = artifacts.require('FaaSPoolCreator');
const BFactory = artifacts.require('BFactory');
const TToken = artifacts.require('TToken');
const errorDelta = 10 ** -3;
const swapFee = 0.003; // 0.3%;
const collectedFee = 0.0005; // 0.05%;
const exitFee = 0;
const verbose = process.env.VERBOSE;

contract('faas_pool_collected_fees', async (accounts) => {
    const { toWei } = web3.utils;
    const { fromWei } = web3.utils;
    const admin = accounts[0];
    const bob = accounts[1];
    const carol = accounts[2];

    const MAX = web3.utils.toTwosComplement(-1);
    const INIT_BALANCE = toWei('1000');

    let VALUE; let WETH; let DAI; // addresses
    let value; let weth; let dai; // TTokens
    let factory; // FaaSPool factory
    let poolCreator;
    let pool; // first pool w/ defaults
    let POOL; //   pool address

    const valueBalance = '100';
    const valueDenorm = '25';

    let currentValueBalance = Decimal(valueBalance);
    let previousValueBalance = currentValueBalance;

    const wethBalance = '3';
    const wethDenorm = '10';

    let currentWethBalance = Decimal(wethBalance);
    let previousWethBalance = currentWethBalance;

    const daiBalance = '1500';
    const daiDenorm = '15';

    let currentDaiBalance = Decimal(daiBalance);
    let previousDaiBalance = currentDaiBalance;

    let currentPoolBalance = Decimal(0);
    let previousPoolBalance = Decimal(0);

    const sumWeights = Decimal(valueDenorm).add(Decimal(wethDenorm)).add(Decimal(daiDenorm));
    const valueNorm = Decimal(valueDenorm).div(Decimal(sumWeights));
    const wethNorm = Decimal(wethDenorm).div(Decimal(sumWeights));
    const daiNorm = Decimal(daiDenorm).div(Decimal(sumWeights));

    async function logAndAssertCurrentBalances() {
        let expected = currentPoolBalance;
        let actual = await pool.totalSupply();
        actual = Decimal(fromWei(actual));
        let relDif = calcRelativeDiff(expected, actual);
        if (verbose) {
            console.log('Pool Balance');
            console.log(`expected: ${expected})`);
            console.log(`actual  : ${actual})`);
            console.log(`relDif  : ${relDif})`);
        }

        assert.isAtMost(relDif.toNumber(), errorDelta);

        expected = currentValueBalance;
        actual = await pool.getBalance(VALUE);
        actual = Decimal(fromWei(actual));
        relDif = calcRelativeDiff(expected, actual);
        if (verbose) {
            console.log('VALUE Balance');
            console.log(`expected: ${expected})`);
            console.log(`actual  : ${actual})`);
            console.log(`relDif  : ${relDif})`);
        }

        expected = currentWethBalance;
        actual = await pool.getBalance(WETH);
        actual = Decimal(fromWei(actual));
        relDif = calcRelativeDiff(expected, actual);
        if (verbose) {
            console.log('WETH Balance');
            console.log(`expected: ${expected})`);
            console.log(`actual  : ${actual})`);
            console.log(`relDif  : ${relDif})`);
        }

        assert.isAtMost(relDif.toNumber(), errorDelta);

        expected = currentDaiBalance;
        actual = await pool.getBalance(DAI);
        actual = Decimal(fromWei(actual));
        relDif = calcRelativeDiff(expected, actual);
        if (verbose) {
            console.log('Dai Balance');
            console.log(`expected: ${expected})`);
            console.log(`actual  : ${actual})`);
            console.log(`relDif  : ${relDif})`);
        }

        assert.isAtMost(relDif.toNumber(), errorDelta);
    }

    before(async () => {
        factory = await BFactory.deployed();
        factory.setCollectedFund(carol);
        factory.setDefaultExitFee(toWei(String(exitFee)));

        poolCreator = await FaaSPoolCreator.deployed();
        factory.setBpoolCreator(poolCreator.address);

        POOL = await factory.newBPool.call(); // this works fine in clean room
        await factory.newBPool();
        pool = await FaaSPool.at(POOL);

        value = await TToken.new('Value Liquidity', 'VALUE', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        VALUE = value.address;
        WETH = weth.address;
        DAI = dai.address;

        await value.mint(admin, MAX);
        await weth.mint(admin, MAX);
        await dai.mint(admin, MAX);

        await value.transfer(bob, INIT_BALANCE);
        await weth.transfer(bob, INIT_BALANCE);
        await dai.transfer(bob, INIT_BALANCE);

        await value.approve(POOL, MAX);
        await weth.approve(POOL, MAX);
        await dai.approve(POOL, MAX);

        await value.approve(POOL, MAX, {from: bob});
        await weth.approve(POOL, MAX, {from: bob});
        await dai.approve(POOL, MAX, {from: bob});

        await pool.bind(VALUE, toWei(valueBalance), toWei(valueDenorm));
        await pool.bind(WETH, toWei(wethBalance), toWei(wethDenorm));
        await pool.bind(DAI, toWei(daiBalance), toWei(daiDenorm));

        await pool.setPublicSwap(true);
        await pool.setSwapFee(toWei(String(swapFee)));
        await factory.setCollectedToken(value.address);
        await factory.setPoolCollectedFee(pool.address, toWei(String(collectedFee)));
        // await factory.setPoolCollectedFee(pool.address, '0');
    });

    async function printBalances() {
        console.log('pool VALUE:    ', fromWei(await value.balanceOf(pool.address)));
        console.log('pool WETH:     ', fromWei(await weth.balanceOf(pool.address)));
        console.log('pool DAI:      ', fromWei(await dai.balanceOf(pool.address)));
        console.log('pool VLP:      ', fromWei(await pool.balanceOf(pool.address)));
        console.log('pool Supply:   ', fromWei(await pool.totalSupply()));
        console.log('-------------------');
        console.log('bob VALUE:     ', fromWei(await value.balanceOf(bob)));
        console.log('bob WETH:      ', fromWei(await weth.balanceOf(bob)));
        console.log('bob DAI:       ', fromWei(await dai.balanceOf(bob)));
        console.log('bob VLP:       ', fromWei(await pool.balanceOf(bob)));
        console.log('-------------------');
        console.log('carol VALUE:   ', fromWei(await value.balanceOf(carol)));
        console.log('carol WETH:    ', fromWei(await weth.balanceOf(carol)));
        console.log('carol DAI:     ', fromWei(await dai.balanceOf(carol)));
        console.log('carol VLP:     ', fromWei(await pool.balanceOf(carol)));
    }

    describe('With fees', () => {
        it('swapExactAmountIn', async () => {
            await pool.finalize();

            const tokenIn = WETH;
            const tokenAmountIn = '1';
            const tokenOut = VALUE;
            const minAmountOut = '0';
            const maxPrice = MAX;

            if (verbose) {
                console.log('=== BEFORE swapExactAmountIn ===');
                await printBalances();
            }

            const output = await pool.swapExactAmountIn.call(
                tokenIn,
                toWei(tokenAmountIn),
                tokenOut,
                toWei(minAmountOut),
                maxPrice,
                {from: bob}
            );

            await pool.swapExactAmountIn(
                tokenIn,
                toWei(tokenAmountIn),
                tokenOut,
                toWei(minAmountOut),
                maxPrice,
                {from: bob}
            );

            console.log('tokenIn = ', tokenIn);
            console.log('tokenAmountIn = ', tokenAmountIn);

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);

            if (verbose) {
                console.log('=== AFTER swapExactAmountIn ===');
                await printBalances();
            }

            // Checking outputs
            let expected = calcOutGivenIn(
                currentWethBalance,
                wethNorm,
                currentDaiBalance,
                daiNorm,
                tokenAmountIn,
                swapFee,
            );

            let actual = Decimal(fromWei(output[0]));
            let relDif = calcRelativeDiff(expected, actual);

            if (verbose) {
                console.log('output[0]');
                console.log(`expected: ${expected}`);
                console.log(`actual  : ${actual}`);
                console.log(`relDif  : ${relDif}`);
            }

            expected = calcSpotPrice(
                currentWethBalance.plus(Decimal(2)),
                wethNorm,
                currentDaiBalance.sub(actual),
                daiNorm,
                swapFee,
            );
            // expected = 1 / ((1 - swapFee) * (4 + 2)) / (48 / (4 + 2 * (1 - swapFee)));
            // expected = ((1 / (1 - swapFee)) * (4 + 2)) / (48 / (4 + 2 * (1 - swapFee)));
            actual = fromWei(output[1]);
            relDif = calcRelativeDiff(expected, actual);

            if (verbose) {
                console.log('output[1]');
                console.log(`expected: ${expected}`);
                console.log(`actual  : ${actual}`);
                console.log(`relDif  : ${relDif}`);
            }
        });

        it('swapExactAmountOut', async () => {
            const tokenIn = DAI;
            const maxAmountIn = MAX;
            const tokenOut = WETH;
            const tokenAmountOut = '1';
            const maxPrice = MAX;

            if (verbose) {
                console.log('=== BEFORE swapExactAmountOut ===');
                await printBalances();
            }

            await pool.swapExactAmountOut(
                tokenIn,
                maxAmountIn,
                tokenOut,
                toWei(tokenAmountOut),
                maxPrice,
                {from: bob}
            );

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);

            if (verbose) {
                console.log('=== AFTER swapExactAmountOut ===');
                await printBalances();
            }
        });

        it('swapExactAmountOut', async () => {
            const tokenIn = DAI;
            const maxAmountIn = MAX;
            const tokenOut = WETH;
            const tokenAmountOut = '1';
            const maxPrice = MAX;

            if (verbose) {
                console.log('=== BEFORE swapExactAmountOut ===');
                await printBalances();
            }

            await pool.swapExactAmountOut(
                tokenIn,
                maxAmountIn,
                tokenOut,
                toWei(tokenAmountOut),
                maxPrice,
                {from: bob}
            );

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);

            if (verbose) {
                console.log('=== AFTER swapExactAmountOut ===');
                await printBalances();
            }
        });

        it('joinswapExternAmountIn', async () => {
            if (verbose) {
                console.log('=== BEFORE joinswapExternAmountIn ===');
                await printBalances();
            }

            await pool.joinswapExternAmountIn(WETH, toWei('1'), toWei('0'), {from: bob});

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);
            await factory.collect(pool.address);

            if (verbose) {
                console.log('=== AFTER joinswapExternAmountIn ===');
                await printBalances();
            }
        });

        it('joinswapPoolAmountOut', async () => {
            if (verbose) {
                console.log('=== BEFORE joinswapPoolAmountOut ===');
                await printBalances();
            }

            await pool.joinswapPoolAmountOut(DAI, toWei('1'), MAX, {from: bob});

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);
            await factory.collect(pool.address);

            if (verbose) {
                console.log('=== AFTER joinswapPoolAmountOut ===');
                await printBalances();
            }
        });

        it('exitswapPoolAmountIn', async () => {
            if (verbose) {
                console.log('=== BEFORE exitswapPoolAmountIn ===');
                await printBalances();
            }

            await pool.exitswapPoolAmountIn(WETH, toWei('1'), toWei('0'), {from: bob});

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);
            await factory.collect(pool.address);

            if (verbose) {
                console.log('=== AFTER exitswapPoolAmountIn ===');
                await printBalances();
            }
        });

        it('exitswapExternAmountOut', async () => {
            if (verbose) {
                console.log('=== BEFORE exitswapExternAmountOut ===');
                await printBalances();
            }

            await pool.exitswapExternAmountOut(DAI, toWei('10'), toWei('8'), {from: bob});

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);
            await factory.collect(pool.address);

            if (verbose) {
                console.log('=== AFTER exitswapExternAmountOut ===');
                await printBalances();
            }
        });

        it('exitMaxPool', async () => {
            if (verbose) {
                console.log('=== BEFORE exitMaxPool ===');
                await printBalances();
            }

            const pAi = await pool.balanceOf(bob);
            await pool.exitPool(pAi, [toWei('0'), toWei('0'), toWei('0')], {from: bob});

            await factory.collect(VALUE);
            await factory.collect(WETH);
            await factory.collect(DAI);
            await factory.collect(pool.address);

            if (verbose) {
                console.log('=== AFTER exitMaxPool ===');
                await printBalances();
            }
        });
    });
});
