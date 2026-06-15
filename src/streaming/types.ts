export type SlotUpdate = {
  slot: number;
  parent?: number | null;
  root?: number | null;
  timestamp_ms: number;
  observed_at: string;
  source: "solana_ws" | "yellowstone";
  transport?: "native" | "grpcurl";
  provider_created_at?: string | null;
  debug?: {
    slot_status?: string;
    dropped_events?: number;
  };
};

export type SlotStream = {
  start(onSlot: (update: SlotUpdate) => void, onError?: (error: Error) => void): Promise<void>;
  stop(): Promise<void>;
};
