const {expectRevert, time} = require('@openzeppelin/test-helpers');

const Decimal = require('decimal.js');
const {
    calcSpotPrice,
    calcOutGivenIn,
    calcInGivenOut,
    calcRelativeDiff,
} = require('../lib/calc_comparisons');

const FaaSPool = artifacts.require('FaaSPool');
const FaaSPoolCreator = artifacts.require('FaaSPoolCreator');
const FaaSRewardFund = artifacts.require('FaaSRewardFund');
const BFactory = artifacts.require('BFactory');
const TToken = artifacts.require('TToken');
const errorDelta = 10 ** -3;
const swapFee = 0.003; // 0.3%;
const collectedFee = 0.0005; // 0.05%;
const exitFee = 0;
const verbose = process.env.VERBOSE;

contract('faas_pool_rewards', async (accounts) => {
    const {toWei} = web3.utils;
    const {fromWei} = web3.utils;
    const admin = accounts[0];
    const bob = accounts[1];
    const carol = accounts[2];

    const MAX = web3.utils.toTwosComplement(-1);
    const INIT_BALANCE = toWei('1000');

    let VALUE;
    let WETH;
    let DAI; // addresses
    let value;
    let weth;
    let dai; // TTokens
    let factory; // FaaSPool factory
    let poolCreator;
    let pool; // first pool w/ defaults
    let POOL; //   pool address

    let rewardFund;

    const wethBalance = '3';
    const wethDenorm = '20';

    const daiBalance = '1500';
    const daiDenorm = '30';

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

        await pool.bind(WETH, toWei(wethBalance), toWei(wethDenorm));
        await pool.bind(DAI, toWei(daiBalance), toWei(daiDenorm));

        await pool.setPublicSwap(true);
        await pool.setSwapFee(toWei(String(swapFee)));
        await factory.setCollectedToken(value.address);
        await factory.setPoolCollectedFee(pool.address, toWei(String(collectedFee)));

        await pool.finalize();

        rewardFund = await FaaSRewardFund.new(POOL);
        await value.transfer(rewardFund.address, INIT_BALANCE);

        await pool.setRewardFund(rewardFund.address);

        // function addRewardPool(IERC20 _rewardToken, uint256 _startBlock, uint256 _endRewardBlock, uint256 _rewardPerBlock) public onlyController {
        await pool.addRewardPool(VALUE, 0, 1000, toWei('1'));
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

    async function printRewardPoolInfo(pid) {
        const rewardPool = await pool.rewardPoolInfo(pid);
        console.log('rewardPool:      ', JSON.stringify(rewardPool));
    }

    async function printStakeInfo(name, account, pid) {
        const user = await pool.userInfo(account);
        console.log('%s UserInfo:      ', name, JSON.stringify(user));
        console.log('%s amount:        ', name, fromWei(user.amount));
        console.log('%s pendingReward: ', name, fromWei(await pool.pendingReward(pid, account)));
    }

    describe('Rewards', () => {
        it('joinPool', async () => {
            if (verbose) {
                console.log('=== BEFORE joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }

            await pool.joinPool(toWei('10'), [MAX, MAX], {from: bob});

            await factory.collect(WETH);
            await factory.collect(DAI);
            await factory.collect(pool.address);

            if (verbose) {
                console.log('=== AFTER joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }
        });

        it('exitPool', async () => {
            if (verbose) {
                console.log('=== BEFORE exitPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }

            await pool.exitPool(toWei('10'), [toWei('0'), toWei('0')], {from: bob});

            await factory.collect(WETH);
            await factory.collect(DAI);
            await factory.collect(pool.address);

            if (verbose) {
                console.log('=== AFTER exitPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }
        });
    });
});
