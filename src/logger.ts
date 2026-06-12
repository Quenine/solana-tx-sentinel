import pino from "pino";

import { getEnv } from "./config/env.js";

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "solana-tx-sentinel",
    network: env.NETWORK
  }
});
