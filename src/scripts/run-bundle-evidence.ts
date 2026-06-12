import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { JitoBundleSubmitLog } from "../jito/bundle-sender.js";
import { getEnv } from "../config/env.js";
import { printEvidenceProfileWarnings } from "../config/evidence-profile.js";
import { summarizeBundleEvidence } from "../evidence/evidence-summary.js";
import { sendJitoBundle } from "../jito/bundle-sender.js";
import { JitoRpcClient } from "../jito/jito-rpc-client.js";
import { inspectJitoNetworkAlignment } from "../jito/network-guard.js";
import { appendJitoBundleLog } from "../lifecycle/log-writer.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { waitForSubmissionWindow } from "../submission/timing-controller.js";
import { defaultCommitment, formatSol } from "../types/solana.js";

const latestSummaryPath = "data/lifecycle/latest-evidence-summary.json";
const estimatedSignatureFeeLamports = 10_000;

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finalStatus(run: JitoBundleSubmitLog): string {
  if (run.bundle_status?.final_bundle_status) {
    return run.bundle_status.final_bundle_status;
  }

  if (run.bundle_status?.timed_out) {
    return "TimedOut";
  }

  return run.failure ? "Failed" : "Submitted";
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const requestedCount = parsePositiveInteger(process.argv[2], 10, "Bundle evidence count");
  const delayMs = parsePositiveInteger(process.argv[3] ?? process.env.BUNDLE_EVIDENCE_DELAY_MS, 3_000, "Delay");
  const evidenceSessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const sessionSummaryPath = `data/lifecycle/evidence-session-${evidenceSessionId}.json`;
  const env = getEnv();
  printEvidenceProfileWarnings(env);
  const connection = createConnection();
  const wallet = loadWalletKeypair();
  const jitoClient = new JitoRpcClient({
    blockEngineUrl: env.JITO_BLOCK_ENGINE_URL
  });
  const networkAlignment = inspectJitoNetworkAlignment(env.NETWORK, env.JITO_BLOCK_ENGINE_URL);
  const minimumBalanceLamports = env.MAX_JITO_TIP_LAMPORTS + estimatedSignatureFeeLamports;
  const runs: JitoBundleSubmitLog[] = [];

  if (networkAlignment.warning) {
    console.error(`Network alignment warning: ${networkAlignment.warning}`);
  }

  for (let attempt = 1; attempt <= requestedCount; attempt += 1) {
    const balance = await connection.getBalance(wallet.publicKey, defaultCommitment);

    if (balance < minimumBalanceLamports) {
      console.error(
        `Stopping before attempt ${attempt}: wallet balance is ${formatSol(balance)} SOL, below required floor ${formatSol(
          minimumBalanceLamports
        )} SOL. Fund the wallet and rerun.`
      );
      break;
    }

    const timing = await waitForSubmissionWindow(connection, {
      enabled: env.ENABLE_SUBMISSION_TIMING,
      lookaheadSlots: env.SUBMISSION_LOOKAHEAD_SLOTS,
      targetDistanceMin: env.SUBMISSION_TARGET_DISTANCE_MIN,
      targetDistanceMax: env.SUBMISSION_TARGET_DISTANCE_MAX,
      maxWaitMs: env.SUBMISSION_MAX_WAIT_MS,
      observedJitoLeadersEnabled: env.ENABLE_OBSERVED_JITO_LEADERS,
      observedJitoLeadersPath: env.OBSERVED_JITO_LEADERS_PATH,
      observedJitoLeaderMinLandings: env.OBSERVED_JITO_LEADER_MIN_LANDINGS,
      onProgress: (decision, elapsedMs) => {
        console.error(
          `[timing] attempt=${attempt} elapsed_ms=${elapsedMs} current_slot=${decision.current_slot} decision=${decision.decision} reason=${decision.reason}`
        );
      }
    });

    if (timing.decision.decision === "skip") {
      console.log(
        JSON.stringify({
          evidence_session_id: evidenceSessionId,
          attempt,
          submitted: false,
          submission_wait_ms: timing.waitMs,
          timing_decision: timing.decision
        })
      );

      if (attempt < requestedCount) {
        await sleep(delayMs);
      }

      continue;
    }

    const submittedRun = await sendJitoBundle({
      connection,
      wallet,
      jitoClient,
      network: env.NETWORK,
      evidenceProfile: env.EVIDENCE_PROFILE ?? null,
      networkAlignment,
      minTipLamports: env.MIN_JITO_TIP_LAMPORTS,
      maxTipLamports: env.MAX_JITO_TIP_LAMPORTS,
      urgencyMultiplier: env.TIP_URGENCY_MULTIPLIER,
      priorityFeeMicroLamports: env.PRIORITY_FEE_MICRO_LAMPORTS,
      computeUnitLimit: env.COMPUTE_UNIT_LIMIT,
      bundleLayout: env.BUNDLE_LAYOUT,
      slotsUntilLeader: timing.decision.slots_until_target ?? 8,
      timingDecision: timing.decision,
      enableSubmissionTiming: env.ENABLE_SUBMISSION_TIMING,
      submissionWaitMs: timing.waitMs,
      submitBundleOnSimulationFailure: env.SUBMIT_BUNDLE_ON_SIMULATION_FAILURE,
      bundleStatusTimeoutMs: env.BUNDLE_STATUS_TIMEOUT_MS,
      bundleStatusPollIntervalMs: env.BUNDLE_STATUS_POLL_INTERVAL_MS,
      stopOnFirstInvalid: env.STOP_ON_FIRST_INVALID
    });
    const run: JitoBundleSubmitLog = {
      ...submittedRun,
      evidence_session_id: evidenceSessionId
    };

    await appendJitoBundleLog(run);
    runs.push(run);

    console.log(
      JSON.stringify({
        evidence_session_id: evidenceSessionId,
        evidence_profile: env.EVIDENCE_PROFILE ?? null,
        attempt,
        bundle_id: run.bundle_id,
        signature: run.transaction_signature,
        bundle_layout: run.bundle_layout,
        bundle_transaction_count: run.bundle_transaction_count,
        priority_fee_micro_lamports: run.priority_fee_micro_lamports,
        compute_unit_limit: run.compute_unit_limit,
        submission_path: run.submission_path,
        rpc_rebroadcast: run.rpc_rebroadcast,
        submission_wait_ms: run.submission_wait_ms,
        timing_decision: run.timing_decision,
        final_status: finalStatus(run),
        failure_type: run.failure?.type ?? null
      })
    );

    if (attempt < requestedCount) {
      await sleep(delayMs);
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = summarizeBundleEvidence(requestedCount, runs, {
    evidenceSessionId,
    evidenceProfile: env.EVIDENCE_PROFILE ?? null,
    startedAt,
    finishedAt
  });
  const consoleSummary = {
    evidence_session_id: summary.evidence_session_id,
    evidence_profile: summary.evidence_profile,
    landed_count: summary.landed_count,
    requested_count: summary.requested_count,
    failed_count: summary.failed_count,
    code_inconsistent_count: summary.code_inconsistent_count,
    operational_ambiguity_count: summary.operational_ambiguity_count,
    latest_summary_path: latestSummaryPath
  };

  await writeJsonFile(sessionSummaryPath, summary);
  await writeJsonFile(latestSummaryPath, summary);
  console.log(JSON.stringify(consoleSummary, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bundle evidence error";
  console.error(`Bundle evidence run failed: ${message}`);
  process.exitCode = 1;
});
