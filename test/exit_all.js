const Decimal = require('decimal.js');
const {
    calcSpotPrice,
    calcOutGivenIn,
    calcInGivenOut,
    calcRelativeDiff,
} = require('../lib/calc_comparisons');

const BPool = artifacts.require('BPool');
const BPoolCreator = artifacts.require('BPoolCreator');
const BFactory = artifacts.require('BFactory');
const TToken = artifacts.require('TToken');
const errorDelta = 10 ** -8;
const swapFee = 0.003; // 0.3%;
const exitFee = 0;
const verbose = process.env.VERBOSE;

contract('exit_all', async (accounts) => {
    const { toWei } = web3.utils;
    const { fromWei } = web3.utils;
    const admin = accounts[0];
    const bob = accounts[1];
    const carol = accounts[2];

    const MAX = web3.utils.toTwosComplement(-1);
    const INIT_BALANCE = toWei('1000');

    let WETH; let DAI; // addresses
    let weth; let dai; // TTokens
    let factory; // BPool factory
    let pool; // first pool w/ defaults
    let POOL; //   pool address

    const wethBalance = '102';
    const wethDenorm = '45';

    let currentWethBalance = Decimal(wethBalance);
    let previousWethBalance = currentWethBalance;

    const daiBalance = '487';
    const daiDenorm = '5';

    let currentDaiBalance = Decimal(daiBalance);
    let previousDaiBalance = currentDaiBalance;

    let currentPoolBalance = Decimal(0);
    let previousPoolBalance = Decimal(0);

    const sumWeights = Decimal(wethDenorm).add(Decimal(daiDenorm));
    const wethNorm = Decimal(wethDenorm).div(Decimal(sumWeights));
    const daiNorm = Decimal(daiDenorm).div(Decimal(sumWeights));

    before(async () => {
        factory = await BFactory.deployed();
        factory.setCollectedFund(carol);
        await factory.setDefaultExitFee(toWei(String(exitFee)));
        const poolCreator = await BPoolCreator.deployed();
        factory.setBpoolCreator(poolCreator.address);
        POOL = await factory.newBPool.call(); // this works fine in clean room
        await factory.newBPool();
        pool = await BPool.at(POOL);
        // await pool.setInitPoolSupply(toWei('0.01'));

        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        WETH = weth.address;
        DAI = dai.address;

        await weth.mint(admin, MAX);
        await dai.mint(admin, MAX);

        await weth.transfer(bob, INIT_BALANCE);
        await dai.transfer(bob, INIT_BALANCE);

        await weth.approve(POOL, MAX);
        await dai.approve(POOL, MAX);

        await weth.approve(POOL, MAX, {from: bob});
        await dai.approve(POOL, MAX, {from: bob});

        await pool.bind(WETH, toWei(wethBalance), toWei(wethDenorm));
        await pool.bind(DAI, toWei(daiBalance), toWei(daiDenorm));

        await pool.setPublicSwap(true);
        await pool.setSwapFee(toWei(String(swapFee)));
    });

    describe('With fees', () => {
        it('exitPool', async () => {
            // await pool.setInitPoolSupply();
            await pool.finalize();

            const tokenIn = WETH;
            const tokenAmountIn = '1';
            const tokenOut = DAI;
            const minAmountOut = '0';
            const maxPrice = MAX;

            await pool.swapExactAmountIn(WETH, toWei('1'), DAI, '0', MAX, {from: bob});
            await pool.swapExactAmountIn(DAI, toWei('100'), WETH, '0', MAX, {from: bob});
            await pool.joinswapExternAmountIn(WETH, toWei('1'), toWei('0'));
            await pool.joinswapExternAmountIn(DAI, toWei('100'), toWei('0'));
            await pool.joinswapPoolAmountOut(WETH, toWei('1'), MAX);
            await pool.joinswapPoolAmountOut(DAI, toWei('1'), MAX);
            await pool.exitswapPoolAmountIn(WETH, toWei('1'), toWei('0'));
            await pool.exitswapExternAmountOut(DAI, toWei('1'), toWei('8'));

            // Call function
            // so that the balances of all tokens will go back exactly to what they were before joinPool()
            // const pAi = 1 / (1 - exitFee);
            const pAi = await pool.balanceOf(admin);
            const pAiAfterExitFee = pAi * (1 - exitFee);

            if (verbose) {
                console.log('pool.initPoolSupply:', String(await pool.initPoolSupply()));
                console.log('pool.totalSupply:', String(await pool.totalSupply()));
                console.log('exitFee:         ', exitFee);
                console.log('pAi:             ', String(pAi));
                console.log('pAiAfterExitFee: ', String(pAiAfterExitFee));
            }

            if (verbose) {
                console.log('=== BEFORE EXIT ===');
                console.log('pool WETH:    ', fromWei(await weth.balanceOf(pool.address)));
                console.log('pool DAI:     ', fromWei(await dai.balanceOf(pool.address)));
                console.log('factory WETH: ', fromWei(await weth.balanceOf(factory.address)));
                console.log('factory DAI:  ', fromWei(await dai.balanceOf(factory.address)));
                console.log('factory VLP:  ', fromWei(await pool.balanceOf(factory.address)));
                // console.log('bob WETH:    ', fromWei(await weth.balanceOf(bob)));
                // console.log('bob DAI:     ', fromWei(await dai.balanceOf(bob)));
                console.log('bob VLP:      ', fromWei(await pool.balanceOf(bob)));
                console.log('pool totalSupply(VLP): ', fromWei(await pool.totalSupply()));
            }

            // await pool.exitPool(toWei(String(pAi)), [toWei('0'), toWei('0')]);
            // await pool.exitPool(toWei('110726650834836647849'), [toWei('0'), toWei('0')]);
            console.log('pool.balanceOf(admin) = ', String(await pool.balanceOf(admin)));
            await pool.exitPool(pAi, [toWei('0'), toWei('0')]);
            //     uint public log_balance_msg_sender;
            //     uint public log_pool_amount_in;
            if (pool.log_balance_msg_sender) console.log('log_balance_msg_sender = ', await pool.log_balance_msg_sender());
            if (pool.log_pool_amount_in) console.log('log_pool_amount_in = ', await pool.log_pool_amount_in());
            await factory.collect(pool.address, {from: bob});

            if (verbose) {
                console.log('=== AFTER EXIT ===');
                console.log('pool WETH:    ', fromWei(await weth.balanceOf(pool.address)));
                console.log('pool DAI:     ', fromWei(await dai.balanceOf(pool.address)));
                console.log('factory WETH: ', fromWei(await weth.balanceOf(factory.address)));
                console.log('factory DAI:  ', fromWei(await dai.balanceOf(factory.address)));
                console.log('factory VLP:  ', fromWei(await pool.balanceOf(factory.address)));
                // console.log('bob WETH:    ', fromWei(await weth.balanceOf(bob)));
                // console.log('bob DAI:     ', fromWei(await dai.balanceOf(bob)));
                console.log('bob VLP:      ', fromWei(await pool.balanceOf(bob)));
                console.log('pool totalSupply(VLP): ', fromWei(await pool.totalSupply()));
            }

            // Update balance states
            previousPoolBalance = currentPoolBalance;
            currentPoolBalance = currentPoolBalance.sub(Decimal(pAiAfterExitFee));
            // Balances of all tokens increase proportionally to the pool balance
            previousWethBalance = currentWethBalance;
            let balanceChange = (Decimal(pAiAfterExitFee).div(previousPoolBalance)).mul(previousWethBalance);
            currentWethBalance = currentWethBalance.sub(balanceChange);
            previousDaiBalance = currentDaiBalance;
            balanceChange = (Decimal(pAiAfterExitFee).div(previousPoolBalance)).mul(previousDaiBalance);
            currentDaiBalance = currentDaiBalance.sub(balanceChange);
        });
    });
});
