import { getEnv } from "./config/env.js";
import { logger } from "./logger.js";

function main(): void {
  const env = getEnv();

  logger.info(
    {
      aiAgentEnabled: env.ENABLE_AI_AGENT
    },
    "Solana Tx Sentinel initialized"
  );
}

main();
