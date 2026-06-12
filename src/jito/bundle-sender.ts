import { randomUUID } from "node:crypto";

import type { Connection, Keypair } from "@solana/web3.js";

import type { Network } from "../config/env.js";
import { classifyFailure } from "../failures/classifier.js";
import type { ClassifiedFailure } from "../failures/types.js";
import { trackBundleSignatures, type TrackedSignatureLifecycle } from "../lifecycle/multi-signature-tracker.js";
import type { TransactionLifecycleResult } from "../lifecycle/types.js";
import { explorerUrl } from "../solana/cluster.js";
import type { TimingDecision } from "../submission/types.js";
import { sampleRecentPrioritizationFees } from "../tips/recent-fee-sampler.js";
import { calculateJitoTip } from "../tips/tip-engine.js";
import type { RecentFeeSummary, TipDecision, TipEngineInput } from "../tips/types.js";
import { simulateSignedTransactions, type TransactionSimulationResult } from "../transactions/simulation.js";
import { buildJitoBundlePreview } from "./bundle-builder.js";
import type { BundlePreview } from "./bundle-transaction.js";
import { waitForBundleStatus } from "./bundle-status.js";
import type { JitoRpcClient } from "./jito-rpc-client.js";
import type { JitoNetworkAlignment } from "./network-guard.js";
import type { BundleStatusResult } from "./types.js";
import { chooseTipAccount, fetchTipAccounts } from "./tip-accounts.js";

export type SendJitoBundleInput = {
  connection: Connection;
  wallet: Keypair;
  jitoClient: JitoRpcClient;
  network: Network;
  evidenceProfile: string | null;
  networkAlignment: JitoNetworkAlignment;
  minTipLamports: number;
  maxTipLamports: number;
  urgencyMultiplier: number;
  priorityFeeMicroLamports: number;
  computeUnitLimit: number;
  bundleLayout: BundlePreview["bundleLayout"];
  slotsUntilLeader?: number;
  timingDecision: TimingDecision;
  enableSubmissionTiming: boolean;
  submissionWaitMs: number;
  submitBundleOnSimulationFailure?: boolean;
  bundleStatusTimeoutMs?: number;
  bundleStatusPollIntervalMs?: number;
  stopOnFirstInvalid?: boolean;
};

export type JitoBundleSubmitLog = {
  run_id: string;
  evidence_session_id?: string;
  network: Network;
  evidence_profile: string | null;
  mode: "jito_bundle_submit";
  submission_path: "jito_only";
  rpc_rebroadcast: false;
  timing_decision: TimingDecision;
  enable_submission_timing: boolean;
  submission_wait_ms: number;
  network_alignment: JitoNetworkAlignment;
  bundle_id: string | null;
  bundle_layout: BundlePreview["bundleLayout"];
  bundle_transaction_count: number;
  transaction_signature: string;
  workload_transaction_signature: string;
  tip_transaction_signature: string | null;
  transaction_signatures: string[];
  serialized_transaction_byte_lengths: number[];
  explorer_url: string;
  fee_payer: string;
  self_transfer_recipient: string;
  self_transfer_lamports: number;
  tip_account: string;
  tip_lamports: number;
  priority_fee_micro_lamports: number;
  compute_unit_limit: number;
  blockhash: string;
  last_valid_block_height: number;
  recent_fee_summary: RecentFeeSummary;
  tip_decision: TipDecision;
  pre_submit_simulation: TransactionSimulationResult[];
  simulation_passed: boolean;
  simulation_warning: string | null;
  submitted_at: string;
  bundle_status: BundleStatusResult | null;
  lifecycle: JitoBundleLifecycleLog | null;
  transaction_lifecycles: JitoBundleTransactionLifecycleLog[];
  all_bundle_signatures_finalized: boolean;
  tip_signature_finalized: boolean | null;
  raw_response?: unknown;
  failure: ClassifiedFailure | null;
  created_at: string;
};

