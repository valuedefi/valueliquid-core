import {expect} from "./chai-setup";
import {Contract} from "ethers";

import {mineBlock, toWei} from "./shared/utilities";
import {v2Fixture} from "./shared/fixtures";

import {encodePrice} from "./shared/common";
import {ethers} from "hardhat";
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {ExampleOracleSimpleFactory, ValueLiquidPairFactory} from "../../typechain";
import { keccak256 } from "ethers/lib/utils";

const overrides = {};

const token0Amount = toWei(5);
const token1Amount = toWei(10);

describe("ExampleOracleSimple", () => {
  let signers: SignerWithAddress[];
  let wallet: SignerWithAddress;

  let token0: Contract;
  let token1: Contract;
  let pair: Contract;
  let exampleOracleSimple: Contract;

  async function addLiquidity() {
    await token0.transfer(pair.address, token0Amount);
    await token1.transfer(pair.address, token1Amount);
    await pair.mint(wallet.address, overrides);
  }

  beforeEach(async function () {
    signers = await ethers.getSigners();
    wallet = signers[0];
  });

  describe("same weight", async () => {
    beforeEach(async () => {
      const uniswapPairBytecode = new ValueLiquidPairFactory(wallet).bytecode;
      console.log(keccak256(uniswapPairBytecode));

      const fixture = await v2Fixture(wallet, true);

      token0 = fixture.token0;
      token1 = fixture.token1;
      pair = fixture.pair;
      await addLiquidity();

      exampleOracleSimple = await new ExampleOracleSimpleFactory(wallet).deploy(fixture.factoryV2.address, token0.address, token1.address, 50, 3);
    });

    it("update", async () => {
      const blockTimestamp = (await pair.getReserves())[2];
      await mineBlock(ethers, blockTimestamp + 60 * 60 * 23);
      await expect(exampleOracleSimple.update(overrides)).to.be.reverted;
      await mineBlock(ethers, blockTimestamp + 60 * 60 * 24);
      await exampleOracleSimple.update(overrides);

      const expectedPrice = encodePrice(token0Amount, token1Amount);

      expect(await exampleOracleSimple.price0Average()).to.eq(expectedPrice[0]);
      expect(await exampleOracleSimple.price1Average()).to.eq(expectedPrice[1]);

      expect(await exampleOracleSimple.consult(token0.address, token0Amount)).to.eq(token1Amount);
      expect(await exampleOracleSimple.consult(token1.address, token1Amount)).to.eq(token0Amount);
    });
  });

  describe("different weight", async () => {
    let tokenWeight0: number;

    beforeEach(async () => {
      const fixture = await v2Fixture(wallet, false);

      token0 = fixture.token0;
      token1 = fixture.token1;
      pair = fixture.pair;
      tokenWeight0 = fixture.tokenWeight0;
      await addLiquidity();

      exampleOracleSimple = await new ExampleOracleSimpleFactory(wallet).deploy(
        fixture.factoryV2.address,
        token0.address,
        token1.address,
        fixture.tokenWeight0,
        4
      );
    });

    it("update", async () => {
      const blockTimestamp = (await pair.getReserves())[2];
      await mineBlock(ethers, blockTimestamp + 60 * 60 * 23);
      await expect(exampleOracleSimple.update(overrides)).to.be.reverted;
      await mineBlock(ethers, blockTimestamp + 60 * 60 * 24);
      await exampleOracleSimple.update(overrides);

      const expectedPrice = encodePrice(token0Amount, token1Amount, tokenWeight0);

      expect(await exampleOracleSimple.price0Average()).to.eq(expectedPrice[0]);
      expect(await exampleOracleSimple.price1Average()).to.eq(expectedPrice[1]);

      expect(await exampleOracleSimple.consult(token0.address, token0Amount)).to.eq(token1Amount.mul(tokenWeight0).div(100 - tokenWeight0));
      expect(await exampleOracleSimple.consult(token1.address, token1Amount)).to.eq(token0Amount.mul(100 - tokenWeight0).div(tokenWeight0));
    });
  });
});
