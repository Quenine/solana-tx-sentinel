import { randomUUID } from "node:crypto";

import { getEnv } from "../config/env.js";
import { appendLifecycleLog } from "../lifecycle/log-writer.js";
import { explorerUrl } from "../solana/cluster.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { sendAndTrackTransaction } from "../lifecycle/lifecycle-tracker.js";
import { buildSimpleSelfTransfer } from "../transactions/simple-transfer.js";
import type { LifecycleLogEntry, TransactionLifecycleResult } from "../lifecycle/types.js";

function toIsoTime(value: number | undefined): string | null {
  return value === undefined ? null : new Date(value).toISOString();
}

function toLogEntry(input: {
  runId: string;
  signature: string;
  explorerUrl: string;
  feePayer: string;
  recipient: string;
  lamports: number;
  blockhash: string;
  lastValidBlockHeight: number;
  lifecycle: TransactionLifecycleResult;
}): LifecycleLogEntry {
  return {
    run_id: input.runId,
    network: "devnet",
    mode: "normal_transfer",
    signature: input.signature,
    explorer_url: input.explorerUrl,
    fee_payer: input.feePayer,
    recipient: input.recipient,
    lamports: input.lamports,
    blockhash: input.blockhash,
    last_valid_block_height: input.lastValidBlockHeight,
    submitted_at: new Date(input.lifecycle.submittedAtMs).toISOString(),
    processed_at: toIsoTime(input.lifecycle.stages.processed.observedAtMs),
    confirmed_at: toIsoTime(input.lifecycle.stages.confirmed.observedAtMs),
    finalized_at: toIsoTime(input.lifecycle.stages.finalized.observedAtMs),
    processed_slot: input.lifecycle.stages.processed.slot ?? null,
    confirmed_slot: input.lifecycle.stages.confirmed.slot ?? null,
    finalized_slot: input.lifecycle.stages.finalized.slot ?? null,
    submitted_to_processed_ms: input.lifecycle.latencies.submittedToProcessedMs ?? null,
    processed_to_confirmed_ms: input.lifecycle.latencies.processedToConfirmedMs ?? null,
    confirmed_to_finalized_ms: input.lifecycle.latencies.confirmedToFinalizedMs ?? null,
    submitted_to_finalized_ms: input.lifecycle.latencies.submittedToFinalizedMs ?? null,
    failure: input.lifecycle.failure ?? null,
    created_at: new Date().toISOString()
  };
}

async function main(): Promise<void> {
  const runId = randomUUID();
  const env = getEnv();

  if (env.NETWORK !== "devnet") {
    throw new Error(`Refusing to send test transfer on ${env.NETWORK}. Set NETWORK=devnet to use this script.`);
  }

  const connection = createConnection();
  const wallet = loadWalletKeypair();
  const transfer = await buildSimpleSelfTransfer(connection, wallet);

  const lifecycle = await sendAndTrackTransaction(connection, {
    serializedTransaction: transfer.serializedTransaction
  });
  const signature = lifecycle.signature;
  const url = explorerUrl(signature, env.NETWORK);
  const logEntry = toLogEntry({
    runId,
    signature,
    explorerUrl: url,
    feePayer: transfer.feePayer,
    recipient: transfer.recipient,
    lamports: transfer.lamports,
    blockhash: transfer.blockhash,
    lastValidBlockHeight: transfer.lastValidBlockHeight,
    lifecycle
  });

  await appendLifecycleLog(logEntry);

  console.log(JSON.stringify(logEntry, null, 2));
  console.log(`Explorer: ${url}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown test transfer error";
  console.error(message);
  process.exitCode = 1;
});
