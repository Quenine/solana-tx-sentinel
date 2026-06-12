import type { SubscribeUpdate } from "@triton-one/yellowstone-grpc";

import { getEnv } from "../config/env.js";
import {
  formatYellowstoneError,
  loadYellowstoneClient,
  normalizeYellowstoneEndpoint,
  type YellowstoneStream,
  writeFirstAcceptedRequest
} from "../streaming/yellowstone-slot-stream.js";

type ProbeStream = {
  on(event: "data", listener: (update: SubscribeUpdate) => void): ProbeStream;
  on(event: "error", listener: (error: Error) => void): ProbeStream;
  on(event: "end", listener: () => void): ProbeStream;
  on(event: "close", listener: () => void): ProbeStream;
  destroy(): void;
};

function hasSlot(update: SubscribeUpdate): boolean {
  const value = update as unknown as { slot?: { slot?: unknown } };

  return value.slot?.slot !== undefined;
}

async function main(): Promise<void> {
  const env = getEnv();
  const endpoint = normalizeYellowstoneEndpoint(env.YELLOWSTONE_GRPC_ENDPOINT);

  console.log(`Yellowstone endpoint: ${endpoint}`);

  const Client = await loadYellowstoneClient();
  const client = new Client(
    endpoint,
    env.YELLOWSTONE_GRPC_TOKEN.trim().length === 0 ? undefined : env.YELLOWSTONE_GRPC_TOKEN,
    {},
    {
      enabled: true,
      backoff: {
        initialIntervalMs: env.STREAM_RECONNECT_BACKOFF_MS,
        maxRetries: env.STREAM_RECONNECT_MAX_ATTEMPTS
      }
    }
  );

  if (client.connect) {
    await client.connect();
  }

  if (client.getVersion) {
    try {
      const version = await client.getVersion();
      console.log(`getVersion: ${JSON.stringify(version)}`);
    } catch (error) {
      console.error(formatYellowstoneError("getVersion failed", error));
    }
  }

  const stream = (await client.subscribe()) as YellowstoneStream & ProbeStream;
  let settled = false;

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      stream.destroy();

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    stream.on("data", (update) => {
      if (!hasSlot(update)) {
        return;
      }

      console.log(`first slot update: ${JSON.stringify(update.slot)}`);
      finish();
    });

    stream.on("error", (error) => {
      console.error(formatYellowstoneError("subscribe stream error", error));
      finish(error);
    });

    stream.on("end", () => {
      console.error("subscribe stream ended");
    });

    stream.on("close", () => {
      if (!settled) {
        finish(new Error("subscribe stream closed before first slot update"));
      }
    });

    void writeFirstAcceptedRequest(stream, env.YELLOWSTONE_COMMITMENT)
      .then((shape) => {
        console.log(`subscription request shape accepted: ${shape}`);
      })
      .catch((error: unknown) => {
        console.error(formatYellowstoneError("subscription request failed", error));
        finish(error instanceof Error ? error : new Error(String(error)));
      });
  });

  console.log("Yellowstone probe received a real slot update.");
}

main().catch((error: unknown) => {
  console.error(formatYellowstoneError("Yellowstone probe failed", error));
  process.exitCode = 1;
});
