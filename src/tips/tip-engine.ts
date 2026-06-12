import type { TipDecision, TipEngineInput } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isLeaderWindowClose(slotsUntilLeader: number | undefined): boolean {
  return slotsUntilLeader !== undefined && slotsUntilLeader >= 0 && slotsUntilLeader <= 8;
}

export function calculateJitoTip(input: TipEngineInput): TipDecision {
  const summary = input.recentFeeSummary;
  const leaderWindowClose = isLeaderWindowClose(input.slotsUntilLeader);

  if (summary.sample_count === 0 || summary.p75 === null || summary.p90 === null) {
    return {
      suggested_tip_lamports: input.minTipLamports,
      base_fee_lamports: 0,
      urgency_multiplier_applied: false,
      bounded_by_min: true,
      bounded_by_max: false,
      sample_count: summary.sample_count,
      reason: "No recent prioritization fee samples were available; using configured minimum as a safety floor."
    };
  }

  const baseFee = leaderWindowClose ? summary.p90 : summary.p75;
  const urgencyAdjusted = leaderWindowClose ? Math.ceil(baseFee * input.urgencyMultiplier) : baseFee;
  const suggested = clamp(urgencyAdjusted, input.minTipLamports, input.maxTipLamports);

  return {
    suggested_tip_lamports: suggested,
    base_fee_lamports: baseFee,
    urgency_multiplier_applied: leaderWindowClose,
    bounded_by_min: suggested === input.minTipLamports && urgencyAdjusted < input.minTipLamports,
    bounded_by_max: suggested === input.maxTipLamports && urgencyAdjusted > input.maxTipLamports,
    sample_count: summary.sample_count,
    reason: leaderWindowClose
      ? "Leader window is close; using p90 recent fee with urgency multiplier and configured bounds."
      : "Using p75 recent fee with configured bounds."
  };
}
