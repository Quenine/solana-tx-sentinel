export type SlotUpdate = {
  slot: number;
  parent?: number | null;
  root?: number | null;
  timestamp_ms: number;
  observed_at: string;
  source: "solana_ws" | "yellowstone";
  debug?: {
    slot_status?: string;
    dropped_events?: number;
  };
};

export type SlotStream = {
  start(onSlot: (update: SlotUpdate) => void): Promise<void>;
  stop(): Promise<void>;
};
