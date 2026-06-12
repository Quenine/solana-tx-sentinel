export type FailureType =
  | "expired_blockhash"
  | "fee_too_low"
  | "compute_exceeded"
  | "simulation_failed"
  | "bundle_failure"
  | "unknown";

export type ClassifiedFailure = {
  type: FailureType;
  message: string;
  raw_error: string | null;
};

export type FailureLogEntry = {
  run_id: string;
  network: "devnet";
  mode: "fault_expired_blockhash";
  fee_payer: string;
  recipient: string;
  lamports: number;
  original_blockhash: string;
  original_last_valid_block_height: number;
  current_block_height_at_send: number;
  attempted_at: string;
  failure: ClassifiedFailure;
  created_at: string;
};
