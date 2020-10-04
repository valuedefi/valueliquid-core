const LegacyBPool = artifacts.require('LegacyBPool');
const LegacyBFactory = artifacts.require('LegacyBFactory');

const BPool = artifacts.require('BPool');
const BPoolCreator = artifacts.require('BPoolCreator');
const BFactory = artifacts.require('BFactory');
const TToken = artifacts.require('TToken');
const ValueLiquidMigrator = artifacts.require('ValueLiquidMigrator');

const ValueLiquidityToken = artifacts.require('ValueLiquidityToken');

const verbose = process.env.VERBOSE;

contract('pool_public_migrator', async (accounts) => {
    const admin = accounts[0];
    const nonAdmin = accounts[1];
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
        await weth.mint(admin, toWei('50'));
        await dai.mint(admin, toWei('2000'));

        await weth.approve(LEGACY_POOL, MAX);
        await dai.approve(LEGACY_POOL, MAX);

        yfv = await TToken.new('YFValue', 'YFV', 18);
        await yfv.mint(admin, toWei('1000000'));
        value = await ValueLiquidityToken.new(yfv.address, toWei('2370000'), {from: admin});

        YFV = yfv.address;
        VALUE = value.address;
    });

    it('migration with YFV pool', async () => {
        await weth.mint(nonAdmin, toWei('100'), {from: admin});
        await yfv.mint(nonAdmin, toWei('100'), {from: admin});

        LEGACY_POOL = await legacy_factory.newBPool.call({from: nonAdmin}); // this works fine in clean room
        await legacy_factory.newBPool({from: nonAdmin});
        legacy_pool = await LegacyBPool.at(LEGACY_POOL);

        await weth.approve(LEGACY_POOL, MAX);
        await yfv.approve(LEGACY_POOL, MAX);

        await weth.approve(LEGACY_POOL, MAX, {from: nonAdmin});
        await yfv.approve(LEGACY_POOL, MAX, {from: nonAdmin});

        await legacy_pool.bind(WETH, toWei('100'), toWei('49'), {from: nonAdmin});
        await legacy_pool.bind(YFV, toWei('100'), toWei('1'), {from: nonAdmin});
        await legacy_pool.finalize({from: nonAdmin});

        await legacy_pool.joinPool(toWei('10'), [MAX, MAX]);
        await legacy_pool.swapExactAmountIn(WETH, toWei('0.1'), YFV, '0', MAX, {from: admin});

        const aliceLpBal = String(await legacy_pool.balanceOf(admin));
        const bobLpBal = String(await legacy_pool.balanceOf(nonAdmin));

        if (verbose) {
            console.log('===== BEFORE MIGRATION');
            console.log('alice legacy_pool bal = ', fromWei(aliceLpBal));
            console.log('bob legacy_pool bal = ', fromWei(bobLpBal));
        }

        const newFactory = await BFactory.new();
        newFactory.setBpoolCreator((await BPoolCreator.deployed()).address);

        const migrator = await ValueLiquidMigrator.new(newFactory.address, YFV, VALUE, 0);
        const MIGRATOR = migrator.address;
        await legacy_pool.approve(MIGRATOR, bobLpBal, {from: nonAdmin});

        NEW_POOL = await migrator.migrate.call(LEGACY_POOL, {from: nonAdmin});
        await migrator.migrate(LEGACY_POOL, {from: nonAdmin});
        const newPool = await BPool.at(NEW_POOL);

        assert.equal(bobLpBal, String(await newPool.totalSupply()));
        assert.equal(bobLpBal, String(await newPool.balanceOf(nonAdmin)));

        if (verbose) {
            console.log('===== AFTER MIGRATION');
            console.log('alice legacy_pool bal = ', fromWei(await legacy_pool.balanceOf(admin)));
            console.log('bob legacy_pool bal = ', fromWei(await legacy_pool.balanceOf(nonAdmin)));
            console.log('alice new_pool bal = ', fromWei(await newPool.balanceOf(admin)));
            console.log('bob new_pool bal = ', fromWei(await newPool.balanceOf(nonAdmin)));

            console.log('===== BEFORE EXIT POOL');
            console.log('bob WETH  = ', fromWei(await weth.balanceOf(nonAdmin)));
            console.log('bob YFV   = ', fromWei(await yfv.balanceOf(nonAdmin)));
            console.log('bob VALUE = ', fromWei(await value.balanceOf(nonAdmin)));
        }

        await newPool.exitPool(String(await newPool.balanceOf(nonAdmin)), [toWei('0'), toWei('0')], {from: nonAdmin});

        if (verbose) {
            console.log('===== AFTER EXIT POOL');
            console.log('bob WETH  = ', fromWei(await weth.balanceOf(nonAdmin)));
            console.log('bob YFV   = ', fromWei(await yfv.balanceOf(nonAdmin)));
            console.log('bob VALUE = ', fromWei(await value.balanceOf(nonAdmin)));
        }
    })
});