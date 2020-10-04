const TMath = artifacts.require('TMath');
const BToken = artifacts.require('BToken');
const BFactory = artifacts.require('BFactory');
const BPoolCreator = artifacts.require('BPoolCreator');

module.exports = async function (deployer, network, accounts) {
    if (network === 'development' || network === 'coverage') {
        deployer.deploy(TMath);
    }
    await deployer.deploy(BFactory);
    await deployer.deploy(BPoolCreator);
    const deployedBFactory = await BFactory.deployed();
    const deployedBPoolCreator =  await BPoolCreator.deployed();
    await deployedBFactory.setBpoolCreator(deployedBPoolCreator.address)
};
