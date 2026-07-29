/**
 * Bridge Sepolia ETH to zkSync Era Sepolia via the official L1 deposit path.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/bridge-zksync.ts
 *   npx ts-node --transpile-only scripts/bridge-zksync.ts --amount 0.01
 */
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { Provider, Wallet, utils } from "zksync-ethers";

dotenv.config();

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY missing from .env");

  const amount = ethers.parseEther(argValue("--amount") ?? "0.01");
  const l1Url = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  const l2Url = process.env.ZKSYNC_SEPOLIA_RPC_URL ?? "https://sepolia.era.zksync.dev";

  const l1Provider = new ethers.JsonRpcProvider(l1Url, 11155111);
  const l2Provider = new Provider(l2Url);
  const wallet = new Wallet(key, l2Provider, l1Provider);

  const l1Balance = await l1Provider.getBalance(wallet.address);
  const l2Before = await l2Provider.getBalance(wallet.address);

  console.log(`address     ${wallet.address}`);
  console.log(`sepolia L1  ${ethers.formatEther(l1Balance)} ETH`);
  console.log(`zkSync L2   ${ethers.formatEther(l2Before)} ETH`);
  console.log(`bridging    ${ethers.formatEther(amount)} ETH`);

  if (l1Balance < amount + ethers.parseEther("0.004")) {
    throw new Error("Insufficient Sepolia balance for the deposit plus L1 gas");
  }

  const deposit = await wallet.deposit({
    token: utils.ETH_ADDRESS,
    amount,
    approveERC20: false,
  });
  console.log(`l1 tx       ${deposit.hash}`);
  console.log("waiting for L1 confirmation...");
  await deposit.wait();

  // Credits often appear on L2 before waitFinalize resolves; poll balance instead.
  console.log("waiting for L2 credit...");
  const deadline = Date.now() + 15 * 60 * 1000;
  let l2After = l2Before;
  while (Date.now() < deadline) {
    l2After = await l2Provider.getBalance(wallet.address);
    if (l2After > l2Before) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }

  if (l2After <= l2Before) {
    throw new Error(
      `L2 balance did not increase within 15 minutes. Check https://sepolia.explorer.zksync.io/address/${wallet.address}`
    );
  }
  console.log(`zkSync L2   ${ethers.formatEther(l2After)} ETH`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
