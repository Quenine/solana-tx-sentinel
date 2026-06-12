import { Connection } from "@solana/web3.js";

import { getEnv } from "../config/env.js";
import { getLeaderForSlot, loadCurrentLeaderSchedule } from "../leaders/leader-schedule.js";
import { createSlotStream } from "../streaming/create-slot-stream.js";
import type { SlotUpdate } from "../streaming/types.js";
import { defaultCommitment } from "../types/solana.js";

function formatLeaderSlot(update: SlotUpdate, leader: string | undefined): string {
  const root = update.root === undefined ? "n/a" : update.root;

  return `[slot] ${update.slot} leader=${leader ?? "unknown"} root=${root} source=${update.source}`;
}

async function main(): Promise<void> {
  const env = getEnv();
  const connection = new Connection(env.SOLANA_RPC_URL, {
    commitment: defaultCommitment,
    wsEndpoint: env.SOLANA_WS_URL
  });
  const schedule = await loadCurrentLeaderSchedule(connection);
  const stream = await createSlotStream(connection, env);
  let observedSlots = 0;
  let currentSlot = 0;
  let currentLeader: string | undefined;
  let stopping = false;

  console.error(`Selected slot stream source: ${env.SLOT_STREAM_SOURCE}`);

  async function shutdown(): Promise<void> {
    if (stopping) {
      return;
    }

    stopping = true;
    await stream.stop();
    console.error(`Stopped leader watcher after ${observedSlots} slots.`);
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

  console.error(
    `Loaded leader schedule epoch=${schedule.epoch} first_slot=${schedule.firstSlot} last_slot=${schedule.lastSlot}`
  );

  await stream.start((update) => {
    observedSlots += 1;
    currentSlot = update.slot;
    currentLeader = getLeaderForSlot(schedule, update.slot);

    console.log(formatLeaderSlot(update, currentLeader));

    if (observedSlots % 20 === 0) {
      console.error(
        `observed_slots=${observedSlots} current_slot=${currentSlot} current_leader=${currentLeader ?? "unknown"}`
      );
    }
  });

  console.error(`Watching live leaders via ${env.SLOT_STREAM_SOURCE}. Press CTRL+C to stop.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown leader watcher error";
  console.error(message);
  process.exitCode = 1;
});
