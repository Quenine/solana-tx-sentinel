import type {
  ClientDuplexStream,
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate
} from "@triton-one/yellowstone-grpc";

import type { SlotStream, SlotUpdate } from "./types.js";

export type YellowstoneCommitment = "processed" | "confirmed" | "finalized";

export type YellowstoneSlotStreamOptions = {
  endpoint: string;
  token: string;
  commitment: YellowstoneCommitment;
  reconnectMaxAttempts: number;
  reconnectBackoffMs: number;
  maxQueueSize?: number;
};

type YellowstoneError = Error & {
  code?: number | string;
  details?: string;
  metadata?: unknown;
};

export type YellowstoneStream = ClientDuplexStream & {
  write(chunk: SubscribeRequest, callback?: (error?: Error | null) => void): boolean;
};

export type YellowstoneClient = {
  connect?: () => Promise<void>;
  getVersion?: () => Promise<unknown>;
  subscribe: () => Promise<YellowstoneStream> | YellowstoneStream;
};

export type YellowstoneClientConstructor = new (
  endpoint: string,
  token: string | undefined,
  channelOptions: Record<string, never>,
  reconnectOptions: {
    enabled: boolean;
    backoff: {
      initialIntervalMs: number;
      maxRetries: number;
    };
  }
) => YellowstoneClient;

const defaultMaxQueueSize = 100;

function looksMissing(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized.length === 0 || normalized.includes("placeholder") || normalized.includes("todo");
}

export function normalizeYellowstoneEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function formatYellowstoneError(prefix: string, error: unknown): string {
  if (!(error instanceof Error)) {
    return `${prefix}: ${String(error)}`;
  }

  const grpcError = error as YellowstoneError;
  const parts = [`${prefix}: ${grpcError.message}`];

  if (grpcError.code !== undefined) {
    parts.push(`code=${grpcError.code}`);
  }

  if (grpcError.details) {
    parts.push(`details=${grpcError.details}`);
  }

  if (grpcError.metadata !== undefined) {
    parts.push(`metadata=${safeJson(grpcError.metadata)}`);
  }

  if (grpcError.code === 16 || /unauthenticated/i.test(grpcError.message) || /unauthenticated/i.test(grpcError.details ?? "")) {
    parts.push("authentication failed; check YELLOWSTONE_GRPC_TOKEN");
  }

  if (grpcError.code === 7 || /permission denied/i.test(grpcError.message) || /permission denied/i.test(grpcError.details ?? "")) {
    parts.push("permission denied; check endpoint access and token scope");
  }

  return parts.join(" ");
}

export async function loadYellowstoneClient(): Promise<YellowstoneClientConstructor> {
  try {
    const mod = await import("@triton-one/yellowstone-grpc");
    const moduleShape = mod as {
      default?: unknown;
      Client?: unknown;
    };
    const client = moduleShape.default ?? moduleShape.Client;

    if (typeof client !== "function") {
      throw new Error("Yellowstone client constructor was not exported as default or Client.");
    }

    return client as YellowstoneClientConstructor;
  } catch (error) {
    throw new Error(formatYellowstoneError("Unable to load @triton-one/yellowstone-grpc", error));
  }
}

export function commitmentLevel(value: YellowstoneCommitment): CommitmentLevel {
  switch (value) {
    case "processed":
      return 0 as CommitmentLevel;
    case "confirmed":
      return 1 as CommitmentLevel;
    case "finalized":
      return 2 as CommitmentLevel;
  }
}

