import { randomUUID } from "node:crypto";

import type {
  CandidateActionScore,
  CandidateRecoveryAction,
  FailureDecision,
  FailureDecisionAction,
  FailureDecisionAgent,
  FailureDecisionInput
} from "./types.js";

function nextTip(input: FailureDecisionInput): number | undefined {
  const baseline = input.recent_tip_lamports ?? input.previous_tip_lamports;

  if (baseline === undefined) {
    return undefined;
  }

  return Math.max(baseline + 1, Math.ceil(baseline * 1.25));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function leaderWindowUsable(input: FailureDecisionInput): boolean {
  return input.leader_window_status === "inside_window" || input.leader_window_status === "approaching_window";
}

function scoreRefreshBlockhash(input: FailureDecisionInput): CandidateActionScore {
  if (input.failure_type === "expired_blockhash") {
    return {
      action: "refresh_blockhash_and_retry",
      score: 0.95,
      reason: "Expired blockhash is recoverable by rebuilding the transaction with a fresh blockhash."
    };
  }

  if (input.failure_type === "bundle_failure" && leaderWindowUsable(input)) {
    return {
      action: "refresh_blockhash_and_retry",
      score: 0.7,
      reason: "Bundle failed while a usable leader window is still available; refresh timing inputs before retry."
    };
  }

  return {
    action: "refresh_blockhash_and_retry",
    score: 0.25,
    reason: "Refreshing the blockhash is useful for stale transactions, but this failure does not primarily indicate expiry."
  };
}

function scoreIncreaseTip(input: FailureDecisionInput): CandidateActionScore {
  if (input.failure_type === "fee_too_low") {
    return {
      action: "increase_tip_and_retry",
      score: 0.9,
      reason: "Failure indicates fee pressure; increasing the tip is the most direct retry adjustment."
    };
  }

  if (input.failure_type === "expired_blockhash") {
    return {
      action: "increase_tip_and_retry",
      score: 0.35,
      reason: "A higher tip may help later scheduling, but it does not fix the expired blockhash by itself."
    };
  }

  return {
    action: "increase_tip_and_retry",
    score: 0.3,
    reason: "No strong fee-pressure signal was present."
  };
}

function scoreWaitForLeader(input: FailureDecisionInput): CandidateActionScore {
  if (input.failure_type === "bundle_failure" && input.leader_window_status === "outside_window") {
    return {
      action: "wait_for_better_leader",
      score: 0.75,
      reason: "Bundle failed outside a favorable leader window; waiting is safer than immediate resubmission."
    };
  }

  return {
    action: "wait_for_better_leader",
    score: input.leader_window_status === "unknown" ? 0.45 : 0.25,
    reason: "Leader timing may matter, but this failure has a more direct recovery action."
  };
}

function scoreDoNotRetry(input: FailureDecisionInput): CandidateActionScore {
  if (input.failure_type === "compute_exceeded" || input.failure_type === "simulation_failed") {
    return {
      action: "do_not_retry",
      score: 0.85,
      reason: "Simulation or compute failure should be inspected before another submission."
    };
  }

  if (input.failure_type === "expired_blockhash") {
    return {
      action: "do_not_retry",
      score: 0.1,
      reason: "Expired blockhash is recoverable, so not retrying leaves a valid recovery path unused."
    };
  }

  return {
    action: "do_not_retry",
    score: 0.45,
    reason: "Holding is reasonable when the failure signal is unclear."
  };
}

function scoreAbort(input: FailureDecisionInput): CandidateActionScore {
  if (input.failure_type === "unknown") {
    return {
      action: "abort",
      score: 0.55,
      reason: "Unknown failure should not be retried automatically without inspection."
    };
  }

  if (input.failure_type === "expired_blockhash") {
    return {
      action: "abort",
      score: 0.05,
      reason: "Abort is too conservative for a recoverable expired blockhash."
    };
  }

  return {
    action: "abort",
    score: 0.25,
    reason: "Abort is reserved for unclear or unsafe retry conditions."
  };
}

function candidateActions(input: FailureDecisionInput): CandidateActionScore[] {
  return [
    scoreRefreshBlockhash(input),
    scoreIncreaseTip(input),
    scoreWaitForLeader(input),
    scoreDoNotRetry(input),
    scoreAbort(input)
  ].map((candidate) => ({
    ...candidate,
    score: clampScore(candidate.score)
  }));
}

function selectedCandidate(candidates: CandidateActionScore[]): CandidateActionScore {
  const [selected] = [...candidates].sort((left, right) => right.score - left.score);

  if (!selected) {
    throw new Error("Decision agent produced no candidate actions.");
  }

  return selected;
}

function externalAction(action: CandidateRecoveryAction): FailureDecisionAction {
  if (action === "abort") {
    return "abort";
  }

  if (action === "do_not_retry" || action === "wait_for_better_leader") {
    return "do_not_retry";
  }

  return "retry";
}

function decisionFlags(action: CandidateRecoveryAction): Pick<
  FailureDecision,
  "refresh_blockhash" | "recalculate_tip" | "resubmit"
> {
  switch (action) {
    case "refresh_blockhash_and_retry":
      return {
        refresh_blockhash: true,
        recalculate_tip: true,
        resubmit: true
      };

    case "increase_tip_and_retry":
      return {
        refresh_blockhash: false,
        recalculate_tip: true,
        resubmit: true
      };

    case "wait_for_better_leader":
      return {
        refresh_blockhash: true,
        recalculate_tip: true,
        resubmit: false
      };

    case "do_not_retry":
    case "abort":
      return {
        refresh_blockhash: false,
        recalculate_tip: false,
        resubmit: false
      };
  }
}

function createDecision(input: FailureDecisionInput): FailureDecision {
  const candidates = candidateActions(input);
  const selected = selectedCandidate(candidates);
  const flags = decisionFlags(selected.action);
  const suggestedTipLamports = flags.recalculate_tip ? nextTip(input) : undefined;

  return {
    decision_id: randomUUID(),
    provider: "local_reasoning",
    decision_mode: "scored_policy",
    selected_action: selected.action,
    action: externalAction(selected.action),
    reason: selected.reason,
    ...flags,
    ...(suggestedTipLamports === undefined ? {} : { suggested_tip_lamports: suggestedTipLamports }),
    confidence: selected.score,
    candidate_actions: candidates,
    created_at: new Date().toISOString()
  };
}

export const localFailureDecisionAgent: FailureDecisionAgent = {
  decide(input) {
    return createDecision(input);
  }
};
