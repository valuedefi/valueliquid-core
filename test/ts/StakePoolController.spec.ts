import {expect} from "./chai-setup";
import {BigNumber} from 'ethers'
import {ethers} from "hardhat";


import {faasFixture, V2Fixture} from './shared/fixtures'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {
	ADDRESS_ZERO,
	getLatestBlockNumber,
	maxUint256,
	toWei
} from "./shared/utilities";
import {
	StakePoolController,
	ValueLiquidErc20,
	ValueLiquidPair, StakePoolCreator, Erc20Factory
} from "../../typechain";
const overrides = {};
describe('StakePoolController', () => {
	let signers: SignerWithAddress[];
	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let v2Pair: V2Fixture;
	let version: any;
	let stakePoolCreator: StakePoolCreator
	let stakePoolController: StakePoolController
	let token0: ValueLiquidErc20;
	let token1: ValueLiquidErc20;
	let pair: ValueLiquidPair;
	beforeEach(async () => {
		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await faasFixture(wallet)
		v2Pair = fixture.v2Pair;
		stakePoolController = fixture.stakePoolController;
		stakePoolCreator = fixture.stakePoolCreator;
		token0 = v2Pair.token0;
		token1 = v2Pair.token1;
		pair = v2Pair.pair;
		version = await stakePoolCreator.version();
		await stakePoolController.addStakePoolCreator(stakePoolCreator.address);
		await token0.approve(v2Pair.router.address, maxUint256);
		await token1.approve(v2Pair.router.address, maxUint256);
	})

	async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
		await token0.transfer(pair.address, token0Amount);
		await token1.transfer(pair.address, token1Amount);
		await pair.mint(wallet.address, overrides);
	}


	it('setGovernance', async () => {
		await expect(stakePoolController.connect(wallet).setGovernance(ADDRESS_ZERO)).to.be.revertedWith("StakePoolController: invalid governance");
		await expect(stakePoolController.connect(other).setGovernance(other.address)).to.be.revertedWith("StakePoolController: !governance");
		await stakePoolController.connect(wallet).setGovernance(other.address);
		await stakePoolController.connect(other).setGovernance(wallet.address);
	})
	it('whitelistRewardMultiplier', async () => {
		await expect(stakePoolController.connect(wallet).setWhitelistRewardMultiplier(ADDRESS_ZERO, true)).to.be.revertedWith("StakePoolController: invalid address");
		await expect(stakePoolController.connect(other).setWhitelistRewardMultiplier(other.address, true)).to.be.revertedWith("StakePoolController: !governance");
		expect(await stakePoolController.connect(wallet).isWhitelistRewardMultiplier(other.address)).to.eq(false);
		await stakePoolController.connect(wallet).setWhitelistRewardMultiplier(other.address, true);
		expect(await stakePoolController.connect(wallet).isWhitelistRewardMultiplier(other.address)).to.eq(true);
		await stakePoolController.connect(wallet).setWhitelistRewardMultiplier(other.address, false)
		expect(await stakePoolController.connect(wallet).isWhitelistRewardMultiplier(other.address)).to.eq(false);
	})
	it('whitelistRewardRebaser', async () => {
		await expect(stakePoolController.connect(wallet).setWhitelistRewardRebaser(ADDRESS_ZERO, true)).to.be.revertedWith("StakePoolController: invalid address");
		await expect(stakePoolController.connect(other).setWhitelistRewardRebaser(other.address, true)).to.be.revertedWith("StakePoolController: !governance");
		expect(await stakePoolController.connect(wallet).isWhitelistRewardRebaser(other.address)).to.eq(false);
		await stakePoolController.connect(wallet).setWhitelistRewardRebaser(other.address, true);
		expect(await stakePoolController.connect(wallet).isWhitelistRewardRebaser(other.address)).to.eq(true);
		await stakePoolController.connect(wallet).setWhitelistRewardRebaser(other.address, false)
		expect(await stakePoolController.connect(wallet).isWhitelistRewardRebaser(other.address)).to.eq(false);
	})

	it('whitelistStakingFor', async () => {
		await expect(stakePoolController.connect(wallet).setWhitelistStakingFor(ADDRESS_ZERO, true)).to.be.revertedWith("StakePoolController: invalid address");
		await expect(stakePoolController.connect(other).setWhitelistStakingFor(other.address, true)).to.be.revertedWith("StakePoolController: !governance");
		expect(await stakePoolController.connect(wallet).isWhitelistStakingFor(other.address)).to.eq(false);
		await stakePoolController.connect(wallet).setWhitelistStakingFor(other.address, true);
		expect(await stakePoolController.connect(wallet).isWhitelistStakingFor(other.address)).to.eq(true);
		await stakePoolController.connect(wallet).setWhitelistStakingFor(other.address, false)
		expect(await stakePoolController.connect(wallet).isWhitelistStakingFor(other.address)).to.eq(false);
	})
	it('create invalid version', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await expect(stakePoolController.connect(other).create(1, v2Pair.pair.address, 3600 * 48, {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 0,
			startVestingBlock: 0,
			endVestingBlock: 0,
			unstakingFrozenTime: 0,
			rewardFundAmount: 0,
		}, 0)).to.be.revertedWith("StakePoolController: Invalid stake pool creator version");

	})
	it('create invalid pair', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await expect(stakePoolController.connect(other).create(version, wallet.address, 3600 * 48, {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 0,
			startVestingBlock: 0,
			endVestingBlock: 0,
			unstakingFrozenTime: 0,
			rewardFundAmount: 0,
		}, 0)).to.be.revertedWith("StakePoolController: invalid pair");

	})
	it('create invalid lockRewardPercent', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await expect(stakePoolController.connect(other).create(version, v2Pair.pair.address, 3600 * 48, {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 101,
			startVestingBlock: 0,
			endVestingBlock: 0,
			unstakingFrozenTime: 0,
			rewardFundAmount: 0,
		}, 0)).to.be.revertedWith("StakePool: invalid lockRewardPercent");
	})
	it('create invalid rewardToken balance', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await expect(stakePoolController.connect(other).create(version, v2Pair.pair.address, 3600 * 48, {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
			rewardFundAmount: 1000000,
		}, 0)).to.be.revertedWith("StakePoolController: Not enough rewardFundAmount");
	})
	it('create invalid endVestingBlock', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await v2Pair.token0.approve(stakePoolController.address, maxUint256);
		await expect(stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 101,
			endVestingBlock: latestBlockNumber + 100,
			unstakingFrozenTime: 0,
			rewardFundAmount: 10,
		}, 0)).to.be.revertedWith("StakePool: startVestingBlock > endVestingBlock");
	})
	it('create invalid rewardRebaser', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await v2Pair.token0.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: wallet.address,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
			rewardFundAmount: 10,
		};
		await expect(stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, poolRewardInfo, 0)).to.be.revertedWith("StakePool: Invalid reward rebaser");
		await stakePoolController.setWhitelistRewardRebaser(wallet.address, true);
		await stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, poolRewardInfo, 0);

	})
	it('create invalid delayTimeLock', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await v2Pair.token0.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
			rewardFundAmount: 10,
		};
		await expect(stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600, poolRewardInfo, 0)).to.be.revertedWith("Timelock::setDelay: Delay must exceed minimum delay.");
		await stakePoolController.setWhitelistRewardRebaser(wallet.address, true);
		await stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, poolRewardInfo, 0);

	})
	it('create invalid rewardMultiplier', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await v2Pair.token0.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: wallet.address,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
			rewardFundAmount: 10,
		};
		await expect(stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, poolRewardInfo, 0)).to.be.revertedWith("StakePool: Invalid reward multiplier");
		await stakePoolController.setWhitelistRewardMultiplier(wallet.address, true);
		await stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, poolRewardInfo, 0);
	})
	it('create valid pool', async () => {
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await v2Pair.token0.approve(stakePoolController.address, maxUint256);
		let poolRewardInfo = {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
			rewardFundAmount: 10,
		};
		await expect(stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, poolRewardInfo, 0))
			.to.emit(stakePoolController, 'MasterCreated');


	})
	it('create valid pool pay fee', async () => {
		const feeToken = await new Erc20Factory(wallet).deploy(toWei(10000));
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await v2Pair.token0.approve(stakePoolController.address, maxUint256);
		await stakePoolController.setFeeAmount(toWei(1))
		await stakePoolController.setFeeCollector(other.address)
		await stakePoolController.setFeeToken(feeToken.address);
		await feeToken.approve(stakePoolController.address, toWei(1))
		let poolRewardInfo = {
			rewardToken: v2Pair.token0.address,
			rewardRebaser: ADDRESS_ZERO,
			rewardMultiplier: ADDRESS_ZERO,
			startBlock: latestBlockNumber + 1,
			endRewardBlock: latestBlockNumber + 10,
			rewardPerBlock: toWei(1.1),
			lockRewardPercent: 50,
			startVestingBlock: latestBlockNumber + 100,
			endVestingBlock: latestBlockNumber + 101,
			unstakingFrozenTime: 0,
			rewardFundAmount: 10,
		};
		await expect(() => stakePoolController.connect(wallet).create(version, v2Pair.pair.address, 3600 * 48, poolRewardInfo, 0))
			.to.changeTokenBalance(feeToken, other, toWei(1));
	})
})
