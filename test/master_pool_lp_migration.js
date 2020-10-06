const LegacyBPool = artifacts.require('LegacyBPool');
const LegacyBFactory = artifacts.require('LegacyBFactory');

const BPool = artifacts.require('BPool');
const BPoolCreator = artifacts.require('BPoolCreator');
const BFactory = artifacts.require('BFactory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const TToken = artifacts.require('TToken');
const ValueLiquidMigrator = artifacts.require('ValueLiquidMigrator');

const ValueLiquidityToken = artifacts.require('ValueLiquidityToken');
const ValueMasterPool = artifacts.require('ValueMasterPool');

const verbose = process.env.VERBOSE;

contract('master_pool_lp_migration', async (accounts) => {
    const admin = accounts[0];
    const nonAdmin = accounts[1];
    const insuranceFund = accounts[2];
    const {toWei} = web3.utils;
    const {fromWei} = web3.utils;
    const MAX = web3.utils.toTwosComplement(-1);

    let WETH, DAI, YFV, VALUE;
    let weth, dai, yfv, value;
    let factory; // BPool factory
    let pool; // first pool w/ defaults
    let NEW_POOL; // pool address

    let legacy_factory;
    let legacy_pool;
    let LEGACY_POOL;

    before(async () => {
        legacy_factory = await LegacyBFactory.new();
        LEGACY_POOL = await legacy_factory.newBPool.call(); // this works fine in clean room
        await legacy_factory.newBPool();
        legacy_pool = await LegacyBPool.at(LEGACY_POOL);

        factory = await BFactory.deployed();
        const poolCreator = await BPoolCreator.deployed();
        factory.setBpoolCreator(poolCreator.address);

        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        WETH = weth.address;
        DAI = dai.address;

        // admin balances
        await weth.mint(admin, toWei('100'));
        await dai.mint(admin, toWei('40000'));

        await weth.approve(LEGACY_POOL, MAX);
        await dai.approve(LEGACY_POOL, MAX);

        yfv = await TToken.new('YFValue', 'YFV', 18);
        await yfv.mint(admin, toWei('1000000'));
        value = await ValueLiquidityToken.new(yfv.address, toWei('2370000'), {from: admin});

        YFV = yfv.address;
        VALUE = value.address;
    });

    it('migration with master pool from legacy balancer pool -> value liquid', async () => {
        await weth.mint(nonAdmin, toWei('100'), {from: admin});
        await dai.mint(nonAdmin, toWei('40000'), {from: admin});
        await yfv.mint(nonAdmin, toWei('50'), {from: admin});

        LEGACY_POOL = await legacy_factory.newBPool.call({from: nonAdmin}); // this works fine in clean room
        await legacy_factory.newBPool({from: nonAdmin});
        legacy_pool = await LegacyBPool.at(LEGACY_POOL);

        await weth.approve(LEGACY_POOL, MAX);
        await dai.approve(LEGACY_POOL, MAX);
        await yfv.approve(LEGACY_POOL, MAX);

        await weth.approve(LEGACY_POOL, MAX, {from: nonAdmin});
        await dai.approve(LEGACY_POOL, MAX, {from: nonAdmin});
        await yfv.approve(LEGACY_POOL, MAX, {from: nonAdmin});

        await legacy_pool.bind(WETH, toWei('100'), toWei('24.5'), {from: nonAdmin});
        await legacy_pool.bind(DAI, toWei('40000'), toWei('24.5'), {from: nonAdmin});
        await legacy_pool.bind(YFV, toWei('50'), toWei('1'), {from: nonAdmin});
        await legacy_pool.setSwapFee(toWei('0.02'), {from: nonAdmin});
        await legacy_pool.finalize({from: nonAdmin});

        await legacy_pool.joinPool(toWei('10'), [MAX, MAX, MAX]);
        await legacy_pool.swapExactAmountIn(WETH, toWei('0.1'), YFV, '0', MAX, {from: admin});
        await legacy_pool.exitPool(toWei('20'), [toWei('0'), toWei('0'), toWei('0')], {from: nonAdmin});

        const aliceLpBal = String(await legacy_pool.balanceOf(admin));
        const bobLpBal = String(await legacy_pool.balanceOf(nonAdmin));

        // constructor(ValueLiquidityToken _value, address _insuranceFundAddr, uint256 _valuePerBlock, uint256 _startBlock)
        const masterPool = await ValueMasterPool.new(VALUE, insuranceFund, toWei('1'), '0');
        await value.addMinter(masterPool.address);
        await masterPool.add('100', LEGACY_POOL, true, 10);

        await legacy_pool.approve(masterPool.address, bobLpBal, {from: nonAdmin});
        await masterPool.deposit(0, bobLpBal, admin, {from: nonAdmin});

        const newFactory = await BFactory.new();
        newFactory.setBpoolCreator((await BPoolCreator.deployed()).address);
        const migrator = await ValueLiquidMigrator.new(newFactory.address, YFV, VALUE);
        const MIGRATOR = migrator.address;

        await masterPool.setMigrator(MIGRATOR);
        await masterPool.withdraw(0, toWei('40'), {from: nonAdmin});

        if (verbose) {
            console.log('===== BEFORE MIGRATION');
            console.log('masterPool legacy_pool bal   = ', fromWei(await legacy_pool.balanceOf(masterPool.address)));
            console.log('bob WETH  = ', fromWei(await weth.balanceOf(nonAdmin)));
            console.log('bob DAI   = ', fromWei(await dai.balanceOf(nonAdmin)));
            console.log('bob YFV   = ', fromWei(await yfv.balanceOf(nonAdmin)));
            console.log('bob VALUE = ', fromWei(await value.balanceOf(nonAdmin)));
        }

        await masterPool.migrate(0);
        const poolInfo = await masterPool.poolInfo(0);
        if (verbose) console.log('poolInfo: ', JSON.stringify(poolInfo));
        NEW_POOL = poolInfo.lpToken;
        if (verbose) console.log('NEW_POOL address: ', NEW_POOL);
        const newPool = await BPool.at(NEW_POOL);

        if (verbose) {
            console.log('===== AFTER MIGRATION & BEFORE WITHDRAW and EXIT POOL');
            console.log('masterPool legacy_pool bal   = ', fromWei(await legacy_pool.balanceOf(masterPool.address)));
            console.log('masterPool new_pool bal      = ', fromWei(await newPool.balanceOf(masterPool.address)));
            console.log('bob WETH  = ', fromWei(await weth.balanceOf(nonAdmin)));
            console.log('bob DAI   = ', fromWei(await dai.balanceOf(nonAdmin)));
            console.log('bob YFV   = ', fromWei(await yfv.balanceOf(nonAdmin)));
            console.log('bob VALUE = ', fromWei(await value.balanceOf(nonAdmin)));
        }

        await masterPool.withdraw(0, toWei('40'), {from: nonAdmin});
        await newPool.exitPool(toWei('40'), [toWei('0'), toWei('0'), toWei('0')], {from: nonAdmin});
        await legacy_pool.exitPool(toWei('40'), [toWei('0'), toWei('0'), toWei('0')], {from: nonAdmin});

        if (verbose) {
            console.log('===== AFTER WITHDRAW and EXIT POOL');
            console.log('masterPool legacy_pool bal   = ', fromWei(await legacy_pool.balanceOf(masterPool.address)));
            console.log('masterPool new_pool bal      = ', fromWei(await newPool.balanceOf(masterPool.address)));
            console.log('bob WETH  = ', fromWei(await weth.balanceOf(nonAdmin)));
            console.log('bob DAI   = ', fromWei(await dai.balanceOf(nonAdmin)));
            console.log('bob YFV   = ', fromWei(await yfv.balanceOf(nonAdmin)));
            console.log('bob VALUE = ', fromWei(await value.balanceOf(nonAdmin)));
        }
    })
});
