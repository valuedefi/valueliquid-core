<p align=center>
<img width="128px" src="https://assets.coingecko.com/coins/images/12525/small/value_logo_-_500x500.png" alt="Value logo"/>
</p>

<h1 align=center><code>Value Liquid Farm-as-a-service Pool</code></h1>

## Motivation ##

<b>Value Liquid Phase 3.5</b> will serve as one of our most advanced and significant achievements in the DeFi space, ValueDefi will stand out as a Farms as a Service (FaaS) solution for all liquidity mining programs with these improvements:
- Internal proxy of Balancer will be replaced by an external router (like Uniswap), which could result in up to 70% cheaper gas fees for users.
- Users will have the ability to create farming pools from a simple frontend UI, meaning LPs of the farming pool will receive farming token emissions immediately after providing the liquidity to the pool.

## Deployment Guide

- Deploy FaaSPoolCreator
- Set Bpool Creator in bFactory
- Call new pool
- Verify contract with bFactory address is contructor parameter.
- Transfer BindToken to PoolContract
- Call finalize ( _bindTokens, _bindDenorms, _initPoolSupply)

```javascript
// 0x8b79f4da1bbdbe05ca4331a1671095f45793cde9 Faas Pool WETH, VALUE
// SEND 10 USDC TO CONTRACT
// SEND 2 VALUE TO CONTRACT
_bindTokens = ["0xbcf46e6d5e46d222ce5efef96c323dac6e3c6a78","0x249a176725a7e965e9f8d3aed48cb74fd27bb4e8"], // USDC,VALUE
_bindDenorms = [5000000000000000000,5000000000000000000] // 50/50
_swapFee = 3000000000000000 // 0.3%
_initPoolSupply = 100000000000000000000
```

<p align=center>⊙</p>
