import { randomUUID } from "node:crypto";

import type { Connection } from "@solana/web3.js";

import { getEnv } from "../config/env.js";
import {
  appendControlledJitoBundleFailureLog,
  classifyControlledBundleFailure,
  toControlledLifecycleLog
} from "../evidence/failure-evidence.js";
import { buildJitoBundlePreview } from "../jito/bundle-builder.js";
import { waitForBundleStatus } from "../jito/bundle-status.js";
import { JitoRpcClient } from "../jito/jito-rpc-client.js";
import { chooseTipAccount, fetchTipAccounts } from "../jito/tip-accounts.js";
import { trackBundleSignatures } from "../lifecycle/multi-signature-tracker.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { sampleRecentPrioritizationFees } from "../tips/recent-fee-sampler.js";
import { calculateJitoTip } from "../tips/tip-engine.js";
import { simulateSignedTransactions } from "../transactions/simulation.js";
import { defaultCommitment } from "../types/solana.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRpcSendDisabled<T>(connection: Connection, operation: () => Promise<T>): Promise<T> {
  const originalSendRawTransaction = connection.sendRawTransaction;
  const originalSendTransaction = connection.sendTransaction;
  const fail = (): never => {
    throw new Error("RPC transaction send is disabled in Jito bundle fault mode. Use Jito sendBundle only.");
  };

  connection.sendRawTransaction = fail as Connection["sendRawTransaction"];
  connection.sendTransaction = fail as Connection["sendTransaction"];

  try {
    return await operation();
  } finally {
    connection.sendRawTransaction = originalSendRawTransaction;
    connection.sendTransaction = originalSendTransaction;
  }
}

async function waitForBlockhashExpiry(connection: Connection, lastValidBlockHeight: number): Promise<number> {
  let currentBlockHeight = await connection.getBlockHeight(defaultCommitment);

  while (currentBlockHeight <= lastValidBlockHeight) {
    console.error(`[expiry] current_block_height=${currentBlockHeight} last_valid_block_height=${lastValidBlockHeight}`);
    await sleep(1_500);
    currentBlockHeight = await connection.getBlockHeight(defaultCommitment);
  }

  return currentBlockHeight;
}

async function main(): Promise<void> {
  const env = getEnv();
  const runId = randomUUID();
  const connection = createConnection();
  const wallet = loadWalletKeypair();
  const jitoClient = new JitoRpcClient({
    blockEngineUrl: env.JITO_BLOCK_ENGINE_URL
  });
  const currentSlot = await connection.getSlot(defaultCommitment);
  const tipAccounts = await fetchTipAccounts(jitoClient);
  const tipAccount = chooseTipAccount(tipAccounts, currentSlot);
  const recentFeeSummary = await sampleRecentPrioritizationFees(connection);
  const tipDecision = calculateJitoTip({
    recentFeeSummary,
    slotsUntilLeader: 8,
    minTipLamports: env.MIN_JITO_TIP_LAMPORTS,
    maxTipLamports: env.MAX_JITO_TIP_LAMPORTS,
    urgencyMultiplier: env.TIP_URGENCY_MULTIPLIER
  });
  const bundle = await buildJitoBundlePreview({
    connection,
    wallet,
    tipAccount,
    tipLamports: tipDecision.suggested_tip_lamports,
    priorityFeeMicroLamports: env.PRIORITY_FEE_MICRO_LAMPORTS,
    computeUnitLimit: env.COMPUTE_UNIT_LIMIT,
    bundleLayout: "combined_tip_instruction"
  });
  const currentBlockHeightAtSubmit = await waitForBlockhashExpiry(connection, bundle.lastValidBlockHeight);
  const currentSlotAtSubmit = await connection.getSlot(defaultCommitment);
  const preSubmitSimulation = await simulateSignedTransactions({
    connection,
    transactions: bundle.transactions
  });
  const simulationPassed = preSubmitSimulation.every((result) => result.ok);
  const submittedAt = new Date().toISOString();
  let bundleId: string | null = null;
  let bundleStatus = null;
  let sendError: unknown;

  await withRpcSendDisabled(connection, async () => {
    try {
      const result = await jitoClient.sendBundle(bundle.serializedTransactions.map((transaction) => transaction.base64));
      bundleId = result.bundle_id;
      bundleStatus = await waitForBundleStatus(jitoClient, result.bundle_id, {
        timeoutMs: env.BUNDLE_STATUS_TIMEOUT_MS,
        pollIntervalMs: env.BUNDLE_STATUS_POLL_INTERVAL_MS,
        stopOnFirstInvalid: env.STOP_ON_FIRST_INVALID
      });
    } catch (error) {
      sendError = error;
    }
  });

  const trackedSignatures = await trackBundleSignatures({
    connection,
    submittedAtMs: Date.parse(submittedAt),
    signatures: [{ role: "combined", signature: bundle.signature }],
    timeoutMs: env.BUNDLE_STATUS_TIMEOUT_MS
  });
  const lifecycle = toControlledLifecycleLog(trackedSignatures[0]);
  const failure = classifyControlledBundleFailure({
    scenario: "expired_blockhash_bundle",
    simulation: preSubmitSimulation,
    bundleStatus,
    lifecycle,
    sendError
  });
  const logEntry = {
    run_id: runId,
    network: env.NETWORK,
    mode: "jito_bundle_failure" as const,
    failure_scenario: "expired_blockhash_bundle" as const,
    submission_path: "jito_only" as const,
    rpc_rebroadcast: false as const,
    bundle_id: bundleId,
    transaction_signature: bundle.signature,
    bundle_status: bundleStatus,
    lifecycle,
    submitted_at: submittedAt,
    blockhash: bundle.blockhash,
    last_valid_block_height: bundle.lastValidBlockHeight,
    current_block_height_at_submit: currentBlockHeightAtSubmit,
    current_slot_at_submit: currentSlotAtSubmit,
    tip_account: bundle.tipAccount,
    tip_lamports: bundle.tipLamports,
    priority_fee_micro_lamports: bundle.priorityFeeMicroLamports,
    compute_unit_limit: bundle.computeUnitLimit,
    pre_submit_simulation: preSubmitSimulation,
    simulation_passed: simulationPassed,
    failure,
    created_at: new Date().toISOString()
  };

  await appendControlledJitoBundleFailureLog(logEntry);
  console.log(JSON.stringify(logEntry, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown expired blockhash bundle fault error";
  console.error(`Expired blockhash bundle fault failed: ${message}`);
  process.exitCode = 1;
});
