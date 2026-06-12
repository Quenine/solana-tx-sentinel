import { getEnv } from "../config/env.js";
import { inspectEvidenceProfile } from "../config/evidence-profile.js";

async function main(): Promise<void> {
  const env = getEnv();
  const report = inspectEvidenceProfile(env);

  console.log(
    JSON.stringify(
      {
        current_config: {
          EVIDENCE_PROFILE: env.EVIDENCE_PROFILE ?? null,
          NETWORK: env.NETWORK,
          JITO_BLOCK_ENGINE_URL: env.JITO_BLOCK_ENGINE_URL,
          SLOT_STREAM_SOURCE: env.SLOT_STREAM_SOURCE,
          BUNDLE_LAYOUT: env.BUNDLE_LAYOUT,
          ENABLE_SUBMISSION_TIMING: env.ENABLE_SUBMISSION_TIMING,
          ENABLE_OBSERVED_JITO_LEADERS: env.ENABLE_OBSERVED_JITO_LEADERS,
          MIN_JITO_TIP_LAMPORTS: env.MIN_JITO_TIP_LAMPORTS,
          MAX_JITO_TIP_LAMPORTS: env.MAX_JITO_TIP_LAMPORTS,
          PRIORITY_FEE_MICRO_LAMPORTS: env.PRIORITY_FEE_MICRO_LAMPORTS,
          COMPUTE_UNIT_LIMIT: env.COMPUTE_UNIT_LIMIT,
          SUBMISSION_TARGET_DISTANCE_MIN: env.SUBMISSION_TARGET_DISTANCE_MIN,
          SUBMISSION_TARGET_DISTANCE_MAX: env.SUBMISSION_TARGET_DISTANCE_MAX,
          SUBMISSION_MAX_WAIT_MS: env.SUBMISSION_MAX_WAIT_MS,
          BUNDLE_STATUS_TIMEOUT_MS: env.BUNDLE_STATUS_TIMEOUT_MS,
          BUNDLE_STATUS_POLL_INTERVAL_MS: env.BUNDLE_STATUS_POLL_INTERVAL_MS,
          STOP_ON_FIRST_INVALID: env.STOP_ON_FIRST_INVALID
        },
        final_profile: report
      },
      null,
      2
    )
  );

  console.log(report.ready ? "ready_for_final_evidence=true" : "ready_for_final_evidence=false");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown final config check error";
  console.error(message);
  process.exitCode = 1;
});
