export type RecentFeeSummary = {
  sample_count: number;
  min: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
};

export type TipEngineInput = {
  recentFeeSummary: RecentFeeSummary;
  slotsUntilLeader?: number;
  minTipLamports: number;
  maxTipLamports: number;
  urgencyMultiplier: number;
};

export type TipDecision = {
  suggested_tip_lamports: number;
  base_fee_lamports: number;
  urgency_multiplier_applied: boolean;
  bounded_by_min: boolean;
  bounded_by_max: boolean;
  sample_count: number;
  reason: string;
};
