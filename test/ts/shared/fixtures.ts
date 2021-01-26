import {
	ValueLiquidFormula,
	ValueLiquidFormulaFactory,
	Erc20,
	Erc20Factory,
	StakePoolController,
	StakePoolControllerFactory,
	RouterEventEmitterFactory,
	ValueLiquidErc20,
	ValueLiquidFactory,
	ValueLiquidFactoryFactory,
	ValueLiquidPair,
	ValueLiquidPairFactory,
	ValueLiquidRouterFactory,
	Weth9Factory,
	ValueLiquidRouter,
	StakePoolCreatorFactory,
	StakePoolCreator,
	ValueLiquidProvider,
	ValueLiquidProviderFactory,
	Weth9,
} from "../../../typechain";
import {
	keccak256
} from 'ethers/lib/utils'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {toWei} from "./utilities";
import {Contract} from "ethers";
import {deployments} from 'hardhat';

interface FormulaFixture {
	formula: ValueLiquidFormula
}

interface FactoryFixture {
	factory: ValueLiquidFactory
	formula: ValueLiquidFormula
}

const overrides = {}

export async function formulaFixture(signer: SignerWithAddress): Promise<FormulaFixture> {
	return await deployments.createFixture(async () => {
		const formula = await new ValueLiquidFormulaFactory(signer).deploy()
		return {formula}
	})()
}

export async function factoryFixture(signer: SignerWithAddress): Promise<FactoryFixture> {
	return await deployments.createFixture(async () => {

		const {formula} = await formulaFixture(signer)
		const factory = await new ValueLiquidFactoryFactory(signer).deploy(signer.address, formula.address)
		return {factory, formula}
	})()
}

interface PairFixture extends FactoryFixture {
	token0: ValueLiquidErc20
	tokenWeight0: number
	token1: ValueLiquidErc20
	tokenWeight1: number
	pair: ValueLiquidPair
	tokenA: ValueLiquidErc20
	tokenB: ValueLiquidErc20
}

export async function pairFixture(signer: SignerWithAddress): Promise<PairFixture> {
	return await deployments.createFixture(async () => {

		const {factory, formula} = await factoryFixture(signer)

		const tokenA = await new Erc20Factory(signer).deploy(toWei(10000));
		const tokenB = await new Erc20Factory(signer).deploy(toWei(10000))

		await factory.createPair(tokenA.address, tokenB.address, 50, 3, overrides)
		const pairAddress = await factory.getPair(tokenA.address, tokenB.address, 50, 3)
		const pair = ValueLiquidPairFactory.connect(pairAddress, signer)
		const token0Address = await pair.token0()
		const token0 = tokenA.address === token0Address ? tokenA : tokenB
		const token1 = tokenA.address === token0Address ? tokenB : tokenA
		const tokenWeight0 = 50;
		const tokenWeight1 = 50;
		return {factory, formula, token0, tokenWeight0, token1, tokenWeight1, pair, tokenA, tokenB}
	})();
}

export async function pairDifferentWeightFixture(signer: SignerWithAddress, tokenWeightA = 80): Promise<PairFixture> {
	return await deployments.createFixture(async () => {

		const {factory, formula} = await factoryFixture(signer)

		const tokenA = await new Erc20Factory(signer).deploy(toWei(10000));
		const tokenB = await new Erc20Factory(signer).deploy(toWei(10000))

		await factory.createPair(tokenA.address, tokenB.address, tokenWeightA, 4, overrides)
		const pairAddress = await factory.getPair(tokenA.address, tokenB.address, tokenWeightA, 4)
		const pair = ValueLiquidPairFactory.connect(pairAddress, signer)
		const token0Address = await pair.token0()
		const token1Address = await pair.token1()
		const {_tokenWeight0: tokenWeight0, _tokenWeight1: tokenWeight1} = await pair.getTokenWeights();
		return {
			factory, formula,
			token0: Erc20Factory.connect(token0Address, signer),
			tokenWeight0,
			token1: Erc20Factory.connect(token1Address, signer),
			tokenWeight1,
			pair,
			tokenA,
			tokenB
		}
	})();
}


export interface V2Fixture {
	formula: Contract
	token0: Erc20
	token1: Erc20
	tokenA: Erc20
	tokenB: Erc20
	tokenWeight0: number,
	WETH: Weth9
	WETHPartner: Contract
	// factoryV1: Contract
	factoryV2: ValueLiquidFactory
	routerEventEmitter: Contract
	router: ValueLiquidRouter
	provider: ValueLiquidProvider
	stakePoolController: StakePoolController
	pair: ValueLiquidPair
	WETHPair: ValueLiquidPair
	initCodeHash: string
}

export async function v2Fixture(signer: SignerWithAddress, samePairWeight: boolean): Promise<V2Fixture> {
	return await deployments.createFixture(async () => {
		const {
			factory,
			formula,
			token0,
			token1,
			pair,
			tokenA,
			tokenB,
			tokenWeight0,
		} = samePairWeight ? await pairFixture(signer) : await pairDifferentWeightFixture(signer);
		const WETHPartner = await new Erc20Factory(signer).deploy(toWei(10000));
		const WETH = await new Weth9Factory(signer).deploy();


		// deploy V2
		const factoryV2 = factory
		const uniswapPairBytecode = new ValueLiquidPairFactory(signer).bytecode;
		const initCodeHash = keccak256(uniswapPairBytecode);
		// deploy routers
		const stakePoolController = await new StakePoolControllerFactory(signer).deploy();
		await stakePoolController.initialize(factory.address)
		const provider = await new ValueLiquidProviderFactory(signer).deploy(factoryV2.address, stakePoolController.address, WETH.address, overrides)
		const router = await new ValueLiquidRouterFactory(signer).deploy(factoryV2.address, stakePoolController.address, WETH.address, overrides)

		if (samePairWeight) {
			await factoryV2.createPair(WETH.address, WETHPartner.address, 50, 3)
		} else {
			await factoryV2.createPair(WETH.address, WETHPartner.address, 80, 4)
		}
		const WETHPairAddress = samePairWeight
			? await factoryV2.getPair(WETH.address, WETHPartner.address, 50, 3)
			: await factoryV2.getPair(WETH.address, WETHPartner.address, 80, 4);
		const WETHPair = ValueLiquidPairFactory.connect(WETHPairAddress, signer)
		const routerEventEmitter = await new RouterEventEmitterFactory(signer).deploy()
		return {
			formula,
			token0,
			token1,
			tokenA,
			tokenB,
			tokenWeight0,
			WETH,
			WETHPartner,
			// factoryV1,
			factoryV2,
			provider,
			router,
			stakePoolController,
			routerEventEmitter,
			// migrator,
			// WETHExchangeV1,
			pair,
			WETHPair,
			initCodeHash
		}
	})()
}

interface StakePoolFixture {
	v2Pair: V2Fixture,
	stakePoolCreator: StakePoolCreator,
	stakePoolController: StakePoolController,
}

export async function faasFixture(signer: SignerWithAddress): Promise<StakePoolFixture> {
	return await deployments.createFixture(async () => {
		const v2Pair = await v2Fixture(signer, true);
		const stakePoolCreator = await new StakePoolCreatorFactory(signer).deploy();
		const stakePoolController = v2Pair.stakePoolController;
		return {
			v2Pair,
			stakePoolCreator,
			stakePoolController,
		}
	})()
}
