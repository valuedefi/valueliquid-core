const ethers = require('ethers');

function encodeParameters(types, values) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode(types, values);
}

let now = Date.now() / 1000 | 0;
now = (Math.round(now / 600) + 1) * 600;

const ValueMasterPool = '0x1e71C74d45fFdf184A91F63b94D6469876AEe046';
const ValueLiquidMigrator = '0x4572b9882FD29BDBe26a74Dfa8afe9A75365e560';

const ALLOC_POINT_BASE = 50;

const BPT_BAND_YFV = '0xe5B11f98f8A16480Cfe33029DA27884719d1573B';

contract('timelock.tx.utils', ([alice]) => {
    it('add BPT_BAND_YFV', async () => {
        const allocPoint = 1;
        const lpContract = BPT_BAND_YFV;
        const lastRewardBlock = 0;
        console.log('\n========================================================\n');
        console.log('ValueMasterPool.add(%d, %s, false, %d)', allocPoint, lpContract, lastRewardBlock);
        console.log('target: %s', ValueMasterPool);
        console.log('value: 0');
        console.log('signature: add(uint256,address,bool,uint256)');
        console.log('data: %s', encodeParameters(['uint256', 'address', 'bool', 'uint256'], [allocPoint, lpContract, false, lastRewardBlock]));
        console.log('eta: %d', now + 24 * 3600);
        console.log('--> queueTransaction: ');
        console.log('--> executeTransaction: ');
    });

    it('setMigrator', async () => {
        console.log('\n========================================================\n');
        console.log('ValueMasterPool.setMigrator(%s)', ValueLiquidMigrator);
        console.log('target: %s', ValueMasterPool);
        console.log('value: 0');
        console.log('signature: setMigrator(address)');
        console.log('data: %s', encodeParameters(['address'], [ValueLiquidMigrator]));
        console.log('eta: %d', now + 24 * 3600);
        console.log('--> queueTransaction: ');
        console.log('--> executeTransaction: ');
    });

    it('migrate BPT_BAND_YFV', async () => {
        const poolId = 11;
        console.log('\n========================================================\n');
        console.log('ValueMasterPool.migrate(%d)', poolId);
        console.log('target: %s', ValueMasterPool);
        console.log('value: 0');
        console.log('signature: migrate(uint256)');
        console.log('data: %s', encodeParameters(['uint256'], [poolId]));
        console.log('eta: %d', now + 24 * 3600);
        console.log('--> queueTransaction: ');
        console.log('--> executeTransaction: ');
    });

    it('migrate 11 main pools', async () => {
        const eta = 1601992800; // Tuesday, October 6, 2020 2:00:00 PM GMT+0
        for (let poolId = 0; poolId < 11; ++poolId) {
            console.log('\n========================================================\n');
            console.log('ValueMasterPool.migrate(%d)', poolId);
            console.log('target: %s', ValueMasterPool);
            console.log('value: 0');
            console.log('signature: migrate(uint256)');
            console.log('data: %s', encodeParameters(['uint256'], [poolId]));
            console.log('eta: %d', eta);
            console.log('--> queueTransaction: ');
            console.log('--> executeTransaction: ');
        }
    });
});
