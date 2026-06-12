import type { Commitment, TransactionError } from "@solana/web3.js";

export type LifecycleStage = Extract<Commitment, "processed" | "confirmed" | "finalized">;

export type StageObservation = {
  reached: boolean;
  observedAtMs?: number;
  slot?: number;
  error?: TransactionError | null;
};

export type LifecycleLatencies = {
  submittedToProcessedMs?: number;
  processedToConfirmedMs?: number;
  confirmedToFinalizedMs?: number;
  submittedToFinalizedMs?: number;
};

export type LifecycleFailure = {
  stage: LifecycleStage;
  message: string;
};

export type TransactionLifecycleResult = {
  signature: string;
  submittedAtMs: number;
  stages: Record<LifecycleStage, StageObservation>;
  latencies: LifecycleLatencies;
  failure?: LifecycleFailure;
};

export type TrackLifecycleOptions = {
  signature: string;
  submittedAtMs: number;
  timeoutMs?: number;
};

export type SendAndTrackTransactionOptions = {
  serializedTransaction: Buffer | Uint8Array;
  timeoutMs?: number;
};

export type LifecycleLogEntry = {
  run_id: string;
  network: "devnet";
  mode: "normal_transfer";
  signature: string;
  explorer_url: string;
  fee_payer: string;
  recipient: string;
  lamports: number;
  blockhash: string;
  last_valid_block_height: number;
  submitted_at: string;
  processed_at: string | null;
  confirmed_at: string | null;
  finalized_at: string | null;
  processed_slot: number | null;
  confirmed_slot: number | null;
  finalized_slot: number | null;
  submitted_to_processed_ms: number | null;
  processed_to_confirmed_ms: number | null;
  confirmed_to_finalized_ms: number | null;
  submitted_to_finalized_ms: number | null;
  failure: LifecycleFailure | null;
  created_at: string;
};
