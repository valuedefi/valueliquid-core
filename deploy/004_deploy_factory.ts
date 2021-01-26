import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {expandDecimals, isNotDeployed, maxUint256, toWei} from "../test/ts/shared/utilities";
import {DeploymentsExtension} from "hardhat-deploy/dist/types";
import {BigNumber, BigNumberish} from "ethers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy, get, read, execute, getOrNull, log} = deployments;
  const {deployer} = await getNamedAccounts();

  const wethAddress = await getWeth(hre);

  const formula = await deploy("ValueLiquidFormula", {
    contract: "ValueLiquidFormula",
    skipIfAlreadyDeployed: true,
    from: deployer,
    args: [],
    log: true,
  });

  const factoty = await deploy("ValueLiquidFactory", {
    contract: "ValueLiquidFactory",
    skipIfAlreadyDeployed: true,
    from: deployer,
    args: [deployer, formula.address],
    log: true,
  });

  const protocolFeeRemover = await deploy("ProtocolFeeRemover", {
    contract: "ProtocolFeeRemover",
    skipIfAlreadyDeployed: true,
    from: deployer,
    args: [],
    log: true,
  });

  if (factoty.newlyDeployed || protocolFeeRemover.newlyDeployed) {
    await execute("ValueLiquidFactory", {from: deployer, log: true}, "setFeeTo", protocolFeeRemover.address);
  }

  if (factoty.newlyDeployed) {
    await execute("ValueLiquidFactory", {from: deployer, log: true}, "setProtocolFee", BigNumber.from(5000));
  }

  const faasController = await deploy("StakePoolController", {
    contract: 'StakePoolController',
    skipIfAlreadyDeployed: true,
    from: deployer,
    proxy: 'initialize',
    args: [factoty.address],
    log: true,
  });

  const router = await deploy("ValueLiquidRouter", {
    contract: "ValueLiquidRouter",
    skipIfAlreadyDeployed: true,
    from: deployer,
    args: [factoty.address, faasController.address, wethAddress],
    log: true,
  });

  const provider = await deploy("ValueLiquidProvider", {
    contract: "ValueLiquidProvider",
    skipIfAlreadyDeployed: true,
    from: deployer,
    args: [factoty.address, faasController.address, wethAddress],
    log: true,
  });

  const stakePoolCreator = await deploy("StakePoolCreator", {
    contract: "StakePoolCreator",
    skipIfAlreadyDeployed: true,
    from: deployer,
    args: [],
    log: true,
  });

  if (faasController.newlyDeployed) {
    await execute("StakePoolController", {from: deployer, log: true}, "setStakePoolVerifier", deployer, true);
  }
  if (faasController.newlyDeployed || stakePoolCreator.newlyDeployed) {
    await execute("StakePoolController", {from: deployer, log: true}, "addStakePoolCreator", stakePoolCreator.address);
  }
  if (faasController.newlyDeployed || router.newlyDeployed) {
    await execute("StakePoolController", {from: deployer, log: true}, "setWhitelistStakingFor", router.address, true);
  }
  if (faasController.newlyDeployed || provider.newlyDeployed) {
    await execute("StakePoolController", {from: deployer, log: true}, "setWhitelistStakingFor", provider.address, true);
  }
};

export async function getWeth(hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy, get, read, execute, getOrNull, log} = deployments;
  let {deployer, weth} = await getNamedAccounts();
  if (!weth) {
    const wethContract = await deploy("WETH", {
      contract: "WETH9",
      from: deployer,
      args: [],
      log: true,
    });

    if ((await read("WETH", "balanceOf", deployer)).eq(BigNumber.from(0))) {
      await execute("WETH", {from: deployer, log: true, value: expandDecimals(800, 18)}, "deposit");
    }
    weth = wethContract.address;
  }
  return weth;
}

export default func;
func.tags = ["factory"];
