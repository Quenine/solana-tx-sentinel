import { readFile } from "node:fs/promises";

import type { SubscribeUpdate } from "@triton-one/yellowstone-grpc";

import { getEnv } from "../config/env.js";
import {
  buildSlotSubscribeRequests,
  formatYellowstoneError,
  loadYellowstoneClient,
  normalizeYellowstoneEndpoint,
  type YellowstoneClient,
  type YellowstoneClientConstructor,
  type YellowstoneStream,
  writeSlotSubscribeRequest,
  yellowstoneEndpointVariants
} from "../streaming/yellowstone-slot-stream.js";

type Stage =
  | "client construction"
  | "client connect"
  | "getVersion"
  | "subscribe open"
  | "request write"
  | "waiting for first data";

type ProbeResult = "received_data" | "timeout" | "stream_error" | "closed";

const firstDataTimeoutMs = 15_000;

function hasSlot(update: SubscribeUpdate): boolean {
  const value = update as unknown as { slot?: { slot?: unknown } };

  return value.slot?.slot !== undefined;
}

async function packageVersion(): Promise<string> {
  try {
    const raw = await readFile("node_modules/@triton-one/yellowstone-grpc/package.json", "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };

    return typeof parsed.version === "string" ? parsed.version : "not available";
  } catch {
    return "not available";
  }
}

function stageError(stage: Stage, error: unknown): void {
  console.error(`stage=${stage}`);
  console.error(formatYellowstoneError("yellowstone probe error", error));
}

async function constructClient(
  Client: YellowstoneClientConstructor,
  endpoint: string,
  token: string,
  reconnectBackoffMs: number,
  reconnectMaxAttempts: number
): Promise<YellowstoneClient | null> {
  try {
    return new Client(endpoint, token.trim().length === 0 ? undefined : token, {}, {
      enabled: true,
      backoff: {
        initialIntervalMs: reconnectBackoffMs,
        maxRetries: reconnectMaxAttempts
      }
    });
  } catch (error) {
    stageError("client construction", error);
    return null;
  }
}

async function connectClient(client: YellowstoneClient): Promise<boolean> {
  if (!client.connect) {
    console.log("client.connect: not available");
    return true;
  }

  try {
    await client.connect();
    console.log("client.connect: ok");
    return true;
  } catch (error) {
    stageError("client connect", error);
    return false;
  }
}

async function callGetVersion(client: YellowstoneClient): Promise<boolean> {
  if (!client.getVersion) {
    console.log("getVersion: not available");
    return false;
  }

  try {
    const version = await client.getVersion();
    console.log(`getVersion: ok ${JSON.stringify(version)}`);
    return true;
  } catch (error) {
    stageError("getVersion", error);
    return false;
  }
}

async function openStream(client: YellowstoneClient, getVersionSucceeded: boolean): Promise<YellowstoneStream | null> {
  try {
    const stream = await client.subscribe();
    console.log("subscribe open: ok");
    return stream;
  } catch (error) {
    stageError("subscribe open", error);

    if (getVersionSucceeded) {
      console.error("Likely stream permission/access issue or provider-side stream setup issue.");
    }

    return null;
  }
}

async function waitForFirstSlot(stream: YellowstoneStream): Promise<ProbeResult> {
  return await new Promise<ProbeResult>((resolve) => {
    let settled = false;

    const finish = (result: ProbeResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      stream.destroy();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      console.error("Stream opened but no slot updates received.");
      finish("timeout");
    }, firstDataTimeoutMs);

    stream.on("data", (update: SubscribeUpdate) => {
      if (!hasSlot(update)) {
        return;
      }

      console.log(`first slot update: ${JSON.stringify(update.slot)}`);
      finish("received_data");
    });

    stream.on("error", (error: Error) => {
      stageError("waiting for first data", error);
      finish("stream_error");
    });

    stream.on("end", () => {
      console.error("subscribe stream ended");
    });

    stream.on("close", () => {
      if (!settled) {
        console.error("subscribe stream closed before first slot update");
        finish("closed");
      }
    });
  });
}

async function tryShape(
  Client: YellowstoneClientConstructor,
  endpoint: string,
  token: string,
  reconnectBackoffMs: number,
  reconnectMaxAttempts: number,
  getVersionSucceeded: boolean,
  shapeIndex: number
): Promise<boolean> {
  const shape = buildSlotSubscribeRequests("processed")[shapeIndex];

  if (!shape) {
    return false;
  }

  console.log(`request shape ${shape.name}: start`);

  const client = await constructClient(Client, endpoint, token, reconnectBackoffMs, reconnectMaxAttempts);

  if (!client) {
    return false;
  }

  const connected = await connectClient(client);

  if (!connected) {
    return false;
  }

  const stream = await openStream(client, getVersionSucceeded);

  if (!stream) {
    return false;
  }

  try {
    await writeSlotSubscribeRequest(stream, shape);
    console.log(`request shape ${shape.name}: write ok`);
  } catch (error) {
    stageError("request write", error);
    console.error("Likely request shape/protobuf mismatch.");
    stream.destroy();
    return false;
  }

  const result = await waitForFirstSlot(stream);

  return result === "received_data";
}

async function tryEndpoint(
  Client: YellowstoneClientConstructor,
  endpoint: string,
  token: string,
  reconnectBackoffMs: number,
  reconnectMaxAttempts: number
): Promise<boolean> {
  console.log("");
  console.log(`endpoint variant: ${endpoint}`);

  const client = await constructClient(Client, endpoint, token, reconnectBackoffMs, reconnectMaxAttempts);

  if (!client) {
    return false;
  }

  const connected = await connectClient(client);

  if (!connected) {
    return false;
  }

  const getVersionSucceeded = await callGetVersion(client);

  for (const shapeIndex of [0, 1, 2]) {
    const ok = await tryShape(Client, endpoint, token, reconnectBackoffMs, reconnectMaxAttempts, getVersionSucceeded, shapeIndex);

    if (ok) {
      return true;
    }
  }

  return false;
}

async function main(): Promise<void> {
  const env = getEnv();
  const tokenLength = env.YELLOWSTONE_GRPC_TOKEN.length;
  const endpoint = env.YELLOWSTONE_GRPC_ENDPOINT;
  const normalizedEndpoint = normalizeYellowstoneEndpoint(endpoint);

  console.log(`endpoint: ${endpoint}`);
  console.log(`normalized_endpoint: ${normalizedEndpoint}`);
  console.log(`package_version: ${await packageVersion()}`);
  console.log(`token_present: ${tokenLength > 0}`);
  console.log(`token_length: ${tokenLength}`);

  const Client = await loadYellowstoneClient();
  const endpoints = yellowstoneEndpointVariants(endpoint);

  for (const candidateEndpoint of endpoints) {
    const ok = await tryEndpoint(
      Client,
      candidateEndpoint,
      env.YELLOWSTONE_GRPC_TOKEN,
      env.STREAM_RECONNECT_BACKOFF_MS,
      env.STREAM_RECONNECT_MAX_ATTEMPTS
    );

    if (ok) {
      console.log("Yellowstone probe received a real slot update.");
      return;
    }
  }

  throw new Error("Yellowstone probe did not receive a slot update from any endpoint/request-shape combination.");
}

main().catch((error: unknown) => {
  console.error(formatYellowstoneError("Yellowstone probe failed", error));
  process.exitCode = 1;
});
