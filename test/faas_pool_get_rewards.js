const {expectRevert, time} = require('@openzeppelin/test-helpers');

const FaaSPoolLite = artifacts.require('FaaSPoolLite');
const FaaSPoolCreatorLite = artifacts.require('FaaSPoolCreatorLite');
const FaaSRewardFund = artifacts.require('FaaSRewardFund');
const BFactory = artifacts.require('BFactory');
const TToken = artifacts.require('TToken');

const swapFee = 0.003; // 0.3%;
const collectedFee = 0.0005; // 0.05%;
const exitFee = 0;
const verbose = process.env.VERBOSE;

async function advanceBlocks(nums) {
    for (let i = 0; i < nums; i++) await time.advanceBlock();
}

contract('faas_pool_lock_rewards', async (accounts) => {
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
    let factory; // FaaSPoolLite factory
    let poolCreator;
    let pool; // first pool w/ defaults
    let POOL; //   pool address

    let rewardFund;

    const wethBalance = '3';
    const wethDenorm = '25';

    const daiBalance = '1500';
    const daiDenorm = '25';
    const swapFee = '0.003';
    const initPoolSupply = '100';
    before(async () => {
        factory = await BFactory.deployed();
        factory.setCollectedFund(carol);
        factory.setDefaultExitFee(toWei(String(exitFee)));

        poolCreator = await FaaSPoolCreatorLite.deployed();
        factory.setBpoolCreator(poolCreator.address);

        POOL = await factory.newBPool.call(); // this works fine in clean room
        await factory.newBPool();
        pool = await FaaSPoolLite.at(POOL);

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

        // await pool.setPublicSwap(true);
        // await pool.setSwapFee(toWei(String(swapFee)));
        await factory.setCollectedToken(value.address);
        await factory.setPoolCollectedFee(pool.address, toWei(String(collectedFee)));

        await weth.transfer(POOL, toWei(wethBalance));
        await dai.transfer(POOL, toWei(daiBalance));
        await pool.finalize(toWei(swapFee), toWei(initPoolSupply), [WETH, DAI], [toWei(wethDenorm), toWei(daiDenorm)]);
        console.log("finalize done");
        // await pool.bind(WETH, toWei(wethBalance), toWei(wethDenorm));
        // await pool.bind(WETH, toWei(wethBalance), toWei(wethDenorm));
        // await pool.bind(DAI, toWei(daiBalance), toWei(daiDenorm));

        rewardFund = await FaaSRewardFund.new(POOL);
        await value.transfer(rewardFund.address, INIT_BALANCE);
        await vusd.transfer(rewardFund.address, '1000000000000');

        await pool.setRewardFund(rewardFund.address);
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
        console.log('-------------------');
        console.log('carol VALUE:        ', fromWei(await value.balanceOf(carol)));
        console.log('carol vUSD:         ', Number.parseFloat(await vusd.balanceOf(carol)) / 1e9);
        console.log('carol WETH:         ', fromWei(await weth.balanceOf(carol)));
        console.log('carol DAI:          ', fromWei(await dai.balanceOf(carol)));
        console.log('carol VLP:          ', fromWei(await pool.balanceOf(carol)));
    }

    async function printRewardPoolInfo(pid) {
        const rewardPool = await pool.rewardPoolInfo(pid);
        const rewardToken = await TToken.at(rewardPool.rewardToken);
        console.log('rewardPool[%d]:   ', pid, JSON.stringify(rewardPool));
        console.log('rewardPool[%d] rewardToken:       ', pid, String(await rewardToken.name()));
        console.log('rewardPool[%d] lastRewardBlock:   ', pid, String(rewardPool.lastRewardBlock));
        console.log('rewardPool[%d] endRewardBlock:    ', pid, String(rewardPool.endRewardBlock));
        console.log('rewardPool[%d] rewardPerBlock:    ', pid, fromWei(rewardPool.rewardPerBlock));
        console.log('rewardPool[%d] accRewardPerShare: ', pid, String(rewardPool.accRewardPerShare));
        console.log('rewardPool[%d] lockRewardPercent: ', pid, String(rewardPool.lockRewardPercent));
        console.log('rewardPool[%d] startVestingBlock: ', pid, String(rewardPool.startVestingBlock));
        console.log('rewardPool[%d] endVestingBlock:   ', pid, String(rewardPool.endVestingBlock));
        console.log('rewardPool[%d] numOfVestingBlocks:', pid, String(rewardPool.numOfVestingBlocks));
        console.log('rewardPool[%d] totalPaidRewards:  ', pid, String(rewardPool.totalPaidRewards));
        console.log('rewardPool[%d] totalLockedRewards:', pid, String(rewardPool.totalLockedRewards));
    }

    async function printStakeInfo(name, account, pid) {
        console.log('%s UserInfo:      ', name, JSON.stringify(await pool.getUserInfo(pid, account)));
        console.log('%s pendingReward[%d]: %s', name, pid, String(await pool.pendingReward(pid, account)));
    }

    describe('RewardPool with getAllRewards', () => {
        it('_endRewardBlock < _startVestingBlock', async () => {
            const currBlk = Number.parseInt(await time.latestBlock());
            // function addRewardPool(IERC20 _rewardToken, uint256 _startBlock, uint256 _endRewardBlock, uint256 _rewardPerBlock,
            //         uint256 _lockRewardPercent, uint256 _startVestingBlock, uint256 _endVestingBlock) public onlyController {
            const _rewardToken = VALUE;
            const _startBlock = currBlk + 20;
            const _endRewardBlock = currBlk + 120;
            const _rewardPerBlock = toWei('1');
            const _lockRewardPercent = 0;
            const _startVestingBlock = 0;
            const _endVestingBlock = 1;
            await pool.addRewardPool(_rewardToken, _startBlock, _endRewardBlock, _rewardPerBlock, _lockRewardPercent, _startVestingBlock, _endVestingBlock);

            if (verbose) {
                console.log('\n=== BEFORE joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }

            await pool.joinPool(toWei('10'), [MAX, MAX], {from: bob});

            await pool.setExchangeProxy(bob);
            await pool.joinPoolFor(carol, toWei('10'), [MAX, MAX], {from: bob});
            await advanceBlocks(10);

            if (verbose) {
                console.log('\n=== AFTER joinPool: Block: %s ===', await time.latestBlock());
                await printBalances();
                await printRewardPoolInfo(0);
                await printStakeInfo('bob', bob, 0);
            }

            console.log('\n=== BEFORE getAllRewards: Block: %s ===', await time.latestBlock());
            console.log('carol VALUE:        ', fromWei(await value.balanceOf(carol)));
            await printStakeInfo('carol', carol, 0);

            await advanceBlocks(10);

            for (let i = 0; i < 50; i++) {
                await advanceBlocks(2);
                console.log('\n=== getAllRewards: Block: %s ===', await time.latestBlock());
                console.log('%s pendingReward[%d]: %s', 'carol', 0, String(await pool.pendingReward(0, carol)));
                await pool.getAllRewards({from: carol});
                console.log('carol VALUE:        ', fromWei(await value.balanceOf(carol)));
                await printStakeInfo('carol', carol, 0);
            }
        });
    });
});
