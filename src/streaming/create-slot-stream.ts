import type { Connection } from "@solana/web3.js";

import type { Env } from "../config/env.js";
import type { SlotStream } from "./types.js";
import { SolanaWsSlotStream } from "./solana-ws-slot-stream.js";

export async function createSlotStream(connection: Connection, env: Env): Promise<SlotStream> {
  switch (env.SLOT_STREAM_SOURCE) {
    case "solana_ws":
      return new SolanaWsSlotStream(connection);

    case "yellowstone": {
      const { YellowstoneSlotStream } = await import("./yellowstone-slot-stream.js");

      return new YellowstoneSlotStream({
        endpoint: env.YELLOWSTONE_GRPC_ENDPOINT,
        token: env.YELLOWSTONE_GRPC_TOKEN,
        commitment: env.YELLOWSTONE_COMMITMENT,
        reconnectMaxAttempts: env.STREAM_RECONNECT_MAX_ATTEMPTS,
        reconnectBackoffMs: env.STREAM_RECONNECT_BACKOFF_MS
      });
    }

    case "yellowstone_grpcurl": {
      const { YellowstoneGrpcurlSlotStream } = await import("./yellowstone-grpcurl-slot-stream.js");

      return new YellowstoneGrpcurlSlotStream({
        endpoint: env.YELLOWSTONE_GRPC_ENDPOINT,
        token: env.YELLOWSTONE_GRPC_TOKEN,
        commitment: env.YELLOWSTONE_COMMITMENT
      });
    }
  }
}