export type JitoBundleLifecycleLog = {
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
};

export type JitoBundleTransactionLifecycleLog = {
  role: string;
  signature: string;
  lifecycle: JitoBundleLifecycleLog;
  observed: boolean;
  finalized: boolean;
  failure?: TrackedSignatureLifecycle["failure"];
};

function conciseRawResponse(value: unknown): unknown {
  const serialized = JSON.stringify(value);

  if (serialized.length <= 500) {
    return value;
  }

  return undefined;
}

function conciseRawError(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  let text: string;

  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }

  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

function toIsoTime(value: number | undefined): string | null {
  return value === undefined ? null : new Date(value).toISOString();
}

function toLifecycleLog(lifecycle: TransactionLifecycleResult): JitoBundleLifecycleLog {
  return {
    submitted_at: new Date(lifecycle.submittedAtMs).toISOString(),
    processed_at: toIsoTime(lifecycle.stages.processed.observedAtMs),
    confirmed_at: toIsoTime(lifecycle.stages.confirmed.observedAtMs),
    finalized_at: toIsoTime(lifecycle.stages.finalized.observedAtMs),
    processed_slot: lifecycle.stages.processed.slot ?? null,
    confirmed_slot: lifecycle.stages.confirmed.slot ?? null,
    finalized_slot: lifecycle.stages.finalized.slot ?? null,
    submitted_to_processed_ms: lifecycle.latencies.submittedToProcessedMs ?? null,
    processed_to_confirmed_ms: lifecycle.latencies.processedToConfirmedMs ?? null,
    confirmed_to_finalized_ms: lifecycle.latencies.confirmedToFinalizedMs ?? null,
    submitted_to_finalized_ms: lifecycle.latencies.submittedToFinalizedMs ?? null
  };
}

function toTransactionLifecycleLog(input: TrackedSignatureLifecycle): JitoBundleTransactionLifecycleLog {
  return {
    role: input.role,
    signature: input.signature,
    lifecycle: toLifecycleLog(input.lifecycle),
    observed: input.observed,
    finalized: input.finalized,
    ...(input.failure === undefined ? {} : { failure: input.failure })
  };
}

function classifyPostSubmitFailure(input: {
  bundleStatus: BundleStatusResult;
  lifecycle: TransactionLifecycleResult;
}): ClassifiedFailure | null {
  const finalStatus = input.bundleStatus.final_bundle_status?.toLowerCase();

  if (finalStatus === "failed" || finalStatus === "invalid") {
    return classifyFailure(
      new Error(`Bundle ${input.bundleStatus.final_bundle_status}: ${input.bundleStatus.failed_reason ?? "no reason provided"}`)
    );
  }

  if (input.lifecycle.failure) {
    return classifyFailure(new Error(input.lifecycle.failure.message));
  }

  return null;
}

async function withRpcSendDisabled<T>(connection: Connection, operation: () => Promise<T>): Promise<T> {
  const originalSendRawTransaction = connection.sendRawTransaction;
  const originalSendTransaction = connection.sendTransaction;
  const fail = (): never => {
    throw new Error("RPC transaction send is disabled in Jito bundle mode. Use Jito sendBundle only.");
  };

  connection.sendRawTransaction = fail as Connection["sendRawTransaction"];
  connection.sendTransaction = fail as Connection["sendTransaction"];

  try {
    return await operation();
  } finally {
    connection.sendRawTransaction = originalSendRawTransaction;
    connection.sendTransaction = originalSendTransaction;
  }
}

