export type TimingDecisionKind = "submit_now" | "wait" | "skip";

export type TimingDecision = {
  decision: TimingDecisionKind;
  strategy: "observed_jito_leader" | "generic_leader_window" | "immediate";
  current_slot: number;
  current_leader?: string;
  target_slot?: number;
  target_leader?: string;
  slots_until_target?: number;
  observed_leader_count: number;
  target_leader_landing_count?: number;
  reason: string;
  observed_at: string;
};

export type SubmissionTimingOptions = {
  enabled: boolean;
  lookaheadSlots: number;
  targetDistanceMin: number;
  targetDistanceMax: number;
  maxWaitMs: number;
  observedJitoLeadersEnabled: boolean;
  observedJitoLeadersPath: string;
  observedJitoLeaderMinLandings: number;
  pollIntervalMs?: number;
  onProgress?: (decision: TimingDecision, elapsedMs: number) => void;
};
