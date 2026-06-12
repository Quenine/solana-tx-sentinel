import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { Network } from "../config/env.js";
import type { ClassifiedFailure, FailureType } from "../failures/types.js";
import type { BundleStatusResult } from "../jito/types.js";
import type { TrackedSignatureLifecycle } from "../lifecycle/multi-signature-tracker.js";
import type { TransactionSimulationResult } from "../transactions/simulation.js";

export const jitoBundleFailureLogPath = "data/lifecycle/jito-bundle-failures.jsonl";

export type ControlledJitoBundleFailureScenario =
  | "expired_blockhash_bundle"
  | "compute_exceeded_bundle"
  | "invalid_tip_account_bundle";

export type ControlledBundleFailure = ClassifiedFailure & {
  subtype?: "invalid_tip_account";
};

export type ControlledJitoBundleFailureLog = {
  run_id: string;
  network: Network;
  mode: "jito_bundle_failure";
  failure_scenario: ControlledJitoBundleFailureScenario;
  submission_path: "jito_only";
  rpc_rebroadcast: false;
  bundle_id: string | null;
  transaction_signature: string;
  bundle_status: BundleStatusResult | null;
  lifecycle: ControlledJitoBundleLifecycleLog | null;
  submitted_at: string;
  blockhash: string;
  last_valid_block_height: number;
  current_block_height_at_submit?: number;
  current_slot_at_submit?: number;
  tip_account: string;
  selected_tip_account?: string;
  selected_tip_account_in_jito_set?: boolean;
  jito_tip_account_sample_count?: number;
  tip_lamports: number;
  priority_fee_micro_lamports: number;
  compute_unit_limit: number;
  pre_submit_simulation: TransactionSimulationResult[];
  simulation_passed: boolean;
  submitted_despite_simulation_failure?: boolean;
  failure: ControlledBundleFailure;
  created_at: string;
};

export type ControlledJitoBundleLifecycleLog = {
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
  observed: boolean;
  finalized: boolean;
};

function toIsoTime(value: number | undefined): string | null {
  return value === undefined ? null : new Date(value).toISOString();
}

export function toControlledLifecycleLog(input: TrackedSignatureLifecycle | undefined): ControlledJitoBundleLifecycleLog | null {
  if (!input) {
    return null;
  }

  return {
    submitted_at: new Date(input.lifecycle.submittedAtMs).toISOString(),
    processed_at: toIsoTime(input.lifecycle.stages.processed.observedAtMs),
    confirmed_at: toIsoTime(input.lifecycle.stages.confirmed.observedAtMs),
    finalized_at: toIsoTime(input.lifecycle.stages.finalized.observedAtMs),
    processed_slot: input.lifecycle.stages.processed.slot ?? null,
    confirmed_slot: input.lifecycle.stages.confirmed.slot ?? null,
    finalized_slot: input.lifecycle.stages.finalized.slot ?? null,
    submitted_to_processed_ms: input.lifecycle.latencies.submittedToProcessedMs ?? null,
    processed_to_confirmed_ms: input.lifecycle.latencies.processedToConfirmedMs ?? null,
    confirmed_to_finalized_ms: input.lifecycle.latencies.confirmedToFinalizedMs ?? null,
    submitted_to_finalized_ms: input.lifecycle.latencies.submittedToFinalizedMs ?? null,
    observed: input.observed,
    finalized: input.finalized
  };
}

function normalize(value: unknown): string {
  if (value instanceof Error) {
    return value.message.toLowerCase();
  }

  if (typeof value === "string") {
    return value.toLowerCase();
  }

  try {
    return (JSON.stringify(value) ?? String(value)).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function simulationText(results: TransactionSimulationResult[]): string {
  return results.map((result) => `${normalize(result.err)} ${result.logs.map(normalize).join(" ")}`).join(" ");
}

function conciseRaw(value: unknown): string | null {
  const text = normalize(value).replace(/\s+/g, " ").trim();

  if (text.length === 0) {
    return null;
  }

  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

export function classifyControlledBundleFailure(input: {
  scenario: ControlledJitoBundleFailureScenario;
  simulation: TransactionSimulationResult[];
  bundleStatus: BundleStatusResult | null;
  lifecycle: ControlledJitoBundleLifecycleLog | null;
  selectedTipAccountInJitoSet?: boolean;
  sendError?: unknown;
}): ControlledBundleFailure {
  const text = [
    input.scenario,
    simulationText(input.simulation),
    normalize(input.bundleStatus),
    normalize(input.sendError)
  ].join(" ");
  let type: FailureType;
  let message: string;

  if (text.includes("computational budget exceeded") || text.includes("compute budget exceeded")) {
    type = "compute_exceeded";
    message = "Controlled bundle failure: compute budget exceeded during simulation or bundle processing.";
  } else if (
    input.scenario === "invalid_tip_account_bundle" &&
    input.simulation.every((result) => result.ok) &&
    input.selectedTipAccountInJitoSet === false &&
    input.bundleStatus?.final_bundle_status?.toLowerCase() !== "landed"
  ) {
    return {
      type: "bundle_failure",
      subtype: "invalid_tip_account",
      message: "Controlled bundle failure: Jito tip recipient was not in the current tip account set.",
      raw_error: conciseRaw(text)
    };
  } else if (
    text.includes("blockhash not found") ||
    text.includes("expired") ||
    text.includes("stale") ||
    (input.scenario === "expired_blockhash_bundle" && input.lifecycle?.observed !== true)
  ) {
    type = "expired_blockhash";
    message = "Controlled bundle failure: expired blockhash prevented the transaction from becoming observable.";
  } else {
    type = input.scenario === "expired_blockhash_bundle" ? "expired_blockhash" : "unknown";
    message =
      type === "expired_blockhash"
        ? "Controlled bundle failure: expired_blockhash."
        : "Controlled bundle failure did not contain enough evidence for a specific classification.";
  }

  return {
    type,
    message,
    raw_error: conciseRaw(text)
  };
}

export async function appendControlledJitoBundleFailureLog(entry: ControlledJitoBundleFailureLog): Promise<void> {
  await mkdir(dirname(jitoBundleFailureLogPath), { recursive: true });
  await appendFile(jitoBundleFailureLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}
