const {expectRevert, time} = require('@openzeppelin/test-helpers');

const FaaSPool = artifacts.require('FaaSPool');
const FaaSPoolCreator = artifacts.require('FaaSPoolCreator');
const FaaSRewardFund = artifacts.require('FaaSRewardFund');
const BFactory = artifacts.require('BFactory');
const TToken = artifacts.require('TToken');

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
    let VUSD;
    let WETH;
    let DAI; // addresses
    let value;
    let vusd;
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
        vusd = await TToken.new('Value USD', 'vUSD', 9);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        VALUE = value.address;
        VUSD = vusd.address;
        WETH = weth.address;
        DAI = dai.address;

        await value.mint(admin, MAX);
        await vusd.mint(admin, MAX);
        await weth.mint(admin, MAX);
        await dai.mint(admin, MAX);

        await value.transfer(bob, INIT_BALANCE);
        await vusd.transfer(bob, '1000000000000');
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
        await factory.setCollectedToken(value.address);
        await factory.setPoolCollectedFee(pool.address, toWei(String(collectedFee)));

        await pool.finalize();

        rewardFund = await FaaSRewardFund.new(POOL);
        await value.transfer(rewardFund.address, INIT_BALANCE);
        await vusd.transfer(rewardFund.address, '1000000000000');

        await pool.setRewardFund(rewardFund.address);

        // function addRewardPool(IERC20 _rewardToken, uint256 _startBlock, uint256 _endRewardBlock, uint256 _rewardPerBlock) public onlyController {
        const currBlk = Number.parseInt(await time.latestBlock());
        await pool.addRewardPool(VALUE, currBlk, currBlk + 10, toWei('1'));
    });

    async function printBalances() {
        console.log('pool WETH:        ', fromWei(await weth.balanceOf(pool.address)));
        console.log('pool DAI:         ', fromWei(await dai.balanceOf(pool.address)));
        console.log('pool VLP:         ', fromWei(await pool.balanceOf(pool.address)));
        console.log('pool Supply:      ', fromWei(await pool.totalSupply()));
        console.log('-------------------');
        console.log('rewardFund VALUE: ', fromWei(await value.balanceOf(rewardFund.address)));
        console.log('rewardFund vUSD:  ', Number.parseFloat(await vusd.balanceOf(rewardFund.address)) / 1e9);
        console.log('-------------------');
        console.log('bob VALUE:        ', fromWei(await value.balanceOf(bob)));
        console.log('bob vUSD:         ', Number.parseFloat(await vusd.balanceOf(bob)) / 1e9);
        console.log('bob WETH:         ', fromWei(await weth.balanceOf(bob)));
        console.log('bob DAI:          ', fromWei(await dai.balanceOf(bob)));
        console.log('bob VLP:          ', fromWei(await pool.balanceOf(bob)));
    }

    async function printRewardPoolInfo(pid) {
        const rewardPool = await pool.rewardPoolInfo(pid);
        console.log('rewardPool[%d]:   ', pid, JSON.stringify(rewardPool));
    }

    async function printStakeInfo(name, account, pid) {
        const user = await pool.userInfo(account);
        console.log('%s UserInfo:      ', name, JSON.stringify(user));
        console.log('%s amount:        ', name, fromWei(user.amount));
        console.log('%s pendingReward: ', name, fromWei(await pool.pendingReward(pid, account)));
    }

    describe('ONE RewardPool', () => {
        it('joinPool', async () => {
            if (verbose) {
                console.log('=== BEFORE joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }

            const currBlk = Number.parseInt(await time.latestBlock());
            await pool.addRewardPool(VALUE, currBlk, currBlk + 10, toWei('1'));

            for (let i = 0; i < 10; i++) await time.advanceBlock();

            await pool.joinPool(toWei('10'), [MAX, MAX], {from: bob});

            if (verbose) {
                console.log('=== AFTER joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }
        });

        return;

        it('exitPool', async () => {
            if (verbose) {
                console.log('=== BEFORE exitPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }

            for (let i = 0; i < 10; i++) await time.advanceBlock();

            await pool.exitPool(toWei('10'), [toWei('0'), toWei('0')], {from: bob});

            if (verbose) {
                console.log('=== AFTER exitPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }
        });
    });

    describe('ONE RewardPool', () => {
        it('joinPool', async () => {
            if (verbose) {
                console.log('=== BEFORE joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }

            for (let i = 0; i < 10; i++) await time.advanceBlock();

            await pool.joinPool(toWei('10'), [MAX, MAX], {from: bob});

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

            for (let i = 0; i < 10; i++) await time.advanceBlock();

            await pool.exitPool(toWei('10'), [toWei('0'), toWei('0')], {from: bob});

            if (verbose) {
                console.log('=== AFTER exitPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }
        });
    });

    describe('TWO RewardPool', () => {
        it('joinPool 100 & exitPool 50%', async () => {
            const currBlk = Number.parseInt(await time.latestBlock());
            await pool.addRewardPool(VALUE, currBlk + 10, currBlk + 20, toWei('1'));
            await pool.addRewardPool(VUSD, currBlk + 15, currBlk + 30, 1000000000);

            if (verbose) {
                console.log('=== BEFORE joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printRewardPoolInfo(1);
                await printRewardPoolInfo(2);
                await printRewardPoolInfo(3);
                await printStakeInfo('bob', bob, 1);
                await printStakeInfo('bob', bob, 2);
            }

            for (let i = 0; i < 5; i++) await time.advanceBlock();

            await pool.joinPool(toWei('10'), [MAX, MAX], {from: bob});

            if (verbose) {
                console.log('=== AFTER joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(1);
                await printRewardPoolInfo(2);
                await printStakeInfo('bob', bob, 1);
                await printStakeInfo('bob', bob, 2);
            }

            for (let i = 0; i < 10; i++) await time.advanceBlock();

            await pool.exitPool(toWei('5'), [toWei('0'), toWei('0')], {from: bob});

            if (verbose) {
                console.log('=== AFTER exitPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(1);
                await printRewardPoolInfo(2);
                await printStakeInfo('bob', bob, 1);
                await printStakeInfo('bob', bob, 2);
            }
        });
    });
});
