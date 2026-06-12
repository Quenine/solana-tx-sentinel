import type { Connection } from "@solana/web3.js";

import type { SlotStream, SlotUpdate } from "./types.js";

export class SolanaWsSlotStream implements SlotStream {
  private subscriptionId: number | null = null;

  constructor(private readonly connection: Connection) {}

  async start(onSlot: (update: SlotUpdate) => void): Promise<void> {
    if (this.subscriptionId !== null) {
      throw new Error("Solana websocket slot stream is already running.");
    }

    this.subscriptionId = this.connection.onSlotChange((slotInfo) => {
      const now = Date.now();

      onSlot({
        slot: slotInfo.slot,
        parent: slotInfo.parent,
        root: slotInfo.root,
        timestamp_ms: now,
        observed_at: new Date(now).toISOString(),
        source: "solana_ws"
      });
    });
  }

  async stop(): Promise<void> {
    if (this.subscriptionId === null) {
      return;
    }

    const subscriptionId = this.subscriptionId;
    this.subscriptionId = null;
    await this.connection.removeSlotChangeListener(subscriptionId);
  }
}
