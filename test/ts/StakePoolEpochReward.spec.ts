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
	EpochControllerMock, EpochControllerMockFactory,
	ValueLiquidProvider,
	StakePoolEpochRewardCreator,
	StakePoolEpochReward,
	StakePoolEpochRewardFactory,
} from "../../typechain";
import {ParamType} from "@ethersproject/abi/src.ts/fragments";
import {getApprovalDigest, MaxUint256} from "./shared/common";
import {ecsign} from "ethereumjs-util";
import { IStakePoolEpochRewardFactory } from "../../typechain/IStakePoolEpochRewardFactory";

function encodeParameters(types: Array<string | ParamType>, values: Array<any>) {
	const abi = new ethers.utils.AbiCoder();
	return abi.encode(types, values);
}

export function encodeEpochPoolInfo(data : any) {
	return encodeParameters([ 'address', 'uint256', 'uint256'], [
		data.epochController,
		data.withdrawLockupEpochs,
		data.rewardLockupEpochs
	])
}

const overrides = {};
describe('StakePoolEpochReward', () => {
	let signers: SignerWithAddress[];
	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let router: ValueLiquidRouter;
	let provider: ValueLiquidProvider;
	let stakePoolCreator: StakePoolEpochRewardCreator
	let stakePoolController: StakePoolController
	let token0: Erc20;
	let token1: Erc20;
	let version: any;
	let rewardToken1: Erc20;
	let pair: ValueLiquidPair;
	let stakePool: StakePoolEpochReward;
	let rewardFund: StakePoolRewardFund;
	let epochController: EpochControllerMock;
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
		stakePoolCreator = fixture.stakePoolEpochRewardCreator;
		version = await stakePoolCreator.version();
		token0 = v2Pair.token0;
		token1 = v2Pair.token1;
		rewardToken1 = await new Erc20Factory(wallet).deploy(toWei(10000));
		pair = v2Pair.pair;
		await stakePoolController.addStakePoolCreator(stakePoolCreator.address);
		await token0.approve(router.address, maxUint256);
		await token1.approve(router.address, maxUint256);
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		if (rewardRebaser != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardRebaser(rewardRebaser, true);
		}
		if (rewardMultiplier != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardMultiplier(rewardMultiplier, true);
		}
		epochController = await new EpochControllerMockFactory(wallet).deploy(rewardToken1.address);
		await rewardToken1.approve(epochController.address, maxUint256);
		let poolRewardInfo = encodeEpochPoolInfo({
			epochController: epochController.address,
			withdrawLockupEpochs: 0,
			rewardLockupEpochs: 0,

		});
		await stakePoolController.connect(wallet).create(4001, pair.address,rewardToken1.address,0, 3600 * 48, poolRewardInfo, 0);
		const stakePoolAddress = await stakePoolController.allStakePools(0);
		stakePool = StakePoolEpochRewardFactory.connect(stakePoolAddress, wallet);
		await stakePoolController.setWhitelistStakingFor(v2Pair.router.address, true);
		await stakePoolController.setWhitelistStakingFor(v2Pair.provider.address, true);
		rewardFund = StakePoolRewardFundFactory.connect(await stakePool.rewardFund(), wallet);
		timelock = TimeLockFactory.connect(await stakePool.timelock(), wallet);
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
			expect(await rewardFund.timelock()).to.eq(timelock.address)
			expect(await rewardFund.stakePool()).to.eq(stakePool.address)
			expect(await rewardToken1.balanceOf(rewardFund.address)).to.eq(toWei(0))
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
			await expect(stakePool.stakeFor(other.address)).revertedWith("StakePoolEpochReward: Invalid sender")
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

		it('withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
		})

		it('removeLiquidity', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("3"));
			expect(await stakePool.balance()).to.eq(toWei("3"));
			await expect(async () => stakePool.removeLiquidity(provider.address, token0.address, token1.address, toWei(1), 0, 0, wallet.address, maxUint256))
				.changeTokenBalance(token1, wallet, toWei(1))
			expect(await stakePool.balance()).to.eq(toWei("2"));
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("2"));
		})

		it('emergencyWithdraw', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			await expect(stakePool.emergencyWithdraw()).to.revertedWith("StakePoolEpochReward: Not allow emergencyWithdraw")
			await stakePoolController.setAllowEmergencyWithdrawStakePool(stakePool.address, true)
			await expect(async () => stakePool.emergencyWithdraw())
				.changeTokenBalance(pair, wallet, toWei("3"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("0"));
		})
		it('emergencyWithdraw:gas', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			await expect(stakePool.emergencyWithdraw()).to.revertedWith("StakePoolEpochReward: Not allow emergencyWithdraw")
			await stakePoolController.setAllowEmergencyWithdrawStakePool(stakePool.address, true)
			const tx = await stakePool.emergencyWithdraw();
			const receipt = await tx.wait();
			expect(receipt.gasUsed).to.eq("30104")
		})

		it('failed recoverRewardToken', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "recoverRewardToken(address,uint256,address)";
			let data = encodeParameters(['address', 'uint256', 'address'], [rewardToken1.address, 10, wallet.address]);
			await expect(rewardFund.recoverRewardToken(rewardToken1.address, 10, wallet.address)).revertedWith("StakePoolRewardFund: !timelock");

			await timelock.queueTransaction(rewardFund.address, 0, signature, data, eta)
			expect(await stakePool["allowRecoverRewardToken(address)"](rewardToken1.address)).to.eq(false)
			await mineBlockTimeStamp(ethers, eta)
			expect(await stakePool["allowRecoverRewardToken(address)"](rewardToken1.address)).to.eq(false)

			await expect(timelock.executeTransaction(rewardFund.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction execution reverted.");
		})

		it('allocateReward', async () => {
			await expect(async () => await epochController.allocateSeigniorage(toWei(100), stakePool.address))
				.changeTokenBalance(rewardToken1, rewardFund, toWei(100));
		})

		it('claimReward', async () => {
			await pair.approve(stakePool.address, toWei(3));
			await stakePool.stake(toWei(3));
			expect(await stakePool.epoch()).to.eq(0);
			await epochController.allocateSeigniorage(toWei(100), stakePool.address);
			await expect(async () => await stakePool.claimReward())
				.changeTokenBalance(rewardToken1, wallet, toWei('99.999999999999999999'));
			expect(await stakePool.epoch()).to.eq(1);
		})
	})
})
