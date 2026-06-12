import type { Connection, Keypair } from "@solana/web3.js";

import { appendAgentDecision, toDecisionLogEntry } from "../agent/decision-log.js";
import { localFailureDecisionAgent } from "../agent/local-agent.js";
import type { FailureDecisionInput } from "../agent/types.js";
import { classifyFailure } from "../failures/classifier.js";
import { sendAndTrackTransaction } from "../lifecycle/lifecycle-tracker.js";
import { explorerUrl } from "../solana/cluster.js";
import { injectExpiredBlockhashTransfer } from "../transactions/expired-blockhash-transfer.js";
import { buildSimpleSelfTransfer } from "../transactions/simple-transfer.js";
import type { AutonomousRecoveryResult, RecoveryAttempt, RecoveryInitialAttempt } from "./types.js";

export type ExpiredBlockhashRecoveryOptions = {
  runId: string;
  onProgress?: (message: string) => void;
};

function shouldRetry(decision: AutonomousRecoveryResult["agent_decision"]): boolean {
  return decision.selected_action === "refresh_blockhash_and_retry" && decision.refresh_blockhash && decision.resubmit;
}

function toInitialAttempt(result: Awaited<ReturnType<typeof injectExpiredBlockhashTransfer>>): RecoveryInitialAttempt {
  return {
    fee_payer: result.feePayer,
    recipient: result.recipient,
    lamports: result.lamports,
    original_blockhash: result.originalBlockhash,
    original_last_valid_block_height: result.originalLastValidBlockHeight,
    current_block_height_at_send: result.currentBlockHeightAtSend,
    attempted_at: new Date(result.attemptedAtMs).toISOString(),
    failure: result.failure
  };
}

function toDecisionInput(runId: string, initialAttempt: RecoveryInitialAttempt): FailureDecisionInput {
  return {
    run_id: runId,
    network: "devnet",
    mode: "autonomous_expired_blockhash_recovery",
    failure_type: initialAttempt.failure.type,
    failure_message: initialAttempt.failure.message,
    original_blockhash: initialAttempt.original_blockhash,
    original_last_valid_block_height: initialAttempt.original_last_valid_block_height,
    current_block_height_at_send: initialAttempt.current_block_height_at_send
  };
}

async function retryWithFreshBlockhash(connection: Connection, wallet: Keypair, lamports: number): Promise<RecoveryAttempt> {
  const transfer = await buildSimpleSelfTransfer(connection, wallet, lamports);

  try {
    const lifecycle = await sendAndTrackTransaction(connection, {
      serializedTransaction: transfer.serializedTransaction
    });
    const signature = lifecycle.signature;

    return {
      attempted: true,
      signature,
      explorer_url: explorerUrl(signature, "devnet"),
      blockhash: transfer.blockhash,
      last_valid_block_height: transfer.lastValidBlockHeight,
      lifecycle
    };
  } catch (error) {
    return {
      attempted: true,
      blockhash: transfer.blockhash,
      last_valid_block_height: transfer.lastValidBlockHeight,
      failure: classifyFailure(error)
    };
  }
}

export async function recoverExpiredBlockhashFailure(
  connection: Connection,
  wallet: Keypair,
  options: ExpiredBlockhashRecoveryOptions
): Promise<AutonomousRecoveryResult> {
  const expiredFailure = await injectExpiredBlockhashTransfer(connection, wallet, {
    onProgress: ({ currentBlockHeight, lastValidBlockHeight, remainingBlocks }) => {
      options.onProgress?.(
        `Waiting for blockhash expiry: current=${currentBlockHeight} last_valid=${lastValidBlockHeight} remaining=${remainingBlocks}`
      );
    }
  });
  const initialAttempt = toInitialAttempt(expiredFailure);
  const decisionInput = toDecisionInput(options.runId, initialAttempt);
  const agentDecision = localFailureDecisionAgent.decide(decisionInput);
  await appendAgentDecision(toDecisionLogEntry(decisionInput, agentDecision));
  const recoveryAttempt = shouldRetry(agentDecision)
    ? await retryWithFreshBlockhash(connection, wallet, initialAttempt.lamports)
    : { attempted: false };

  const recovered =
    recoveryAttempt.attempted &&
    recoveryAttempt.lifecycle?.stages.finalized.reached === true &&
    recoveryAttempt.lifecycle.failure === undefined;

  return {
    run_id: options.runId,
    network: "devnet",
    mode: "autonomous_expired_blockhash_recovery",
    initial_attempt: initialAttempt,
    agent_decision: agentDecision,
    recovery_attempt: recoveryAttempt,
    final_status: recovered ? "recovered" : "not_recovered",
    created_at: new Date().toISOString()
  };
}
