import { getEnv } from "../config/env.js";
import { createConnection } from "../solana/connection.js";
import { sampleRecentPrioritizationFees } from "../tips/recent-fee-sampler.js";
import { calculateJitoTip } from "../tips/tip-engine.js";
import { defaultCommitment } from "../types/solana.js";

async function main(): Promise<void> {
  const env = getEnv();
  const connection = createConnection();
  const recentFeeSummary = await sampleRecentPrioritizationFees(connection);
  const currentSlot = await connection.getSlot(defaultCommitment);
  const slotsUntilLeader = 8;
  const tipDecision = calculateJitoTip({
    recentFeeSummary,
    slotsUntilLeader,
    minTipLamports: env.MIN_JITO_TIP_LAMPORTS,
    maxTipLamports: env.MAX_JITO_TIP_LAMPORTS,
    urgencyMultiplier: env.TIP_URGENCY_MULTIPLIER
  });

  console.log(
    JSON.stringify(
      {
        network: env.NETWORK,
        current_slot: currentSlot,
        slots_until_leader: slotsUntilLeader,
        bounds: {
          min_jito_tip_lamports: env.MIN_JITO_TIP_LAMPORTS,
          max_jito_tip_lamports: env.MAX_JITO_TIP_LAMPORTS,
          urgency_multiplier: env.TIP_URGENCY_MULTIPLIER
        },
        recent_fee_summary: recentFeeSummary,
        tip_decision: tipDecision
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown tip check error";
  console.error(`Tip check failed: ${message}`);
  process.exitCode = 1;
});
