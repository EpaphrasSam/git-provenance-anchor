/**
 * Bridge mainnet ETH from Optimism → zkSync Era via Orbiter Finance quote API.
 *
 * Dry-run (quote only):
 *   npx ts-node --transpile-only scripts/bridge-op-to-zksync.ts --amount 0.001
 *
 * Broadcast:
 *   npx ts-node --transpile-only scripts/bridge-op-to-zksync.ts --amount 0.001 --send
 */
import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const OP_CHAIN_ID = 10;
const ZK_CHAIN_ID = 324;
const NATIVE = "0x0000000000000000000000000000000000000000";
const OP_RPC = process.env.OPTIMISM_RPC_URL ?? "https://mainnet.optimism.io";
const ZK_RPC = process.env.ZKSYNC_MAINNET_RPC_URL ?? "https://mainnet.era.zksync.io";
const ORBITER_QUOTE = "https://openapi.orbiter.finance/quote";

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

type QuoteResult = {
  status: string;
  message?: string;
  result?: {
    steps: Array<{ action: string; tx: { to: string; data: string; value: string } }>;
    details: {
      sourceTokenAmount: string;
      destTokenAmount: string;
      minDestTokenAmount: string;
      sourceAmountUSD: string;
      destAmountUSD: string;
      makerAddress?: string;
    };
    fees: {
      withholdingFee: string;
      withholdingFeeUSD: string;
      totalFee: string;
    };
  };
};

async function quote(params: {
  amountWei: bigint;
  user: string;
  recipient: string;
}): Promise<QuoteResult> {
  const res = await fetch(ORBITER_QUOTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceChainId: String(OP_CHAIN_ID),
      destChainId: String(ZK_CHAIN_ID),
      sourceToken: NATIVE,
      destToken: NATIVE,
      amount: params.amountWei.toString(),
      userAddress: params.user,
      targetRecipient: params.recipient,
      slippage: 0.02,
    }),
  });
  const body = (await res.json()) as QuoteResult;
  if (body.status !== "success" || !body.result) {
    throw new Error(body.message ?? `Orbiter quote failed (HTTP ${res.status})`);
  }
  return body;
}

async function main(): Promise<void> {
  const key = process.env.ANCHOR_DEPLOYER_KEY;
  if (!key) throw new Error("ANCHOR_DEPLOYER_KEY missing from .env");

  const amountEth = argValue("--amount") ?? "0.001";
  const amountWei = ethers.parseEther(amountEth);
  const doSend = hasFlag("--send");

  const op = new ethers.JsonRpcProvider(OP_RPC, OP_CHAIN_ID);
  const zk = new ethers.JsonRpcProvider(ZK_RPC, ZK_CHAIN_ID);
  const wallet = new ethers.Wallet(key, op);

  const opBal = await op.getBalance(wallet.address);
  const zkBefore = await zk.getBalance(wallet.address);

  console.log(`address      ${wallet.address}`);
  console.log(`optimism     ${ethers.formatEther(opBal)} ETH`);
  console.log(`zkSync Era   ${ethers.formatEther(zkBefore)} ETH`);
  console.log(`request      ${amountEth} ETH  (${doSend ? "SEND" : "quote only"})`);

  const q = await quote({
    amountWei,
    user: wallet.address,
    recipient: wallet.address,
  });
  const { steps, details, fees } = q.result!;
  const bridgeStep = steps.find((s) => s.action === "bridge" && s.tx);
  if (!bridgeStep) throw new Error("Orbiter quote had no bridge tx step");

  console.log(`withholding  ${fees.withholdingFee} ETH (~$${fees.withholdingFeeUSD})`);
  console.log(
    `expect recv  ${ethers.formatEther(details.destTokenAmount)} ETH (~$${details.destAmountUSD})`
  );
  console.log(`min recv     ${ethers.formatEther(details.minDestTokenAmount)} ETH`);
  console.log(`tx.to        ${bridgeStep.tx.to}`);
  console.log(`tx.value     ${ethers.formatEther(bridgeStep.tx.value)} ETH`);

  if (opBal < amountWei + ethers.parseEther("0.00005")) {
    throw new Error("Insufficient Optimism balance for amount plus OP gas headroom");
  }

  if (!doSend) {
    console.log("Dry-run only. Re-run with --send to broadcast.");
    return;
  }

  const nonce = await op.getTransactionCount(wallet.address, "pending");
  const fee = await op.getFeeData();
  console.log(`nonce        ${nonce}`);
  const tx = await wallet.sendTransaction({
    to: bridgeStep.tx.to,
    data: bridgeStep.tx.data,
    value: BigInt(bridgeStep.tx.value),
    nonce,
    maxFeePerGas: fee.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
  });
  console.log(`op tx        ${tx.hash}`);
  console.log(`explorer     https://optimistic.etherscan.io/tx/${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Optimism tx failed: ${tx.hash}`);
  }
  console.log(`op confirmed block=${receipt.blockNumber}`);

  console.log("waiting for zkSync Era credit...");
  const deadline = Date.now() + 20 * 60 * 1000;
  let zkAfter = zkBefore;
  while (Date.now() < deadline) {
    zkAfter = await zk.getBalance(wallet.address);
    if (zkAfter > zkBefore) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }

  if (zkAfter <= zkBefore) {
    throw new Error(
      `zkSync balance did not increase within 20 minutes. Check https://explorer.zksync.io/address/${wallet.address}`
    );
  }

  const opLeft = await op.getBalance(wallet.address);
  console.log(`optimism     ${ethers.formatEther(opLeft)} ETH`);
  console.log(`zkSync Era   ${ethers.formatEther(zkAfter)} ETH (+${ethers.formatEther(zkAfter - zkBefore)})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