function baseLog(input: {
  runId: string;
  network: SendJitoBundleInput["network"];
  evidenceProfile: string | null;
  networkAlignment: JitoNetworkAlignment;
  timingDecision: TimingDecision;
  enableSubmissionTiming: boolean;
  submissionWaitMs: number;
  bundle: BundlePreview;
  recentFeeSummary: RecentFeeSummary;
  tipDecision: TipDecision;
  preSubmitSimulation: TransactionSimulationResult[];
  simulationPassed: boolean;
  simulationWarning: string | null;
  submittedAt: string;
}): Omit<
  JitoBundleSubmitLog,
  | "bundle_id"
  | "bundle_status"
  | "lifecycle"
  | "transaction_lifecycles"
  | "all_bundle_signatures_finalized"
  | "tip_signature_finalized"
  | "failure"
  | "raw_response"
  | "created_at"
> {
  return {
    run_id: input.runId,
    network: input.network,
    evidence_profile: input.evidenceProfile,
    mode: "jito_bundle_submit",
    submission_path: "jito_only",
    rpc_rebroadcast: false,
    timing_decision: input.timingDecision,
    enable_submission_timing: input.enableSubmissionTiming,
    submission_wait_ms: input.submissionWaitMs,
    network_alignment: input.networkAlignment,
    transaction_signature: input.bundle.signature,
    bundle_layout: input.bundle.bundleLayout,
    bundle_transaction_count: input.bundle.bundleTransactionCount,
    workload_transaction_signature: input.bundle.workloadTransactionSignature,
    tip_transaction_signature: input.bundle.tipTransactionSignature,
    transaction_signatures: input.bundle.transactionSignatures,
    serialized_transaction_byte_lengths: input.bundle.serializedTransactionByteLengths,
    explorer_url: explorerUrl(input.bundle.signature, input.network),
    fee_payer: input.bundle.feePayer,
    self_transfer_recipient: input.bundle.selfTransferRecipient,
    self_transfer_lamports: input.bundle.selfTransferLamports,
    tip_account: input.bundle.tipAccount,
    tip_lamports: input.bundle.tipLamports,
    priority_fee_micro_lamports: input.bundle.priorityFeeMicroLamports,
    compute_unit_limit: input.bundle.computeUnitLimit,
    blockhash: input.bundle.blockhash,
    last_valid_block_height: input.bundle.lastValidBlockHeight,
    recent_fee_summary: input.recentFeeSummary,
    tip_decision: input.tipDecision,
    pre_submit_simulation: input.preSubmitSimulation,
    simulation_passed: input.simulationPassed,
    simulation_warning: input.simulationWarning,
    submitted_at: input.submittedAt
  };
}

export async function sendJitoBundle(input: SendJitoBundleInput): Promise<JitoBundleSubmitLog> {
  return withRpcSendDisabled(input.connection, () => sendJitoBundleInternal(input));
}

