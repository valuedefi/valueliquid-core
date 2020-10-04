
const BActions = artifacts.require('BActions');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(BActions);
};
