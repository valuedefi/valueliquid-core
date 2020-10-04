const BPool = artifacts.require('BPool');
const BPoolCreator = artifacts.require('BPoolCreator');
const BFactory = artifacts.require('BFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');

contract('pool_init_supply', async (accounts) => {
    const admin = accounts[0];
    const nonAdmin = accounts[1];
    const { toWei } = web3.utils;
    const { fromWei } = web3.utils;
    const MAX = web3.utils.toTwosComplement(-1);
    describe('Factory', () => {
        let factory;
        let pool;
        let POOL;
        let WETH;
        let DAI;
        let weth;
        let dai;

        before(async () => {
            factory = await BFactory.deployed();
            const poolCreator = await BPoolCreator.deployed();
            factory.setBpoolCreator(poolCreator.address);

            weth = await TToken.new('Wrapped Ether', 'WETH', 18);
            dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

            WETH = weth.address;
            DAI = dai.address;

            // admin balances
            await weth.mint(admin, toWei('5'));
            await dai.mint(admin, toWei('200'));

            // nonAdmin balances
            await weth.mint(nonAdmin, toWei('1'), { from: admin });
            await dai.mint(nonAdmin, toWei('50'), { from: admin });

            POOL = await factory.newBPool.call(); // this works fine in clean room
            await factory.newBPool();
            pool = await BPool.at(POOL);
            await pool.setInitPoolSupply(toWei('200.5'));

            await weth.approve(POOL, MAX);
            await dai.approve(POOL, MAX);

            await weth.approve(POOL, MAX, { from: nonAdmin });
            await dai.approve(POOL, MAX, { from: nonAdmin });
        });

        it('set init pool supply', async () => {
            await pool.bind(WETH, toWei('5'), toWei('5'));
            await pool.bind(DAI, toWei('200'), toWei('5'));
            // await pool.setInitPoolSupply(toWei('200.5'));
            await pool.finalize();

            const initPoolSupply = await pool.initPoolSupply();
            const totalSupply = await pool.totalSupply();
            assert.equal(initPoolSupply.toString(), totalSupply.toString())
            assert.equal(fromWei(initPoolSupply), '200.5');
            assert.equal(fromWei(totalSupply), '200.5');
        });
    });
});
