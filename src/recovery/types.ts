import type { FailureDecision } from "../agent/types.js";
import type { ClassifiedFailure } from "../failures/types.js";
import type { TransactionLifecycleResult } from "../lifecycle/types.js";

export type RecoveryInitialAttempt = {
  fee_payer: string;
  recipient: string;
  lamports: number;
  original_blockhash: string;
  original_last_valid_block_height: number;
  current_block_height_at_send: number;
  attempted_at: string;
  failure: ClassifiedFailure;
};

export type RecoveryAttempt = {
  attempted: boolean;
  signature?: string;
  explorer_url?: string;
  blockhash?: string;
  last_valid_block_height?: number;
  lifecycle?: TransactionLifecycleResult;
  failure?: ClassifiedFailure;
};

export type AutonomousRecoveryResult = {
  run_id: string;
  network: "devnet";
  mode: "autonomous_expired_blockhash_recovery";
  initial_attempt: RecoveryInitialAttempt;
  agent_decision: FailureDecision;
  recovery_attempt: RecoveryAttempt;
  final_status: "recovered" | "not_recovered";
  created_at: string;
};
