var BFactory = artifacts.require("BFactory");
var BPoolCreator = artifacts.require("BPoolCreator");

contract('factory_contract_size', function(accounts) {
    it("get the size of the contract BFactory", function() {
        return BFactory.deployed().then(function(instance) {
            var bytecode = instance.constructor._json.bytecode;
            var deployed = instance.constructor._json.deployedBytecode;
            var sizeOfB  = bytecode.length / 2;
            var sizeOfD  = deployed.length / 2;
            console.log("size of bytecode in bytes = ", sizeOfB);
            console.log("size of deployed in bytes = ", sizeOfD);
            console.log("initialisation and constructor code in bytes = ", sizeOfB - sizeOfD);
        });
    });

    it("get the size of the contract BPoolCreator", function() {
        return BPoolCreator.deployed().then(function(instance) {
            var bytecode = instance.constructor._json.bytecode;
            var deployed = instance.constructor._json.deployedBytecode;
            var sizeOfB  = bytecode.length / 2;
            var sizeOfD  = deployed.length / 2;
            console.log("size of bytecode in bytes = ", sizeOfB);
            console.log("size of deployed in bytes = ", sizeOfD);
            console.log("initialisation and constructor code in bytes = ", sizeOfB - sizeOfD);
        });
    });
});