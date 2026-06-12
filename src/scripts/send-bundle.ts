import { getEnv } from "../config/env.js";
import { printEvidenceProfileWarnings } from "../config/evidence-profile.js";
import { sendJitoBundle } from "../jito/bundle-sender.js";
import { JitoRpcClient } from "../jito/jito-rpc-client.js";
import { inspectJitoNetworkAlignment } from "../jito/network-guard.js";
import { appendJitoBundleLog } from "../lifecycle/log-writer.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";
import { waitForSubmissionWindow } from "../submission/timing-controller.js";

async function main(): Promise<void> {
  const env = getEnv();
  printEvidenceProfileWarnings(env);
  const connection = createConnection();
  const wallet = loadWalletKeypair();
  const jitoClient = new JitoRpcClient({
    blockEngineUrl: env.JITO_BLOCK_ENGINE_URL
  });
  const networkAlignment = inspectJitoNetworkAlignment(env.NETWORK, env.JITO_BLOCK_ENGINE_URL);

  if (networkAlignment.warning) {
    console.error(`Network alignment warning: ${networkAlignment.warning}`);
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
        `[timing] elapsed_ms=${elapsedMs} current_slot=${decision.current_slot} decision=${decision.decision} reason=${decision.reason}`
      );
    }
  });

  if (timing.decision.decision === "skip") {
    console.log(
      JSON.stringify(
        {
          mode: "jito_bundle_submit",
          submitted: false,
          enable_submission_timing: env.ENABLE_SUBMISSION_TIMING,
          submission_wait_ms: timing.waitMs,
          timing_decision: timing.decision
        },
        null,
        2
      )
    );
    return;
  }

  const result = await sendJitoBundle({
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

  await appendJitoBundleLog(result);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bundle submission error";
  console.error(`Bundle submission failed before persistence: ${message}`);
  process.exitCode = 1;
});
