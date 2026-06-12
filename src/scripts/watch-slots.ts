import { Connection } from "@solana/web3.js";

import { getEnv } from "../config/env.js";
import { createSlotStream } from "../streaming/create-slot-stream.js";
import type { SlotUpdate } from "../streaming/types.js";
import { defaultCommitment } from "../types/solana.js";

function formatSlot(update: SlotUpdate): string {
  const parent = update.parent === undefined ? "n/a" : update.parent;
  const root = update.root === undefined ? "n/a" : update.root;

  return `[slot] ${update.slot} parent=${parent} root=${root} source=${update.source}`;
}

async function main(): Promise<void> {
  const env = getEnv();
  const connection = new Connection(env.SOLANA_RPC_URL, {
    commitment: defaultCommitment,
    wsEndpoint: env.SOLANA_WS_URL
  });
  const stream = await createSlotStream(connection, env);
  let observedSlots = 0;
  let stopping = false;

  console.error(`Selected slot stream source: ${env.SLOT_STREAM_SOURCE}`);

  async function shutdown(): Promise<void> {
    if (stopping) {
      return;
    }

    stopping = true;
    await stream.stop();
    console.error(`Stopped slot stream after ${observedSlots} slots.`);
  }

  process.once("SIGINT", () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  process.once("SIGTERM", () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  await stream.start((update) => {
    observedSlots += 1;
    console.log(formatSlot(update));
  });

  console.error(`Watching live slots via ${env.SLOT_STREAM_SOURCE}. Press CTRL+C to stop.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown slot stream error";
  console.error(message);
  process.exitCode = 1;
});
