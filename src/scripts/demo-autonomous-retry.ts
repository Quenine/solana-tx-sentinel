import { randomUUID } from "node:crypto";

import { getEnv } from "../config/env.js";
import { appendAutonomousRecoveryLog } from "../lifecycle/log-writer.js";
import { recoverExpiredBlockhashFailure } from "../recovery/expired-blockhash-recovery.js";
import { createConnection } from "../solana/connection.js";
import { loadWalletKeypair } from "../solana/wallet.js";

async function main(): Promise<void> {
  const env = getEnv();

  if (env.NETWORK !== "devnet") {
    throw new Error(`Refusing to run autonomous retry demo on ${env.NETWORK}. Set NETWORK=devnet to use this script.`);
  }

  const connection = createConnection();
  const wallet = loadWalletKeypair();
  const result = await recoverExpiredBlockhashFailure(connection, wallet, {
    runId: randomUUID(),
    onProgress: (message) => console.error(message)
  });

  await appendAutonomousRecoveryLog(result);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown autonomous retry demo error";
  console.error(message);
  process.exitCode = 1;
});