async function sendJitoBundleInternal(input: SendJitoBundleInput): Promise<JitoBundleSubmitLog> {
  const runId = randomUUID();
  const currentSlot = await input.connection.getSlot("confirmed");
  const tipAccounts = await fetchTipAccounts(input.jitoClient);
  const tipAccount = chooseTipAccount(tipAccounts, currentSlot);
  const recentFeeSummary = await sampleRecentPrioritizationFees(input.connection);
  const tipInput: TipEngineInput = {
    recentFeeSummary,
    minTipLamports: input.minTipLamports,
    maxTipLamports: input.maxTipLamports,
    urgencyMultiplier: input.urgencyMultiplier
  };

  if (input.slotsUntilLeader !== undefined) {
    tipInput.slotsUntilLeader = input.slotsUntilLeader;
  }

  const tipDecision = calculateJitoTip(tipInput);
  const bundle = await buildJitoBundlePreview({
    connection: input.connection,
    wallet: input.wallet,
    tipAccount,
    tipLamports: tipDecision.suggested_tip_lamports,
    priorityFeeMicroLamports: input.priorityFeeMicroLamports,
    computeUnitLimit: input.computeUnitLimit,
    bundleLayout: input.bundleLayout
  });
  const preSubmitSimulation = await simulateSignedTransactions({
    connection: input.connection,
    transactions: bundle.transactions
  });
  const simulationPassed = preSubmitSimulation.every((result) => result.ok);
  const submitOnSimulationFailure =
    input.submitBundleOnSimulationFailure ?? process.env.SUBMIT_BUNDLE_ON_SIMULATION_FAILURE === "true";
  const simulationWarning =
    simulationPassed || !submitOnSimulationFailure
      ? null
      : "SUBMIT_BUNDLE_ON_SIMULATION_FAILURE=true; submitting despite failed pre-submit simulation.";
  const submittedAt = new Date().toISOString();
  const log = baseLog({
    runId,
    network: input.network,
    evidenceProfile: input.evidenceProfile,
    networkAlignment: input.networkAlignment,
    timingDecision: input.timingDecision,
    enableSubmissionTiming: input.enableSubmissionTiming,
    submissionWaitMs: input.submissionWaitMs,
    bundle,
    recentFeeSummary,
    tipDecision,
    preSubmitSimulation,
    simulationPassed,
    simulationWarning,
    submittedAt
  });

  if (!simulationPassed && !submitOnSimulationFailure) {
    const failed = preSubmitSimulation.find((result) => !result.ok);

    return {
      ...log,
      bundle_id: null,
      bundle_status: null,
      lifecycle: null,
      transaction_lifecycles: [],
      all_bundle_signatures_finalized: false,
      tip_signature_finalized: null,
      failure: {
        type: "simulation_failed",
        message: `Pre-submit simulation failed for ${failed?.role ?? "unknown"} transaction ${failed?.signature ?? ""}`.trim(),
        raw_error: conciseRawError(failed?.err)
      },
      created_at: new Date().toISOString()
    };
  }

  try {
    const result = await input.jitoClient.sendBundle(
      bundle.serializedTransactions.map((transaction) => transaction.base64)
    );
    const rawResponse = conciseRawResponse(result.raw);
    const bundleStatus = await waitForBundleStatus(input.jitoClient, result.bundle_id, {
      ...(input.bundleStatusTimeoutMs === undefined ? {} : { timeoutMs: input.bundleStatusTimeoutMs }),
      ...(input.bundleStatusPollIntervalMs === undefined ? {} : { pollIntervalMs: input.bundleStatusPollIntervalMs }),
      ...(input.stopOnFirstInvalid === undefined ? {} : { stopOnFirstInvalid: input.stopOnFirstInvalid })
    });
    const trackedSignatures = await trackBundleSignatures({
      connection: input.connection,
      submittedAtMs: Date.parse(submittedAt),
      signatures: bundle.transactions.map((transaction) => ({
        role: transaction.role,
        signature: transaction.signature
      }))
    });
    const transactionLifecycles = trackedSignatures.map(toTransactionLifecycleLog);
    const workloadLifecycle = trackedSignatures[0]?.lifecycle;
    const tipLifecycle = trackedSignatures.find((entry) => entry.role === "tip") ?? null;

    if (!workloadLifecycle) {
      throw new Error("Workload transaction lifecycle was not tracked.");
    }

    return {
      ...log,
      bundle_id: result.bundle_id,
      bundle_status: bundleStatus,
      lifecycle: toLifecycleLog(workloadLifecycle),
      transaction_lifecycles: transactionLifecycles,
      all_bundle_signatures_finalized: trackedSignatures.every((entry) => entry.finalized),
      tip_signature_finalized: tipLifecycle?.finalized ?? null,
      ...(rawResponse === undefined ? {} : { raw_response: rawResponse }),
      failure: classifyPostSubmitFailure({ bundleStatus, lifecycle: workloadLifecycle }),
      created_at: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...log,
      bundle_id: null,
      bundle_status: null,
      lifecycle: null,
      transaction_lifecycles: [],
      all_bundle_signatures_finalized: false,
      tip_signature_finalized: null,
      failure: classifyFailure(error),
      created_at: new Date().toISOString()
    };
  }
}
