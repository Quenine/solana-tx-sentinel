import type { Env } from "./env.js";

export type EvidenceProfileWarning = {
  key: string;
  current: string | number | boolean | undefined;
  recommended: string | number | boolean;
  message: string;
};

export type EvidenceProfileReport = {
  evidence_profile: Env["EVIDENCE_PROFILE"] | null;
  active: boolean;
  ready: boolean;
  recommendations: Record<string, string | number | boolean>;
  warnings: EvidenceProfileWarning[];
};

const finalRecommendations = {
  NETWORK: "testnet",
  JITO_BLOCK_ENGINE_URL: "https://testnet.block-engine.jito.wtf",
  SLOT_STREAM_SOURCE: "solana_ws",
  BUNDLE_LAYOUT: "combined_tip_instruction",
  ENABLE_SUBMISSION_TIMING: true,
  ENABLE_OBSERVED_JITO_LEADERS: true,
  MIN_JITO_TIP_LAMPORTS: 100_000,
  MAX_JITO_TIP_LAMPORTS: 300_000,
  PRIORITY_FEE_MICRO_LAMPORTS: 200_000,
  COMPUTE_UNIT_LIMIT: 200_000,
  SUBMISSION_TARGET_DISTANCE_MIN: 0,
  SUBMISSION_TARGET_DISTANCE_MAX: 2,
  SUBMISSION_MAX_WAIT_MS: 60_000,
  BUNDLE_STATUS_TIMEOUT_MS: 45_000,
  BUNDLE_STATUS_POLL_INTERVAL_MS: 1_500,
  STOP_ON_FIRST_INVALID: false
} as const;

function warning(key: keyof typeof finalRecommendations, current: EvidenceProfileWarning["current"]): EvidenceProfileWarning {
  const recommended = finalRecommendations[key];

  return {
    key,
    current,
    recommended,
    message: `${key} is ${String(current)}, recommended ${String(recommended)} for final evidence.`
  };
}

export function inspectEvidenceProfile(env: Env): EvidenceProfileReport {
  const warnings: EvidenceProfileWarning[] = [];

  if (env.EVIDENCE_PROFILE !== "final") {
    return {
      evidence_profile: env.EVIDENCE_PROFILE ?? null,
      active: false,
      ready: true,
      recommendations: finalRecommendations,
      warnings
    };
  }

  for (const key of Object.keys(finalRecommendations) as Array<keyof typeof finalRecommendations>) {
    if (env[key] !== finalRecommendations[key]) {
      warnings.push(warning(key, env[key]));
    }
  }

  if (env.SLOT_STREAM_SOURCE === "yellowstone" && (!env.YELLOWSTONE_GRPC_ENDPOINT || !env.YELLOWSTONE_GRPC_TOKEN)) {
    warnings.push({
      key: "SLOT_STREAM_SOURCE",
      current: env.SLOT_STREAM_SOURCE,
      recommended: "solana_ws",
      message: "SLOT_STREAM_SOURCE=yellowstone requires real Yellowstone credentials; use solana_ws otherwise."
    });
  }

  return {
    evidence_profile: "final",
    active: true,
    ready: warnings.length === 0,
    recommendations: finalRecommendations,
    warnings
  };
}

export function printEvidenceProfileWarnings(env: Env): void {
  const report = inspectEvidenceProfile(env);

  if (!report.active) {
    return;
  }

  console.error("Evidence profile final is active. Environment values are not overridden.");

  if (report.warnings.length === 0) {
    console.error("Final evidence profile check passed.");
    return;
  }

  for (const item of report.warnings) {
    console.error(`Final profile warning: ${item.message}`);
  }
}
