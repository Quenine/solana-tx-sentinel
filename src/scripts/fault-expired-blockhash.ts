import { randomUUID } from "node:crypto";

import { getEnv } from "../config/env.js";
import type { FailureLogEntry } from "../failures/types.js";
import { appendFailureLog } from "../lifecycle/log-writer.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { injectExpiredBlockhashTransfer } from "../transactions/expired-blockhash-transfer.js";

function toLogEntry(runId: string, result: Awaited<ReturnType<typeof injectExpiredBlockhashTransfer>>): FailureLogEntry {
  return {
    run_id: runId,
    network: "devnet",
    mode: "fault_expired_blockhash",
    fee_payer: result.feePayer,
    recipient: result.recipient,
    lamports: result.lamports,
    original_blockhash: result.originalBlockhash,
    original_last_valid_block_height: result.originalLastValidBlockHeight,
    current_block_height_at_send: result.currentBlockHeightAtSend,
    attempted_at: new Date(result.attemptedAtMs).toISOString(),
    failure: result.failure,
    created_at: new Date().toISOString()
  };
}

async function main(): Promise<void> {
  const env = getEnv();

  if (env.NETWORK !== "devnet") {
    throw new Error(`Refusing to run expired-blockhash fault on ${env.NETWORK}. Set NETWORK=devnet to use this script.`);
  }

  const runId = randomUUID();
  const connection = createConnection();
  const wallet = loadWalletKeypair();

  const result = await injectExpiredBlockhashTransfer(connection, wallet, {
    onProgress: ({ currentBlockHeight, lastValidBlockHeight, remainingBlocks }) => {
      console.error(
        `Waiting for blockhash expiry: current=${currentBlockHeight} last_valid=${lastValidBlockHeight} remaining=${remainingBlocks}`
      );
    }
  });
  const entry = toLogEntry(runId, result);

  await appendFailureLog(entry);

  console.log(JSON.stringify(entry, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown expired-blockhash fault error";
  console.error(message);
  process.exitCode = 1;
});
