import {expect} from "./chai-setup";
import {BigNumber, BigNumberish, Contract} from 'ethers'
import {ethers, network} from "hardhat";


import {faasFixture} from './shared/fixtures'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {
	ADDRESS_ZERO,
	getLatestBlock,
	getLatestBlockNumber,
	maxUint256,
	mineBlocks, mineBlockTimeStamp,
	toWei
} from "./shared/utilities";
import {
	StakePoolController,
	StakePool,
	StakePoolFactory,
	ValueLiquidPair,
	StakePoolCreator,
	StakePoolRewardFundFactory,
	TimeLockFactory,
	StakePoolRewardFund,
	TimeLock,
	Erc20,
	Erc20Factory,
	ValueLiquidRouter,
	StakePoolRewardRebaserMockFactory,
	StakePoolRewardMultiplierMockFactory,
	ValueLiquidProvider, Weth9Factory, Weth9
} from "../../typechain";
import {ParamType} from "@ethersproject/abi/src.ts/fragments";
import {getApprovalDigest, MaxUint256} from "./shared/common";
import {ecsign} from "ethereumjs-util";
import {encodePoolInfo} from "./StakePoolController.spec";

function encodeParameters(types: Array<string | ParamType>, values: Array<any>) {
	const abi = new ethers.utils.AbiCoder();
	return abi.encode(types, values);
}

