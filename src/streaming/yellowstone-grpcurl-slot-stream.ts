import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import type { YellowstoneCommitment } from "../config/env.js";
import type { SlotStream, SlotUpdate } from "./types.js";

export type YellowstoneGrpcurlSlotStreamOptions = {
  endpoint: string;
  token: string;
  commitment: YellowstoneCommitment;
  firstSlotTimeoutMs?: number;
};

type JsonObject = Record<string, unknown>;

const defaultFirstSlotTimeoutMs = 30_000;
const method = "geyser.Geyser/Subscribe";

function endpointForGrpcurl(endpoint: string): string {
  return endpoint.trim().replace(/^https?:\/\//, "");
}

function commitmentForGrpcurl(commitment: YellowstoneCommitment): "PROCESSED" | "CONFIRMED" | "FINALIZED" {
  switch (commitment) {
    case "processed":
      return "PROCESSED";
    case "confirmed":
      return "CONFIRMED";
    case "finalized":
      return "FINALIZED";
  }
}

function subscriptionRequest(commitment: YellowstoneCommitment): string {
  return JSON.stringify({
    slots: {
      client: {
        filterByCommitment: true
      }
    },
    commitment: commitmentForGrpcurl(commitment)
  });
}

function parseSlot(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function slotObject(value: JsonObject): JsonObject | null {
  const slot = value.slot;

  return typeof slot === "object" && slot !== null && !Array.isArray(slot) ? (slot as JsonObject) : null;
}

function normalizeSlotUpdate(value: JsonObject): SlotUpdate | null {
  const rawSlot = slotObject(value);

  if (!rawSlot) {
    return null;
  }

  const slot = parseSlot(rawSlot.slot);

  if (slot === null) {
    return null;
  }

  const now = Date.now();

  return {
    slot,
    parent: parseSlot(rawSlot.parent),
    root: parseSlot(rawSlot.root),
    source: "yellowstone",
    transport: "grpcurl",
    observed_at: new Date(now).toISOString(),
    timestamp_ms: now,
    provider_created_at: stringValue(rawSlot.createdAt ?? value.createdAt),
    ...(typeof rawSlot.status === "string" ? { debug: { slot_status: rawSlot.status } } : {})
  };
}

class JsonObjectStreamParser {
  private buffer = "";
  private depth = 0;
  private inString = false;
  private escape = false;
  private objectStart = -1;

  push(chunk: string): JsonObject[] {
    this.buffer += chunk;
    const objects: JsonObject[] = [];
    let consumedThrough = 0;

    for (let index = 0; index < this.buffer.length; index += 1) {
      const char = this.buffer[index];

      if (this.inString) {
        if (this.escape) {
          this.escape = false;
        } else if (char === "\\") {
          this.escape = true;
        } else if (char === "\"") {
          this.inString = false;
        }

        continue;
      }

      if (char === "\"") {
        this.inString = true;
        continue;
      }

      if (char === "{") {
        if (this.depth === 0) {
          this.objectStart = index;
        }

        this.depth += 1;
        continue;
      }

      if (char !== "}") {
        continue;
      }

      this.depth -= 1;

      if (this.depth !== 0 || this.objectStart < 0) {
        continue;
      }

      const raw = this.buffer.slice(this.objectStart, index + 1);
      consumedThrough = index + 1;
      this.objectStart = -1;

      const parsed = JSON.parse(raw) as unknown;

      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        objects.push(parsed as JsonObject);
      }
    }

    if (consumedThrough > 0) {
      this.buffer = this.buffer.slice(consumedThrough);
    }

    return objects;
  }
}

async function assertGrpcurlAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("grpcurl", ["-version"], {
      windowsHide: true
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("grpcurl is required for SLOT_STREAM_SOURCE=yellowstone_grpcurl"));
        return;
      }

      reject(error);
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error("grpcurl is required for SLOT_STREAM_SOURCE=yellowstone_grpcurl"));
    });
  });
}

export class YellowstoneGrpcurlSlotStream implements SlotStream {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private observedSlots = 0;
  private stderr = "";
  private firstSlotTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: YellowstoneGrpcurlSlotStreamOptions) {}

  async start(onSlot: (update: SlotUpdate) => void, onError?: (error: Error) => void): Promise<void> {
    await assertGrpcurlAvailable();

    const endpoint = endpointForGrpcurl(this.options.endpoint);

    if (endpoint.length === 0) {
      throw new Error("YELLOWSTONE_GRPC_ENDPOINT is required for SLOT_STREAM_SOURCE=yellowstone_grpcurl");
    }

    const args = [
      "-H",
      `x-token: ${this.options.token}`,
      "-d",
      subscriptionRequest(this.options.commitment),
      endpoint,
      method
    ];
    const child = spawn("grpcurl", args, {
      windowsHide: true
    });
    const decoder = new StringDecoder("utf8");
    const parser = new JsonObjectStreamParser();

    this.child = child;
    this.stopping = false;
    this.observedSlots = 0;
    this.stderr = "";

    this.firstSlotTimer = setTimeout(() => {
      const message = `No Yellowstone slot updates received from grpcurl within ${
        this.options.firstSlotTimeoutMs ?? defaultFirstSlotTimeoutMs
      } ms. stderr=${this.stderr.trim() || "not available"}`;
      this.stopChild();
      onError?.(new Error(message));
    }, this.options.firstSlotTimeoutMs ?? defaultFirstSlotTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      let objects: JsonObject[];

      try {
        objects = parser.push(decoder.write(chunk));
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
        this.stopChild();
        return;
      }

      for (const object of objects) {
        const update = normalizeSlotUpdate(object);

        if (!update) {
          continue;
        }

        this.observedSlots += 1;

        if (this.firstSlotTimer) {
          clearTimeout(this.firstSlotTimer);
          this.firstSlotTimer = null;
        }

        onSlot(update);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        onError?.(new Error("grpcurl is required for SLOT_STREAM_SOURCE=yellowstone_grpcurl"));
        return;
      }

      onError?.(error);
    });

    child.once("exit", (code, signal) => {
      if (this.firstSlotTimer) {
        clearTimeout(this.firstSlotTimer);
        this.firstSlotTimer = null;
      }

      if (this.stopping) {
        return;
      }

      onError?.(
        new Error(
          `grpcurl exited before capture completed; code=${code ?? "not available"} signal=${
            signal ?? "not available"
          } captured_count=${this.observedSlots} stderr=${this.stderr.trim() || "not available"}`
        )
      );
    });

    console.error(`Yellowstone grpcurl stream started endpoint=${endpoint} method=${method}`);
  }

  async stop(): Promise<void> {
    this.stopping = true;

    if (this.firstSlotTimer) {
      clearTimeout(this.firstSlotTimer);
      this.firstSlotTimer = null;
    }

    this.stopChild();
  }

  private stopChild(): void {
    if (!this.child || this.child.killed) {
      return;
    }

    this.child.kill("SIGTERM");
    this.child = null;
  }
}
