import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { logger } from "../logger.js";
import { defaultCommitment, formatSol } from "../types/solana.js";

async function main(): Promise<void> {
  const connection = createConnection();
  const slot = await connection.getSlot(defaultCommitment);
  const blockhash = await connection.getLatestBlockhash(defaultCommitment);

  logger.info(
    {
      slot,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight
    },
    "RPC check succeeded"
  );

  try {
    const wallet = loadWalletKeypair();
    const lamports = await connection.getBalance(wallet.publicKey, defaultCommitment);

    logger.info(
      {
        publicKey: wallet.publicKey.toBase58(),
        balanceSol: formatSol(lamports),
        lamports
      },
      "Wallet keypair loaded"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown wallet loading error";
    logger.warn({ error: message }, "Wallet keypair not loaded");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown RPC check error";
  logger.error({ error: message }, "RPC check failed");
  process.exitCode = 1;
});
