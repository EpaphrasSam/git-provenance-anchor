import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

// Official addresses on Ethereum Sepolia.
const ARBITRUM_INBOX = "0xaAe29B0366299461418F5324a79Afc425BE5ae21";
const OP_L1_STANDARD_BRIDGE = "0xFBb0621E0B23b5478B630BD55a5f21f67730B0F1";

const inboxAbi = ["function depositEth() external payable returns (uint256)"];
const opBridgeAbi = [
  "function depositETH(uint32 _minGasLimit, bytes calldata _extraData) external payable",
];

async function main() {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY missing from .env");

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC, 11155111);
  const wallet = new ethers.Wallet(key, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`address   ${wallet.address}`);
  console.log(`sepolia   ${ethers.formatEther(balance)} ETH`);

  // Leave headroom for two L1 txs.
  const perBridge = ethers.parseEther("0.018");
  if (balance < perBridge * 2n + ethers.parseEther("0.006")) {
    throw new Error("Insufficient Sepolia balance to bridge both networks safely");
  }

  const inbox = new ethers.Contract(ARBITRUM_INBOX, inboxAbi, wallet);
  console.log("bridging to Arbitrum Sepolia...");
  const arbTx = await inbox.depositEth({ value: perBridge });
  console.log(`arbitrum tx  ${arbTx.hash}`);
  await arbTx.wait();
  console.log("arbitrum deposit confirmed on Sepolia");

  const bridge = new ethers.Contract(OP_L1_STANDARD_BRIDGE, opBridgeAbi, wallet);
  console.log("bridging to OP Sepolia...");
  const opTx = await bridge.depositETH(200000, "0x", { value: perBridge });
  console.log(`optimism tx  ${opTx.hash}`);
  await opTx.wait();
  console.log("optimism deposit confirmed on Sepolia");

  const remaining = await provider.getBalance(wallet.address);
  console.log(`sepolia left ${ethers.formatEther(remaining)} ETH`);
  console.log("L2 credits usually appear within a few minutes.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
