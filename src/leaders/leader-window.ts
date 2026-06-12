import { getLeaderForSlot } from "./leader-schedule.js";
import type { LeaderIdentity, LeaderWindowResult, LoadedLeaderSchedule } from "./types.js";

export function detectLeaderWindow(input: {
  schedule: LoadedLeaderSchedule;
  currentSlot: number;
  targetLeaders: LeaderIdentity | LeaderIdentity[];
  lookaheadSlots: number;
}): LeaderWindowResult {
  if (!Number.isSafeInteger(input.lookaheadSlots) || input.lookaheadSlots < 0) {
    throw new Error("lookaheadSlots must be a non-negative integer.");
  }

  const targets = new Set(Array.isArray(input.targetLeaders) ? input.targetLeaders : [input.targetLeaders]);
  const currentLeader = getLeaderForSlot(input.schedule, input.currentSlot);
  const result: LeaderWindowResult = {
    current_slot: input.currentSlot,
    in_window: false,
    lookahead_slots: input.lookaheadSlots
  };

  if (currentLeader !== undefined) {
    result.current_leader = currentLeader;
  }

  for (let slot = input.currentSlot; slot <= input.currentSlot + input.lookaheadSlots; slot += 1) {
    const leader = getLeaderForSlot(input.schedule, slot);

    if (leader && targets.has(leader)) {
      result.next_matching_slot = slot;
      result.next_matching_leader = leader;
      result.slots_until_next_match = slot - input.currentSlot;
      result.in_window = true;
      break;
    }
  }

  return result;
}
