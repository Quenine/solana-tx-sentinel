import type { Connection } from "@solana/web3.js";

import type { LeaderIdentity, LoadedLeaderSchedule } from "./types.js";

export async function loadCurrentLeaderSchedule(connection: Connection): Promise<LoadedLeaderSchedule> {
  const epochInfo = await connection.getEpochInfo("confirmed");
  const schedule = await connection.getLeaderSchedule();

  if (!schedule) {
    throw new Error(`Leader schedule is not available for epoch ${epochInfo.epoch}.`);
  }

  const firstSlot = epochInfo.absoluteSlot - epochInfo.slotIndex;
  const lastSlot = firstSlot + epochInfo.slotsInEpoch - 1;
  const slotToLeader = new Map<number, LeaderIdentity>();

  for (const [identity, relativeSlots] of Object.entries(schedule)) {
    for (const relativeSlot of relativeSlots) {
      slotToLeader.set(firstSlot + relativeSlot, identity);
    }
  }

  return {
    epoch: epochInfo.epoch,
    firstSlot,
    lastSlot,
    slotToLeader
  };
}

export function getLeaderForSlot(schedule: LoadedLeaderSchedule, slot: number): LeaderIdentity | undefined {
  return schedule.slotToLeader.get(slot);
}
