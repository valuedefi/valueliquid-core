require('dotenv').config()
const HDWalletProvider = require('@truffle/hdwallet-provider')
const mnemonic = process.env.MNEMONIC
const INFURA_API_KEY = process.env.INFURA_API_KEY

module.exports = {
    plugins: [
        'truffle-plugin-verify'
    ],
    api_keys: {
        etherscan: `${process.env.ETHERSCAN_API_KEY}`
    },
    networks: {
        development: {
            host: 'localhost', // Localhost (default: none)
            port: 8545, // Standard Ethereum port (default: none)
            network_id: '*', // Any network (default: none)
            gas: 10000000
        },
        coverage: {
            host: 'localhost',
            network_id: '*',
            port: 8555,
            gas: 0xfffffffffff,
            gasPrice: 0x01
        },
        ropsten: {
            provider: () => {
                return new HDWalletProvider(mnemonic, `https://ropsten.infura.io/v3/${INFURA_API_KEY}`)
            },
            skipDryRun: true,
            network_id: 3
        },
        mainnet: {
            provider: () => {
                return new HDWalletProvider(mnemonic, `https://mainnet.infura.io/v3/${INFURA_API_KEY}`)
            },
            skipDryRun: true,
            network_id: 1
        },
        rinkeby: {
            provider: () => {
                return new HDWalletProvider(mnemonic, `https://rinkeby.infura.io/v3/${INFURA_API_KEY}`)
            },
            skipDryRun: true,
            network_id: 4
        },

        kovan: {
            provider: () => {
                return new HDWalletProvider(mnemonic, `https://kovan.infura.io/v3/${INFURA_API_KEY}`)
            },
            skipDryRun: true,
            network_id: 42
        }
    },

    // Configure your compilers
    compilers: {
        solc: {
            version: '0.6.12',
            settings: { // See the solidity docs for advice about optimization and evmVersion
                optimizer: {
                    enabled: true,
                    runs: 200
                },
                evmVersion: 'istanbul'
            }
        }
    }
}
