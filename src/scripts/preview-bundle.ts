import { getEnv } from "../config/env.js";
import { buildJitoBundlePreview } from "../jito/bundle-builder.js";
import { JitoRpcClient } from "../jito/jito-rpc-client.js";
import { chooseTipAccount, fetchTipAccounts } from "../jito/tip-accounts.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { sampleRecentPrioritizationFees } from "../tips/recent-fee-sampler.js";
import { calculateJitoTip } from "../tips/tip-engine.js";
import { simulateSignedTransactions } from "../transactions/simulation.js";
import { defaultCommitment } from "../types/solana.js";

async function main(): Promise<void> {
  const env = getEnv();
  const connection = createConnection();
  const wallet = loadWalletKeypair();
  const currentSlot = await connection.getSlot(defaultCommitment);
  const jitoClient = new JitoRpcClient({
    blockEngineUrl: env.JITO_BLOCK_ENGINE_URL
  });
  const tipAccounts = await fetchTipAccounts(jitoClient);
  const selectedTipAccount = chooseTipAccount(tipAccounts, currentSlot);
  const recentFeeSummary = await sampleRecentPrioritizationFees(connection);
  const slotsUntilLeader = 8;
  const tipDecision = calculateJitoTip({
    recentFeeSummary,
    slotsUntilLeader,
    minTipLamports: env.MIN_JITO_TIP_LAMPORTS,
    maxTipLamports: env.MAX_JITO_TIP_LAMPORTS,
    urgencyMultiplier: env.TIP_URGENCY_MULTIPLIER
  });
  const bundle = await buildJitoBundlePreview({
    connection,
    wallet,
    tipAccount: selectedTipAccount,
    tipLamports: tipDecision.suggested_tip_lamports,
    priorityFeeMicroLamports: env.PRIORITY_FEE_MICRO_LAMPORTS,
    computeUnitLimit: env.COMPUTE_UNIT_LIMIT,
    bundleLayout: env.BUNDLE_LAYOUT
  });
  const preSubmitSimulation = await simulateSignedTransactions({
    connection,
    transactions: bundle.transactions
  });

  console.log(
    JSON.stringify(
      {
        network: env.NETWORK,
        block_engine_bundle_url: jitoClient.bundlesUrl,
        current_slot: currentSlot,
        slots_until_leader: slotsUntilLeader,
        recent_fee_summary: recentFeeSummary,
        tip_decision: tipDecision,
        pre_submit_simulation: preSubmitSimulation,
        simulation_passed: preSubmitSimulation.every((result) => result.ok),
        bundle_preview: {
          bundle_layout: bundle.bundleLayout,
          transaction_signature: bundle.signature,
          workload_transaction_signature: bundle.workloadTransactionSignature,
          tip_transaction_signature: bundle.tipTransactionSignature,
          transaction_signatures: bundle.transactionSignatures,
          fee_payer: bundle.feePayer,
          self_transfer_recipient: bundle.selfTransferRecipient,
          self_transfer_lamports: bundle.selfTransferLamports,
          tip_account: bundle.tipAccount,
          tip_lamports: bundle.tipLamports,
          priority_fee_micro_lamports: bundle.priorityFeeMicroLamports,
          compute_unit_limit: bundle.computeUnitLimit,
          blockhash: bundle.blockhash,
          last_valid_block_height: bundle.lastValidBlockHeight,
          serialized_transaction_byte_length: bundle.serializedTransaction.byteLength,
          serialized_transaction_base64_prefix: bundle.serializedTransaction.base64Prefix,
          serialized_transaction_byte_lengths: bundle.serializedTransactionByteLengths,
          bundle_transaction_count: bundle.bundleTransactionCount,
          transactions: bundle.transactions.map((transaction) => ({
            role: transaction.role,
            signature: transaction.signature,
            serialized_transaction_byte_length: transaction.serializedTransaction.byteLength,
            serialized_transaction_base64_prefix: transaction.serializedTransaction.base64Prefix
          }))
        }
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bundle preview error";
  console.error(`Bundle preview failed: ${message}`);
  console.error("No bundle or transaction was submitted.");
  process.exitCode = 1;
});
