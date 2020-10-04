const truffleAssert = require('truffle-assertions');

const TMath = artifacts.require('TMath');

contract('TMath', async () => {
    const MAX = web3.utils.toTwosComplement(-1);

    describe('BMath', () => {
        let tmath;
        before(async () => {
            tmath = await TMath.deployed();
        });

        it('badd throws on overflow', async () => {
            await truffleAssert.reverts(tmath.calc_badd(1, MAX), 'add overflow');
        });

        it('bsub throws on underflow', async () => {
            await truffleAssert.reverts(tmath.calc_bsub(1, 2), 'sub underflow');
        });

        it('bmul throws on overflow', async () => {
            await truffleAssert.reverts(tmath.calc_bmul(2, MAX), 'mul overflow');
        });

        it('bdiv throws on div by 0', async () => {
            await truffleAssert.reverts(tmath.calc_bdiv(1, 0), 'div by 0');
        });

        it('bpow throws on base outside range', async () => {
            await truffleAssert.reverts(tmath.calc_bpow(0, 2), 'base too low');
            await truffleAssert.reverts(tmath.calc_bpow(MAX, 2), 'base too high');
        });
    });
});
