import { getEnv } from "../config/env.js";
import { createConnection } from "../solana/connection.js";
import { waitForSubmissionWindow } from "../submission/timing-controller.js";

async function main(): Promise<void> {
  const env = getEnv();
  const connection = createConnection();
  const result = await waitForSubmissionWindow(connection, {
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

  console.log(
    JSON.stringify(
      {
        enable_submission_timing: env.ENABLE_SUBMISSION_TIMING,
        submission_wait_ms: result.waitMs,
        timing_decision: result.decision
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown submission timing check error";
  console.error(message);
  process.exitCode = 1;
});
