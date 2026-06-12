import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { getEnv } from "../config/env.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { defaultCommitment, formatSol } from "../types/solana.js";

function parseSolAmount(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }

  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Airdrop amount must be a positive number of SOL.");
  }

  return amount;
}

async function main(): Promise<void> {
  const env = getEnv();

  if (env.NETWORK !== "devnet") {
    console.error(`This script only requests Solana devnet SOL. Current network is ${env.NETWORK}.`);
    process.exitCode = 1;
    return;
  }

  const amountSol = parseSolAmount(process.argv[2]);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  const connection = createConnection();
  const wallet = loadWalletKeypair();

  const before = await connection.getBalance(wallet.publicKey, defaultCommitment);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance before: ${formatSol(before)} SOL`);

  const signature = await connection.requestAirdrop(wallet.publicKey, lamports);
  const latestBlockhash = await connection.getLatestBlockhash(defaultCommitment);

  await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    },
    defaultCommitment
  );

  const after = await connection.getBalance(wallet.publicKey, defaultCommitment);
  console.log(`Airdrop signature: ${signature}`);
  console.log(`Balance after: ${formatSol(after)} SOL`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown devnet airdrop error";

  console.error(message);

  if (/airdrop|rate|limit|429|faucet/i.test(message)) {
    console.error("Devnet faucet requests are rate-limited. Wait and retry, or fund the wallet from another faucet.");
  }

  process.exitCode = 1;
});
