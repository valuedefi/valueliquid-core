import {ethers} from "hardhat";
import {expect} from "../chai-setup";

import {expandDecimals, forkBlockNumber, maxUint256, toWei, unlockForkAddress} from "../shared/utilities";
import {
	Weth9,
	Weth9Factory,
	ValueLiquidRouter,
	TToken,
	ValueLiquidRouterFactory,
	TTokenFactory,
	DeflatingErc20Factory,
	ValueLiquidFactory,
	ValueLiquidFactoryFactory,
	ValueLiquidFormulaFactory,
	StakePoolController,
	StakePoolControllerFactory,
} from "../../../typechain";
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import { BigNumber, Contract } from "ethers";
import {MaxUint256} from "../shared/common";

describe("BatchSwapMix", function () {
	let deployer: SignerWithAddress;

	let signers: SignerWithAddress[];
	let router: ValueLiquidRouter;
	let factory: ValueLiquidFactory;
	let controller: StakePoolController;

	let wethToken: Weth9;
	let usdc: TToken;
	let token1: TToken;
	let token2: TToken;

	const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
	const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
	const token1Address = "0x49E833337ECe7aFE375e44F4E3e8481029218E5c";

	// bpool of usdc <> token1
	const bpoolAddress = "0x67755124D8E4965c5c303fFd15641Db4Ff366e47";
	// bpool of weth <> token1
	const bpoolWETHAddress = "0xbd63d492bbb13d081D680CE1f2957a287FD8c57c";
	let pairAddress: string;

	const prepareToken = async () => {
		await forkBlockNumber(ethers, 11539946);

		signers = await ethers.getSigners();
		deployer = signers[0];

		wethToken = Weth9Factory.connect(wethAddress, deployer);
		usdc = TTokenFactory.connect(usdcAddress, deployer);
		token1 = TTokenFactory.connect(token1Address, deployer);

		let testAddress = "0x28C5B0445d0728bc25f143f8EbA5C5539fAe151A";
		await unlockForkAddress(ethers, testAddress);
		let testUser = await ethers.getSigner(testAddress);
		await usdc.connect(testUser).transfer(deployer.address, expandDecimals(100000, 6));

		testAddress = "0x5565d64f29ea17355106df3ba5903eb793b3e139";
		await unlockForkAddress(ethers, testAddress);
		testUser = await ethers.getSigner(testAddress);
		await token1.connect(testUser).transfer(deployer.address, toWei(12000));

		token2 = await new TTokenFactory(deployer).deploy("Token2", "TOKEN2", 18);
		await token2.mint(deployer.address, toWei(100000));

		//deploy v2 factory
		const formula = await new ValueLiquidFormulaFactory(deployer).deploy();
		factory = await new ValueLiquidFactoryFactory(deployer).deploy(deployer.address, formula.address);
		controller = await new StakePoolControllerFactory(deployer).deploy();
		await controller.initialize(factory.address);
		router = await new ValueLiquidRouterFactory(deployer).deploy(factory.address, controller.address, wethAddress);

		await factory.setFeeTo(deployer.address);
		await factory.setProtocolFee(BigNumber.from(5000));
	};

	const deployTunnelPool = async () => {
		await prepareToken();

		//deploy pair v2 usdc-token1
		pairAddress = await createPair(usdc, token1, 20, expandDecimals(10000, 6), toWei(10000));
	};

	const deployPipelinePool = async () => {
		await prepareToken();

		//deploy pair v2 token1-token2
		pairAddress = await createPair(token1, token2, 30, toWei(10000), toWei(10000));
	};

	const createPair = async (token1: TToken, token2: Contract, weight1: number, liqToken1: BigNumber, liqToken2: BigNumber): Promise<string> => {
		await factory.createPair(token1.address, token2.address, weight1, 3);
		const pairAddress = await factory.getPair(token1.address, token2.address, weight1, 3);

		await token1.approve(router.address, maxUint256);
		await token2.approve(router.address, maxUint256);
		await router.addLiquidity(pairAddress, token1.address, token2.address, liqToken1, liqToken2, liqToken1, liqToken2, deployer.address, MaxUint256);
		return pairAddress;
	};

	afterEach(async function () {
		expect(await ethers.provider.getBalance(router.address)).to.eq(0);
		expect(await usdc.balanceOf(router.address)).to.eq(0);
		expect(await wethToken.balanceOf(router.address)).to.eq(0);
		expect(await token1.balanceOf(router.address)).to.eq(0);
		expect(await token2.balanceOf(router.address)).to.eq(0);
	});

	describe("batch swap multi hop", function () {
		beforeEach(async () => {
			await deployPipelinePool();
		});

		it("multi hop swap exact in bpool->pair", async () => {
			const usdcBefore = await usdc.balanceOf(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await usdc.approve(router.address, expandDecimals(2000, 6));

			const tx = await router.multihopBatchSwapExactIn(
				[
					[
						{
							pool: bpoolAddress,
							tokenIn: usdc.address,
							tokenOut: token1.address,
							swapAmount: expandDecimals(2000, 6),
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: true,
						},
						{
							pool: pairAddress,
							tokenIn: token1.address,
							tokenOut: token2.address,
							swapAmount: 0, //no need, get input from above swap
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: false,
						},
					],
				],
				usdc.address,
				token2.address,
				expandDecimals(2000, 6),
				0,
				maxUint256,
				0
			);

			const usdcAfter = await usdc.balanceOf(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(usdcBefore.sub(usdcAfter)).is.eq(expandDecimals(2000, 6));
			expect(token1After).is.eq(token1Before);
			expect(token2After.sub(token2Before)).is.eq(toWei("377.164462471208263644"));

			const receipt = await tx.wait();
			expect(receipt.gasUsed).to.eq(291428);
		});

		it("multi hop swap exact in pair->pair", async () => {
			//deploy pair v2 usdc-token1
			const pair2Address = await createPair(usdc, token1, 40, expandDecimals(10000, 6), toWei(2000));

			const usdcBefore = await usdc.balanceOf(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await usdc.approve(router.address, expandDecimals(2000, 6));

			const tx = await router.multihopBatchSwapExactIn(
				[
					[
						{
							pool: pair2Address,
							tokenIn: usdc.address,
							tokenOut: token1.address,
							swapAmount: expandDecimals(2000, 6),
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: false,
						},
						{
							pool: pairAddress,
							tokenIn: token1.address,
							tokenOut: token2.address,
							swapAmount: 0, //no need, get input from above swap
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: false,
						},
					],
				],
				usdc.address,
				token2.address,
				expandDecimals(2000, 6),
				0,
				maxUint256,
				0
			);

			const usdcAfter = await usdc.balanceOf(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(usdcBefore.sub(usdcAfter)).is.eq(expandDecimals(2000, 6));
			expect(token1After).is.eq(token1Before);
			expect(token2After.sub(token2Before)).is.eq(toWei("95.996885477916480879"));

			const receipt = await tx.wait();
			expect(receipt.gasUsed).to.eq(337977);
		});

		it("multi hop batch swap exact in pair,pair", async () => {
			//deploy pair v2 token1-token2
			const pair2Address = await createPair(token1, token2, 40, toWei(2000), toWei(10000));
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await token2.approve(router.address, toWei(2000));

			const tx = await router.multihopBatchSwapExactIn(
				[
					[
						{
							pool: pairAddress,
							tokenIn: token2.address,
							tokenOut: token1.address,
							swapAmount: toWei(1000),
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: false,
						},
					],
					[
						{
							pool: pair2Address,
							tokenIn: token2.address,
							tokenOut: token1.address,
							swapAmount: toWei(1000),
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: false,
						},
					],
				],
				token2.address,
				token1.address,
				toWei(2000),
				0,
				maxUint256,
				0
			);

			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(token2Before.sub(token2After)).is.eq(toWei(2000));
			expect(token1After.sub(token1Before)).is.eq(toWei("2254.597842090077508620"));

			const receipt = await tx.wait();
			expect(receipt.gasUsed).to.eq(343761);
		});

		it("multi hop swap exact in deflating pair -> bpool", async () => {
			//deploy pair v2 token1-deflating
			const deflating = await new DeflatingErc20Factory(deployer).deploy(0);
			await deflating.mint(deployer.address, toWei(100000));
			const pair2Address = await createPair(token1, deflating, 30, toWei(2000), toWei(2000));

			const usdcBefore = await usdc.balanceOf(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const deflatingBefore = await deflating.balanceOf(deployer.address);

			await usdc.approve(router.address, expandDecimals(2000, 6));

			const tx = await router.multihopBatchSwapExactIn(
				[
					[
						{
							pool: bpoolAddress,
							tokenIn: usdc.address,
							tokenOut: token1.address,
							swapAmount: expandDecimals(2000, 6),
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: true,
						},
						{
							pool: pair2Address,
							tokenIn: token1.address,
							tokenOut: deflating.address,
							swapAmount: 0, //no need, get input from above swap
							limitReturnAmount: 0,
							maxPrice: 0,
							isBPool: false,
						},
					],
				],
				usdc.address,
				deflating.address,
				expandDecimals(2000, 6),
				0,
				maxUint256,
				0
			);

			const usdcAfter = await usdc.balanceOf(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const deflatingAfter = await deflating.balanceOf(deployer.address);

			expect(usdcBefore.sub(usdcAfter)).is.eq(expandDecimals(2000, 6));
			expect(token1After).is.eq(token1Before);
			expect(deflatingAfter.sub(deflatingBefore)).is.eq(toWei("295.012890661204188272"));

			const receipt = await tx.wait();
			expect(receipt.gasUsed).to.eq(304423);
		});

		it("multi hop swap exact out sequence bpool -> pair", async () => {
			const usdcBefore = await usdc.balanceOf(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await usdc.approve(router.address, expandDecimals(7000, 6));

			const tx = await router.multihopBatchSwapExactOut(
				[
					[
						{
							pool: bpoolAddress,
							tokenIn: usdc.address,
							tokenOut: token1.address,
							swapAmount: 0, //no need, get input from bellow swap
							limitReturnAmount: maxUint256,
							maxPrice: maxUint256,
							isBPool: true,
						},
						{
							pool: pairAddress,
							tokenIn: token1.address,
							tokenOut: token2.address,
							swapAmount: toWei(1000),
							limitReturnAmount: maxUint256,
							maxPrice: maxUint256,
							isBPool: false,
						},
					],
				],
				usdc.address,
				token2.address,
				expandDecimals(7000, 6),
				maxUint256,
				0
			);

			const usdcAfter = await usdc.balanceOf(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(usdcBefore.sub(usdcAfter)).is.eq(expandDecimals("6014.837762", 6));
			expect(token1After).is.eq(token1Before);
			expect(token2After.sub(token2Before)).is.eq(toWei(1000));

			const receipt = await tx.wait();
			expect(receipt.gasUsed).to.eq(315801);
		});

		it("multi hop swap exact out sequence pair -> bpool", async () => {
			const usdcBefore = await usdc.balanceOf(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await token2.approve(router.address, toWei(300));

			await router.multihopBatchSwapExactOut(
				[
					[
						{
							pool: pairAddress,
							tokenIn: token2.address,
							tokenOut: token1.address,
							swapAmount: 0, //no need, get input from bellow swap
							limitReturnAmount: maxUint256,
							maxPrice: maxUint256,
							isBPool: false,
						},
						{
							pool: bpoolAddress,
							tokenIn: token1.address,
							tokenOut: usdc.address,
							swapAmount: expandDecimals(1000, 6),
							limitReturnAmount: maxUint256,
							maxPrice: maxUint256,
							isBPool: true,
						},
					],
				],
				token2.address,
				usdc.address,
				toWei(300),
				maxUint256,
				0
			);

			const usdcAfter = await usdc.balanceOf(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(usdcAfter.sub(usdcBefore)).is.eq(expandDecimals(1000, 6));
			expect(token1After).is.eq(token1Before);
			expect(token2Before.sub(token2After)).is.eq(toWei("214.483538669972479750"));
		});
	});

	describe("batch swap multi hop supporting eth", function () {
		beforeEach(async () => {
			await deployPipelinePool();
		});

		it("multi hop eth in: swap exact in", async () => {
			const wethBefore = await wethToken.balanceOf(deployer.address);
			const ethBefore = await ethers.provider.getBalance(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await router.multihopBatchSwapExactIn(
				[
					[
						{
							pool: bpoolWETHAddress,
							tokenIn: wethToken.address,
							tokenOut: token1.address,
							swapAmount: toWei(0.1),
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: true,
						},
						{
							pool: pairAddress,
							tokenIn: token1.address,
							tokenOut: token2.address,
							swapAmount: 0, //no need, get input from above swap
							limitReturnAmount: 0,
							maxPrice: 0,
							isBPool: false,
						},
					],
				],
				"0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
				token2.address,
				0, //no need, get amount from value eth
				0,
				maxUint256,
				0,
				{
					value: toWei(0.1),
				}
			);

			const wethAfter = await wethToken.balanceOf(deployer.address);
			const ethAfter = await ethers.provider.getBalance(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(ethBefore.sub(ethAfter)).is.gt(toWei(0.1));
			expect(wethAfter).is.eq(wethBefore);
			expect(token1After).is.eq(token1Before);
			expect(token2After.sub(token2Before)).is.eq(toWei("14.053784799008586605"));
		});

		it("multi hop eth out: swap exact in", async () => {
			const wethBefore = await wethToken.balanceOf(deployer.address);
			const ethBefore = await ethers.provider.getBalance(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await token2.approve(router.address, toWei(400));

			await router.multihopBatchSwapExactIn(
				[
					[
						{
							pool: pairAddress,
							tokenIn: token2.address,
							tokenOut: token1.address,
							swapAmount: toWei(400),
							limitReturnAmount: 0,
							maxPrice: 0,
							isBPool: false,
						},
						{
							pool: bpoolWETHAddress,
							tokenIn: token1.address,
							tokenOut: wethToken.address,
							swapAmount: 0,
							limitReturnAmount: 0,
							maxPrice: maxUint256,
							isBPool: true,
						},
					],
				],
				token2.address,
				"0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
				toWei(400),
				0,
				maxUint256,
				0
			);

			const wethAfter = await wethToken.balanceOf(deployer.address);
			const ethAfter = await ethers.provider.getBalance(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(ethAfter.sub(ethBefore)).is.gt(toWei(2.4));
			expect(wethAfter).is.eq(wethBefore);
			expect(token1After).is.eq(token1Before);
			expect(token2Before.sub(token2After)).is.eq(toWei(400));
		});

		it("multi hop eth int: swap exact out", async () => {
			const wethBefore = await wethToken.balanceOf(deployer.address);
			const ethBefore = await ethers.provider.getBalance(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await router.multihopBatchSwapExactOut(
				[
					[
						{
							pool: bpoolWETHAddress,
							tokenIn: wethToken.address,
							tokenOut: token1.address,
							swapAmount: 0, //no need, get input from bellow swap
							limitReturnAmount: maxUint256,
							maxPrice: maxUint256,
							isBPool: true,
						},
						{
							pool: pairAddress,
							tokenIn: token1.address,
							tokenOut: token2.address,
							swapAmount: toWei(1000),
							limitReturnAmount: maxUint256,
							maxPrice: 0,
							isBPool: false,
						},
					],
				],
				"0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
				token2.address,
				toWei(10.5),
				maxUint256,
				0,
				{
					value: toWei(10.5),
				}
			);

			const wethAfter = await wethToken.balanceOf(deployer.address);
			const ethAfter = await ethers.provider.getBalance(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(ethBefore.sub(ethAfter)).is.gt(toWei(10.4));
			expect(wethAfter).is.eq(wethBefore);
			expect(token1After).is.eq(token1Before);
			expect(token2After.sub(token2Before)).is.eq(toWei(1000));
		});

		it("multi hop eth out: swap exact out", async () => {
			const wethBefore = await wethToken.balanceOf(deployer.address);
			const ethBefore = await ethers.provider.getBalance(deployer.address);
			const token1Before = await token1.balanceOf(deployer.address);
			const token2Before = await token2.balanceOf(deployer.address);

			await token2.approve(router.address, toWei(200));

			await router.multihopBatchSwapExactOut(
				[
					[
						{
							pool: pairAddress,
							tokenIn: token2.address,
							tokenOut: token1.address,
							swapAmount: 0, //no need, get input from bellow swap
							limitReturnAmount: maxUint256,
							maxPrice: 0,
							isBPool: false,
						},
						{
							pool: bpoolWETHAddress,
							tokenIn: token1.address,
							tokenOut: wethToken.address,
							swapAmount: toWei(0.8),
							limitReturnAmount: maxUint256,
							maxPrice: maxUint256,
							isBPool: true,
						},
					],
				],
				token2.address,
				"0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
				toWei(200),
				maxUint256,
				0
			);

			const wethAfter = await wethToken.balanceOf(deployer.address);
			const ethAfter = await ethers.provider.getBalance(deployer.address);
			const token1After = await token1.balanceOf(deployer.address);
			const token2After = await token2.balanceOf(deployer.address);

			expect(ethAfter.sub(ethBefore)).is.lt(toWei(0.8));
			expect(token1After).is.eq(token1Before);
			expect(wethAfter).is.eq(wethBefore);
			expect(token2Before.sub(token2After)).is.eq(toWei("118.837852675243267456"));
		});
	});
});
