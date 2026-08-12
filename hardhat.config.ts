import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-deploy";
import * as dotenv from "dotenv";

dotenv.config();

const accounts = process.env.ANCHOR_DEPLOYER_KEY ? [process.env.ANCHOR_DEPLOYER_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  // Pinned with the plugins: the plugin validates zksolc against a remote allow-list,
  // so bumping either without the other can break compile without a source change.
  zksolc: {
    version: "1.5.15",
    settings: {
      optimizer: { enabled: true },
      codegen: "yul",
    },
  },
  networks: {
    // Keep the in-process chain on EVM so the existing Hardhat test suite is unchanged.
    hardhat: {
      zksync: false,
    },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts,
      chainId: 421614,
      zksync: false,
    },
    opSepolia: {
      url: process.env.OP_SEPOLIA_RPC_URL || "https://sepolia.optimism.io",
      accounts,
      chainId: 11155420,
      zksync: false,
    },
    zkSyncSepolia: {
      url: process.env.ZKSYNC_SEPOLIA_RPC_URL || "https://sepolia.era.zksync.dev",
      ethNetwork: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts,
      chainId: 300,
      zksync: true,
    },
    arbitrumOne: {
      url: process.env.ARBITRUM_ONE_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts,
      chainId: 42161,
      zksync: false,
    },
    opMainnet: {
      url: process.env.OP_MAINNET_RPC_URL || "https://mainnet.optimism.io",
      accounts,
      chainId: 10,
      zksync: false,
    },
    zkSyncEra: {
      url: process.env.ZKSYNC_ERA_RPC_URL || "https://mainnet.era.zksync.io",
      ethNetwork: process.env.ETHEREUM_RPC_URL || "https://ethereum.publicnode.com",
      accounts,
      chainId: 324,
      zksync: true,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};

export default config;