function slotStatusName(value: unknown): string {
  switch (Number(value)) {
    case 0:
      return "SLOT_PROCESSED";
    case 1:
      return "SLOT_CONFIRMED";
    case 2:
      return "SLOT_FINALIZED";
    case 3:
      return "SLOT_FIRST_SHRED_RECEIVED";
    case 4:
      return "SLOT_COMPLETED";
    case 5:
      return "SLOT_CREATED_BANK";
    case 6:
      return "SLOT_DEAD";
    default:
      return "SLOT_UNKNOWN";
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseSlot(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

type SlotRequestShape = {
  name: "client" | "slots" | "slot";
  request: SubscribeRequest;
};

export function buildSlotSubscribeRequests(commitment: YellowstoneCommitment): SlotRequestShape[] {
  const base = {
    accounts: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: commitmentLevel(commitment),
    ping: undefined
  };

  return [
    {
      name: "client",
      request: {
        ...base,
        slots: {
          client: {
            filterByCommitment: true
          }
        }
      } as SubscribeRequest
    },
    {
      name: "slots",
      request: {
        ...base,
        slots: {
          slots: {
            filterByCommitment: true
          }
        }
      } as SubscribeRequest
    },
    {
      name: "slot",
      request: {
        ...base,
        slots: {
          slot: {
            filterByCommitment: true
          }
        }
      } as SubscribeRequest
    }
  ];
}

function isPingOnly(update: SubscribeUpdate): boolean {
  const value = update as unknown as { ping?: unknown; pong?: unknown; slot?: unknown };

  return value.slot === undefined && (value.ping !== undefined || value.pong !== undefined);
}

function toSlotUpdate(update: SubscribeUpdate, droppedEvents: number): SlotUpdate | null {
  if (isPingOnly(update)) {
    return null;
  }

  const raw = update as SubscribeUpdate & {
    slot?: {
      slot?: unknown;
      parent?: unknown;
      root?: unknown;
      status?: unknown;
    };
    slotStatus?: unknown;
  };

  if (!raw.slot) {
    return null;
  }

  const slot = parseSlot(raw.slot.slot);

  if (slot === null) {
    return null;
  }

  const parent = parseSlot(raw.slot.parent);
  const explicitRoot = parseSlot(raw.slot.root);
  const slotStatus = slotStatusName(raw.slot.status ?? raw.slotStatus);
  const root = explicitRoot ?? (slotStatus === "SLOT_FINALIZED" ? slot : null);
  const now = Date.now();

  return {
    slot,
    parent,
    root,
    timestamp_ms: now,
    observed_at: new Date(now).toISOString(),
    source: "yellowstone",
    debug: {
      slot_status: slotStatus,
      dropped_events: droppedEvents
    }
  };
}

async function writeRequest(stream: YellowstoneStream, shape: SlotRequestShape): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    try {
      stream.write(shape.request, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function writeFirstAcceptedRequest(
  stream: YellowstoneStream,
  commitment: YellowstoneCommitment
): Promise<SlotRequestShape["name"]> {
  const failures: string[] = [];

  for (const shape of buildSlotSubscribeRequests(commitment)) {
    try {
      await writeRequest(stream, shape);
      return shape.name;
    } catch (error) {
      failures.push(`${shape.name}: ${formatYellowstoneError("subscription request write failed", error)}`);
    }
  }

  throw new Error(`Yellowstone subscription request shape rejected. ${failures.join(" | ")}`);
}

export class YellowstoneSlotStream implements SlotStream {
  private client: YellowstoneClient | null = null;
  private stream: YellowstoneStream | null = null;
  private stopping = false;
  private started = false;
  private queue: SubscribeUpdate[] = [];
  private processing = false;
  private droppedEvents = 0;

  constructor(private readonly options: YellowstoneSlotStreamOptions) {}

  async start(onSlot: (update: SlotUpdate) => void): Promise<void> {
    if (this.started) {
      throw new Error("Yellowstone slot stream is already running.");
    }

    if (looksMissing(this.options.endpoint)) {
      throw new Error("YELLOWSTONE_GRPC_ENDPOINT must be set to a real Yellowstone/Geyser endpoint.");
    }

    this.started = true;
    this.stopping = false;
    await this.connect(onSlot, 0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    this.queue = [];

    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }
  }

  private async connect(onSlot: (update: SlotUpdate) => void, attempt: number): Promise<void> {
    if (this.stopping) {
      return;
    }

    const endpoint = normalizeYellowstoneEndpoint(this.options.endpoint);
    const Client = await loadYellowstoneClient();
    const client = new Client(
      endpoint,
      looksMissing(this.options.token) ? undefined : this.options.token,
      {},
      {
        enabled: true,
        backoff: {
          initialIntervalMs: this.options.reconnectBackoffMs,
          maxRetries: this.options.reconnectMaxAttempts
        }
      }
    );
    this.client = client;

    try {
      if (client.connect) {
        await client.connect();
      }

      const stream = await client.subscribe();
      this.stream = stream;

      stream.on("data", (update: SubscribeUpdate) => {
        this.enqueue(update, onSlot);
      });

      stream.on("error", (error: Error) => {
        console.error(formatYellowstoneError("Yellowstone slot stream error", error));
      });

      stream.on("end", () => {
        console.error("Yellowstone slot stream ended.");
      });

      stream.on("close", () => {
        if (!this.stopping) {
          void this.reconnect(onSlot, attempt + 1);
        }
      });

      const shape = await writeFirstAcceptedRequest(stream, this.options.commitment);
      console.error(`Yellowstone slot subscription active endpoint=${endpoint} request_shape=${shape}`);
    } catch (error) {
      throw new Error(formatYellowstoneError("Yellowstone subscribe setup failed", error));
    }
  }

  private enqueue(update: SubscribeUpdate, onSlot: (update: SlotUpdate) => void): void {
    const maxQueueSize = this.options.maxQueueSize ?? defaultMaxQueueSize;

    if (this.queue.length >= maxQueueSize) {
      this.droppedEvents += 1;
      console.error(`Yellowstone slot stream queue full; dropped_events=${this.droppedEvents}`);
      return;
    }

    this.queue.push(update);
    void this.processQueue(onSlot);
  }

  private async processQueue(onSlot: (update: SlotUpdate) => void): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const raw = this.queue.shift();

        if (!raw) {
          continue;
        }

        const normalized = toSlotUpdate(raw, this.droppedEvents);

        if (normalized) {
          onSlot(normalized);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async reconnect(onSlot: (update: SlotUpdate) => void, attempt: number): Promise<void> {
    if (attempt > this.options.reconnectMaxAttempts) {
      console.error(`Yellowstone slot stream stopped after ${this.options.reconnectMaxAttempts} reconnect attempts.`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, this.options.reconnectBackoffMs * Math.max(attempt, 1)));

    try {
      await this.connect(onSlot, attempt);
    } catch (error) {
      console.error(formatYellowstoneError("Yellowstone reconnect failed", error));
      void this.reconnect(onSlot, attempt + 1);
    }
  }
}
