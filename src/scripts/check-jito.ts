import { getEnv } from "../config/env.js";
import { JitoRpcClient } from "../jito/jito-rpc-client.js";
import { inspectJitoNetworkAlignment } from "../jito/network-guard.js";
import { chooseTipAccount, fetchTipAccounts } from "../jito/tip-accounts.js";

async function main(): Promise<void> {
  const env = getEnv();
  const client = new JitoRpcClient({
    blockEngineUrl: env.JITO_BLOCK_ENGINE_URL
  });
  const alignment = inspectJitoNetworkAlignment(env.NETWORK, env.JITO_BLOCK_ENGINE_URL);
  const tipAccounts = await fetchTipAccounts(client);
  const selectedTipAccount = chooseTipAccount(tipAccounts);

  console.log(`Block engine bundle URL: ${client.bundlesUrl}`);
  console.log(`Network alignment: ${JSON.stringify(alignment)}`);
  console.log(`Tip accounts: ${tipAccounts.length}`);
  console.log(`Sample: ${tipAccounts.slice(0, 5).join(", ")}`);
  console.log(`Selected tip account: ${selectedTipAccount}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Jito check error";

  console.error(`Jito check failed: ${message}`);
  console.error("Check JITO_BLOCK_ENGINE_URL and network access. No bundle or transaction was sent.");
  process.exitCode = 1;
});
