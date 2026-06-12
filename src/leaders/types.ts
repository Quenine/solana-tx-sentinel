export type LeaderIdentity = string;

export type LoadedLeaderSchedule = {
  epoch: number;
  firstSlot: number;
  lastSlot: number;
  slotToLeader: Map<number, LeaderIdentity>;
};

export type LeaderWindowResult = {
  current_slot: number;
  current_leader?: LeaderIdentity;
  next_matching_slot?: number;
  next_matching_leader?: LeaderIdentity;
  slots_until_next_match?: number;
  in_window: boolean;
  lookahead_slots: number;
};