const overrides = {};
describe('StakePoolETH', () => {
	let signers: SignerWithAddress[];
	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let router: ValueLiquidRouter;
	let provider: ValueLiquidProvider;
	let stakePoolCreator: StakePoolCreator
	let stakePoolController: StakePoolController
	let token: Erc20;
	let weth: Weth9;
	let token0: Erc20;
	let token1: Erc20;
	let version: any;
	let rewardToken1: Erc20;
	let rewardToken2: Erc20;
	let pair: ValueLiquidPair;
	let stakePool: StakePool;
	let rewardFund: StakePoolRewardFund;
	let timelock: TimeLock;
	let deployWallet: any;

	async function init(rewardRebaser: string = ADDRESS_ZERO, rewardMultiplier = ADDRESS_ZERO) {
		deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);
		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await faasFixture(wallet)
		const v2Pair = fixture.v2Pair;
		router = v2Pair.router;
		provider = v2Pair.provider;
		stakePoolController = fixture.stakePoolController;
		stakePoolCreator = fixture.stakePoolCreator;
		version = await stakePoolCreator.version();
		weth = fixture.v2Pair.WETH;
		pair = v2Pair.WETHPair;

		token0 = Erc20Factory.connect(await pair.token0(), wallet);
		token1 = Erc20Factory.connect(await pair.token1(), wallet);
		token = token0.address == weth.address ? token1 : token0;
		rewardToken1 = await new Erc20Factory(wallet).deploy(toWei(10000));
		rewardToken2 = await new Erc20Factory(wallet).deploy(toWei(10000));
		await stakePoolController.addStakePoolCreator(stakePoolCreator.address);
		await token0.approve(router.address, maxUint256);
		await token1.approve(router.address, maxUint256);
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		await rewardToken2.approve(stakePoolController.address, maxUint256);
		if (rewardRebaser != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardRebaser(rewardRebaser, true);
		}
		if (rewardMultiplier != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardMultiplier(rewardMultiplier, true);
		}
		let poolRewardInfo = encodePoolInfo({
			rewardRebaser: rewardRebaser,
			rewardMultiplier: rewardMultiplier,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 60,
			rewardPerBlock: toWei(0.1),
			lockRewardPercent: 0,
			startVestingBlock: 0,
			endVestingBlock: 0,
			unstakingFrozenTime: 0,
		});
		await stakePoolController.connect(wallet).create(version, pair.address,rewardToken1.address, toWei(100), 3600 * 48, poolRewardInfo, 0);
		const stakePoolAddress = await stakePoolController.allStakePools(0);
		stakePool = StakePoolFactory.connect(stakePoolAddress, wallet);
		await stakePoolController.setWhitelistStakingFor(v2Pair.router.address, true);
		await stakePoolController.setWhitelistStakingFor(v2Pair.provider.address, true);
		rewardFund = StakePoolRewardFundFactory.connect(await stakePool.rewardFund(), wallet);
		timelock = TimeLockFactory.connect(await stakePool.timelock(), wallet);
		await weth.deposit({value: toWei(100)})
		await addLiquidity(toWei(10), toWei(10))
	}


	async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
		await token0.transfer(pair.address, token0Amount);
		await token1.transfer(pair.address, token1Amount);
		await pair.mint(wallet.address, overrides);
	}

	describe('Base function StakePool', () => {
		beforeEach(async () => {
			await init();
		})
		it('valid parameters', async () => {
			expect(await stakePool.rewardPoolInfoLength()).to.eq(1)
			expect(await rewardFund.timelock()).to.eq(timelock.address)
			expect(await rewardFund.stakePool()).to.eq(stakePool.address)
			expect(await rewardToken1.balanceOf(rewardFund.address)).to.eq(toWei(100))
			expect(await timelock.admin()).to.eq(wallet.address)
			expect(await timelock.delay()).to.eq(3600 * 48)
		})
		it('stake', async () => {
			await expect(stakePool.stake(toWei(1))).revertedWith("ds-math-sub-underflow")
			await pair.approve(stakePool.address, toWei(1))
			await expect(stakePool.stake(toWei(1)))
				.to.emit(stakePool, "Deposit").withArgs(wallet.address, toWei("1"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("1"));
		})

		it('stakeFor', async () => {
			await pair.transfer(stakePool.address, toWei(1))
			await expect(stakePool.stakeFor(other.address)).revertedWith("StakePool: Invalid sender")
			await pair.approve(stakePool.address, toWei(1))
			await stakePoolController.setWhitelistStakingFor(wallet.address, true);
			await expect(stakePool.stakeFor(other.address))
				.to.emit(stakePool, "Deposit").withArgs(other.address, toWei("1"))
			expect((await stakePool.userInfo(other.address)).amount).to.eq(toWei("1"));
		})
		it('routerStake', async () => {
			await pair.approve(provider.address, toWei(1))
			await expect(provider.stake(stakePool.address, toWei(1), MaxUint256, ))
				.to.emit(stakePool, "Deposit").withArgs(wallet.address, toWei("1"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("1"));
		})
		it('stakeWithPermit', async () => {
			const nonce = await pair.nonces(wallet.address)
			const digest = await getApprovalDigest(
				pair,
				{owner: wallet.address, spender: provider.address, value: toWei(1)},
				nonce,
				MaxUint256
			)
			const {
				v,
				r,
				s
			} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployWallet.privateKey.slice(2), 'hex'))
			await expect(provider.stakeWithPermit(stakePool.address, toWei(1), MaxUint256, false, v, r, s))
				.to.emit(stakePool, "Deposit").withArgs(wallet.address, toWei("1"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("1"));
		})
		it('addStakeLiquidity', async () => {
			await expect(router.addStakeLiquidity(stakePool.address, token0.address, token1.address, toWei(10), toWei(10), 0, 0, MaxUint256))
				.to.emit(stakePool, "Deposit").withArgs(wallet.address, toWei("10"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("10"));
		})
		it('addStakeLiquidityETH', async () => {
			await expect(router.addStakeLiquidityETH(stakePool.address, token.address, toWei(10), 0, 0, MaxUint256, {value: toWei(10)}))
				.to.emit(stakePool, "Deposit").withArgs(wallet.address, toWei("10"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("10"));
		})

		it('pendingReward', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.3));
		})
		it('withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
				.to.emit(stakePool, "PayRewardPool").withArgs(0, rewardToken1.address, wallet.address, toWei(0.2), toWei(0.2), toWei(0.2))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, toWei(0.2))
		})
		it('removeLiquidity', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			await expect(async () => stakePool.removeLiquidity(provider.address, token0.address, token1.address, toWei(1), 0, 0, wallet.address, maxUint256))
				.changeTokenBalance(token0, wallet, toWei(1))
			await expect(async () => stakePool.removeLiquidity(provider.address, token0.address, token1.address, toWei(1), 0, 0, wallet.address, maxUint256))
				.changeTokenBalance(token1, wallet, toWei(1))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("1"));
		})

		it('removeLiquidityETH', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			await expect(async () => stakePool.removeLiquidityETH(provider.address, token.address, toWei(1), 0, 0, wallet.address, maxUint256))
				.changeTokenBalance(token, wallet, toWei(1))
				.changeEtherBalance(wallet, toWei(1))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("1"));
		})
		it('emergencyWithdraw', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			await expect(stakePool.emergencyWithdraw()).to.revertedWith("StakePool: Not allow emergencyWithdraw")
			await stakePoolController.setAllowEmergencyWithdrawStakePool(stakePool.address, true)
			await expect(async () => stakePool.emergencyWithdraw())
				.changeTokenBalance(pair, wallet, toWei("3"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("0"));
		})
		it('failed recoverRewardToken', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "recoverRewardToken(address,uint256,address)";
			let data = encodeParameters(['address', 'uint256', 'address'], [rewardToken1.address, 10, wallet.address]);
			await expect(rewardFund.recoverRewardToken(rewardToken1.address, 10, wallet.address)).revertedWith("StakePoolRewardFund: !timelock");

			await timelock.queueTransaction(rewardFund.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			await expect(timelock.executeTransaction(rewardFund.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction execution reverted.");
		})
		// it('success recoverRewardToken', async () => {
		// 	const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
		// 	let signature = "recoverRewardToken(address,uint256,address)";
		// 	let data = encodeParameters(['address', 'uint256', 'address'], [rewardToken1.address, 10, wallet.address]);
		// 	await timelock.queueTransaction(rewardFund.address, 0, signature, data, eta)
		// 	let {endRewardBlock} = await stakePool.rewardPoolInfo(0);
		// 	let blocks = (endRewardBlock.toNumber() + 6528 * 30) - (await getLatestBlock(ethers)).number
		// 	await mineBlocks(ethers, blocks)
		// 	await mineBlockTimeStamp(ethers, eta)
		// 	await expect(timelock.executeTransaction(rewardFund.address, 0, signature, data, eta))
		// 		.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, 10);
		// })

		it('updateRewardPool', async () => {
			let rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "updateRewardPool(uint8,uint256,uint256)";
			let newEndBlocks = rewardPoolInfo.endRewardBlock.add(10);
			let data = encodeParameters(['uint8', 'uint256', 'uint256'], [0, newEndBlocks, toWei(0.2)]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta)
			rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			expect(rewardPoolInfo.endRewardBlock).to.eq(newEndBlocks)
			expect(rewardPoolInfo.rewardPerBlock).to.eq(toWei(0.2))
		})

	})

	describe('RewardRebaser', () => {
		beforeEach(async () => {
			const rebaser = await new StakePoolRewardRebaserMockFactory(wallet).deploy(toWei("2"))
			await init(rebaser.address);
		})
		it('pendingReward & Withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			let rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			expect(await stakePool.getRewardRebase(0, rewardPoolInfo.rewardToken, toWei(0.1))).to.eq(toWei(0.2));
			expect(await stakePool.getRewardPerBlock(0)).to.eq(toWei(0.2));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.4));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.6));
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
				.to.emit(stakePool, "PayRewardPool").withArgs(0, rewardToken1.address, wallet.address, toWei(0.4), toWei(0.8), toWei(0.8))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, toWei(0.8))
		})
		it('updateRewardRebaser', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "updateRewardRebaser(uint8,address)";
			let data = encodeParameters(['uint8', 'address'], [0, ADDRESS_ZERO]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta - 180)
			await expect(timelock.executeTransaction(stakePool.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta);
			expect((await stakePool.rewardPoolInfo(0)).rewardRebaser, ADDRESS_ZERO);
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			let rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			expect(await stakePool.getRewardRebase(0, rewardPoolInfo.rewardToken, toWei(0.1))).to.eq(toWei(0.1));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
		});
	});

	describe('RewardMultiplier', () => {
		beforeEach(async () => {
			const rewardMultiplier = await new StakePoolRewardMultiplierMockFactory(wallet).deploy(toWei("2"))
			await init(ADDRESS_ZERO, rewardMultiplier.address);
		})
		it('pendingReward & Withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.getRewardMultiplier(0, 1, 2, toWei(0.1))).to.eq(toWei(0.2));
			expect(await stakePool.getRewardPerBlock(0)).to.eq(toWei(0.2));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.4));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.6));
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
				.to.emit(stakePool, "PayRewardPool").withArgs(0, rewardToken1.address, wallet.address, toWei(0.8), toWei(0.8), toWei(0.8))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, toWei(0.8))
		})
		it('updateRewardMultiplier', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "updateRewardMultiplier(uint8,address)";
			let data = encodeParameters(['uint8', 'address'], [0, ADDRESS_ZERO]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta - 180)
			await expect(timelock.executeTransaction(stakePool.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta);
			expect((await stakePool.rewardPoolInfo(0)).rewardMultiplier, ADDRESS_ZERO);
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.getRewardMultiplier(0, 1, 2, toWei(0.1))).to.eq(toWei(0.1));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
		});
	});
	describe('AddRewardPool', () => {
		async function addRewardPool() {
			let latestBlockNumber = await getLatestBlockNumber(ethers);
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "addRewardPool(address,address,address,uint256,uint256,uint256,uint256,uint256,uint256)";
			let data = encodeParameters(['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [rewardToken2.address, ADDRESS_ZERO, ADDRESS_ZERO, latestBlockNumber + 1, latestBlockNumber + 60, toWei(0.2), 0, 0, 0]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta);
		}
		beforeEach(async () => {
			await init();
			await addRewardPool();
		})
		it('pendingReward', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(1, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(1, wallet.address)).to.eq(toWei(0.4));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(1, wallet.address)).to.eq(toWei(0.6));
		})
	});
})
