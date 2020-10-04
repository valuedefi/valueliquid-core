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
const swapFee = 10 ** -3; // 0.001;
const exitFee = 0.0001;
const verbose = process.env.VERBOSE;

contract('exit_with_fees', async (accounts) => {
    const { toWei } = web3.utils;
    const { fromWei } = web3.utils;
    const admin = accounts[0];
    const blab = accounts[1];

    const MAX = web3.utils.toTwosComplement(-1);

    let WETH; let DAI; // addresses
    let weth; let dai; // TTokens
    let factory; // BPool factory
    let pool; // first pool w/ defaults
    let POOL; //   pool address

    const wethBalance = '4';
    const wethDenorm = '10';

    let currentWethBalance = Decimal(wethBalance);
    let previousWethBalance = currentWethBalance;

    const daiBalance = '12';
    const daiDenorm = '10';

    let currentDaiBalance = Decimal(daiBalance);
    let previousDaiBalance = currentDaiBalance;

    let currentPoolBalance = Decimal(0);
    let previousPoolBalance = Decimal(0);

    const sumWeights = Decimal(wethDenorm).add(Decimal(daiDenorm));
    const wethNorm = Decimal(wethDenorm).div(Decimal(sumWeights));
    const daiNorm = Decimal(daiDenorm).div(Decimal(sumWeights));

    before(async () => {
        factory = await BFactory.deployed();
        factory.setCollectedFund(blab);
        await factory.setDefaultExitFee(toWei(String(exitFee)));
        const poolCreator = await BPoolCreator.deployed();
        factory.setBpoolCreator(poolCreator.address);
        POOL = await factory.newBPool.call(); // this works fine in clean room
        await factory.newBPool();
        pool = await BPool.at(POOL);
        await pool.setInitPoolSupply(toWei('0.01'));

        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        WETH = weth.address;
        DAI = dai.address;

        await weth.mint(admin, MAX);
        await dai.mint(admin, MAX);

        await weth.approve(POOL, MAX);
        await dai.approve(POOL, MAX);

        await pool.bind(WETH, toWei(wethBalance), toWei(wethDenorm));
        await pool.bind(DAI, toWei(daiBalance), toWei(daiDenorm));

        await pool.setPublicSwap(true);
        await pool.setSwapFee(toWei(String(swapFee)));
    });

    describe('With fees', () => {


        it('exitPool', async () => {
            // await pool.setInitPoolSupply();
            await pool.finalize();
            // Call function
            // so that the balances of all tokens will go back exactly to what they were before joinPool()
            // const pAi = 1 / (1 - exitFee);
            const pAi = 0.0008;
            const pAiAfterExitFee = pAi * (1 - exitFee);

            if (verbose) {
                console.log('pool.initPoolSupply:', String(await pool.initPoolSupply()));
                console.log('exitFee:         ', exitFee);
                console.log('pAi:             ', pAi);
                console.log('pAiAfterExitFee: ', pAiAfterExitFee);
            }

            if (verbose) {
                console.log('=== BEFORE EXIT ===');
                console.log('pool WETH:    ', fromWei(await weth.balanceOf(pool.address)));
                console.log('pool DAI:     ', fromWei(await dai.balanceOf(pool.address)));
                console.log('factory WETH: ', fromWei(await weth.balanceOf(factory.address)));
                console.log('factory DAI:  ', fromWei(await dai.balanceOf(factory.address)));
                // console.log('blab WETH:    ', fromWei(await weth.balanceOf(blab)));
                // console.log('blab DAI:     ', fromWei(await dai.balanceOf(blab)));
                console.log('blab VLP:     ', fromWei(await pool.balanceOf(blab)));
            }

            await pool.exitPool(toWei(String(pAi)), [toWei('0'), toWei('0')]);
            await factory.collect(pool.address, {from: blab});

            if (verbose) {
                console.log('=== AFTER EXIT ===');
                console.log('pool WETH:    ', fromWei(await weth.balanceOf(pool.address)));
                console.log('pool DAI:     ', fromWei(await dai.balanceOf(pool.address)));
                console.log('factory WETH: ', fromWei(await weth.balanceOf(factory.address)));
                console.log('factory DAI:  ', fromWei(await dai.balanceOf(factory.address)));
                // console.log('blab WETH:    ', fromWei(await weth.balanceOf(blab)));
                // console.log('blab DAI:     ', fromWei(await dai.balanceOf(blab)));
                console.log('blab VLP:     ', fromWei(await pool.balanceOf(blab)));
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
