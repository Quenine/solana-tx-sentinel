import type { FailureType } from "../failures/types.js";

export type LeaderWindowStatus = "inside_window" | "approaching_window" | "outside_window" | "unknown";

export type FailureDecisionInput = {
  run_id: string;
  network: "devnet" | "testnet" | "mainnet-beta";
  mode: string;
  failure_type: FailureType;
  failure_message: string;
  original_blockhash?: string;
  original_last_valid_block_height?: number;
  current_block_height_at_send?: number;
  current_slot?: number;
  previous_tip_lamports?: number;
  recent_tip_lamports?: number;
  leader_window_status?: LeaderWindowStatus;
};

export type CandidateRecoveryAction =
  | "refresh_blockhash_and_retry"
  | "increase_tip_and_retry"
  | "wait_for_better_leader"
  | "do_not_retry"
  | "abort";

export type CandidateActionScore = {
  action: CandidateRecoveryAction;
  score: number;
  reason: string;
};

export type FailureDecisionAction = "retry" | "do_not_retry" | "abort";

export type FailureDecision = {
  decision_id: string;
  provider: "local_reasoning";
  decision_mode: "scored_policy";
  selected_action: CandidateRecoveryAction;
  action: FailureDecisionAction;
  reason: string;
  refresh_blockhash: boolean;
  recalculate_tip: boolean;
  resubmit: boolean;
  suggested_tip_lamports?: number;
  confidence: number;
  candidate_actions: CandidateActionScore[];
  created_at: string;
};

export type FailureDecisionLogEntry = FailureDecision & {
  run_id: string;
  network: FailureDecisionInput["network"];
  mode: FailureDecisionInput["mode"];
  failure_type: FailureDecisionInput["failure_type"];
  source_file?: "jito-bundle-failures" | "devnet-failures";
};

export type FailureDecisionAgent = {
  decide(input: FailureDecisionInput): FailureDecision;
};
