import {expect} from "./chai-setup";
import {BigNumber, Contract} from "ethers";

import {expandTo18Decimals, getAmountIn, getAmountOut, getApprovalDigest, MaxUint256, MINIMUM_LIQUIDITY} from "./shared/common";

import {pairFixture, v2Fixture} from "./shared/fixtures";

import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {ethers} from "hardhat";
import {fromWei, toWei} from "./shared/utilities";
import {Erc20Factory, ExampleFlashSwapFactory, ValueLiquidPairFactory} from "../../typechain";
import {defaultAbiCoder} from "ethers/lib/utils";

const overrides = {
  gasPrice: 0,
};

describe("ExampleFlashSwap", () => {
  let signers: SignerWithAddress[];
  let wallet: SignerWithAddress;

  let flashSwapExample: Contract;
  let tokenMain: Contract;
  let tokenMainPartner: Contract;
  let pair: Contract;
  let pairArbitrage: Contract;

  beforeEach(async function () {
    signers = await ethers.getSigners();
    wallet = signers[0];
    const fixture = await v2Fixture(wallet, true);

    tokenMain = fixture.token0;
    tokenMainPartner = fixture.token1;
    pair = fixture.pair;

    // make a Main<>Partner pair
    await fixture.factoryV2.createPair(tokenMain.address, tokenMainPartner.address, 50, 6);
    let pairAddress = await fixture.factoryV2.getPair(tokenMain.address, tokenMainPartner.address, 50, 6);
    pairArbitrage = ValueLiquidPairFactory.connect(pairAddress, wallet);

    flashSwapExample = await new ExampleFlashSwapFactory(wallet).deploy(
      fixture.factoryV2.address,
      fixture.formula.address,
      fixture.router.address,
      tokenMain.address
    );
  });

  const addLiquidity = async (tokenMainAmount: BigNumber, tokenPartnerAmount: BigNumber, pair: Contract) => {
    await tokenMain.transfer(pair.address, tokenMainAmount);
    await tokenMainPartner.transfer(pair.address, tokenPartnerAmount);
    await pair.mint(wallet.address, overrides);
  };

  it("uniswapV2Call:0", async () => {
    // add liquidity to V1 at a rate of 1 ETH / 200 X
    const mainPartnerAmountV1 = expandTo18Decimals(2000);
    const mainAmountV1 = expandTo18Decimals(10);
    await addLiquidity(mainAmountV1, mainPartnerAmountV1, pairArbitrage);

    // add liquidity to V2 at a rate of 1 ETH / 100 X
    const mainPartnerAmountV2 = expandTo18Decimals(1000);
    const mainAmountV2 = expandTo18Decimals(10);
    await addLiquidity(mainAmountV2, mainPartnerAmountV2, pair);

    const balanceBefore = await tokenMainPartner.balanceOf(wallet.address);

    // now, execute arbitrage via uniswapV2Call:
    // receive 1 ETH from V2, get as much X from V1 as we can, repay V2 with minimum X, keep the rest!
    const arbitrageAmount = expandTo18Decimals(1);
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const mainPairToken0 = await pair.token0();
    const amount0 = mainPairToken0 === tokenMainPartner.address ? toWei(0) : arbitrageAmount;
    const amount1 = mainPairToken0 === tokenMainPartner.address ? arbitrageAmount : toWei(0);
    await pair.swap(amount0, amount1, flashSwapExample.address, defaultAbiCoder.encode(["uint"], [toWei(1)]), overrides);

    const balanceAfter = await tokenMainPartner.balanceOf(wallet.address);
    const profit = balanceAfter.sub(balanceBefore).div(expandTo18Decimals(1));
    const reservesV1 = [await tokenMainPartner.balanceOf(pairArbitrage.address), await tokenMain.balanceOf(pairArbitrage.address)];
    const priceV1 = reservesV1[0].div(reservesV1[1]);
    const reservesV2 = (await pair.getReserves()).slice(0, 2);
    const priceV2 = mainPairToken0 === tokenMainPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0]);

    expect(profit.toString()).to.eq("69"); // our profit is ~69 tokens
    expect(priceV1.toString()).to.eq("165"); // we pushed the v1 price down to ~165
    expect(priceV2.toString()).to.eq("123"); // we pushed the v2 price up to ~123
  });

  it("uniswapV2Call:1", async () => {
    // add liquidity to V1 at a rate of 1 ETH / 100 X
    const mainPartnerAmountV1 = expandTo18Decimals(1000);
    const mainAmountV1 = expandTo18Decimals(10);
    await addLiquidity(mainAmountV1, mainPartnerAmountV1, pairArbitrage);

    // add liquidity to V2 at a rate of 1 ETH / 200 X
    const mainPartnerAmountV2 = expandTo18Decimals(2000);
    const mainAmountV2 = expandTo18Decimals(10);
    await addLiquidity(mainAmountV2, mainPartnerAmountV2, pair);

    const balanceBefore = await tokenMain.balanceOf(wallet.address);

    // now, execute arbitrage via uniswapV2Call:
    // receive 200 X from V2, get as much ETH from V1 as we can, repay V2 with minimum ETH, keep the rest!
    const arbitrageAmount = expandTo18Decimals(200);
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const mainPairToken0 = await pair.token0();
    const amount0 = mainPairToken0 === tokenMainPartner.address ? arbitrageAmount : toWei(0);
    const amount1 = mainPairToken0 === tokenMainPartner.address ? toWei(0) : arbitrageAmount;
    await pair.swap(amount0, amount1, flashSwapExample.address, defaultAbiCoder.encode(["uint"], [toWei(1)]), overrides);

    const balanceAfter = await tokenMain.balanceOf(wallet.address);
    const profit = balanceAfter.sub(balanceBefore);
    const reservesV1 = [await tokenMainPartner.balanceOf(pairArbitrage.address), await tokenMain.balanceOf(pairArbitrage.address)];
    const priceV1 = reservesV1[0].div(reservesV1[1]);
    const reservesV2 = (await pair.getReserves()).slice(0, 2);
    const priceV2 = mainPairToken0 === tokenMainPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0]);

    expect(fromWei(profit)).to.eq("0.543870517123609734"); // our profit is ~.5 ETH
    expect(priceV1.toString()).to.eq("143"); // we pushed the v1 price up to ~143
    expect(priceV2.toString()).to.eq("161"); // we pushed the v2 price down to ~161
  });
});
