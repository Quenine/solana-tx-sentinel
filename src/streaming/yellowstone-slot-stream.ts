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

const defaultMaxQueueSize = 100;

type YellowstoneClient = {
  connect(): Promise<void>;
  subscribe(request: SubscribeRequest): Promise<ClientDuplexStream>;
};

type YellowstoneClientConstructor = new (
  endpoint: string,
  token: string | undefined,
  channelOptions: undefined,
  reconnectOptions: {
    enabled: boolean;
    backoff: {
      initialIntervalMs: number;
      maxRetries: number;
    };
  }
) => YellowstoneClient;

function looksMissing(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized.length === 0 || normalized.includes("placeholder") || normalized.includes("todo");
}

function commitmentLevel(value: YellowstoneCommitment): CommitmentLevel {
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

async function loadYellowstoneClient(): Promise<YellowstoneClientConstructor> {
  try {
    const yellowstone = await import("@triton-one/yellowstone-grpc");
    const moduleShape = yellowstone as {
      default?: unknown;
      Client?: unknown;
    };
    const defaultShape = moduleShape.default as { Client?: unknown } | undefined;
    const client = moduleShape.default ?? moduleShape.Client ?? defaultShape?.Client;

    if (typeof client !== "function") {
      throw new Error("Yellowstone client constructor was not exported by @triton-one/yellowstone-grpc.");
    }

    return client as YellowstoneClientConstructor;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown module load error";

    throw new Error(
      `Unable to load @triton-one/yellowstone-grpc for SLOT_STREAM_SOURCE=yellowstone: ${message}`
    );
  }
}

function parseSlot(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function buildSlotSubscribeRequest(commitment: YellowstoneCommitment): SubscribeRequest {
  return {
    accounts: {},
    slots: {
      slots: {
        filterByCommitment: true,
        interslotUpdates: false
      }
    },
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment: commitmentLevel(commitment),
    accountsDataSlice: []
  };
}

function toSlotUpdate(update: SubscribeUpdate, droppedEvents: number): SlotUpdate | null {
  if (!update.slot) {
    return null;
  }

  const slot = parseSlot(update.slot.slot);

  if (slot === undefined) {
    return null;
  }

  const parent = parseSlot(update.slot.parent);
  const slotStatus = slotStatusName(update.slot.status);
  const now = Date.now();

  return {
    slot,
    ...(parent === undefined ? {} : { parent }),
    ...(slotStatus === "SLOT_FINALIZED" ? { root: slot } : {}),
    timestamp_ms: now,
    observed_at: new Date(now).toISOString(),
    source: "yellowstone",
    debug: {
      slot_status: slotStatus,
      dropped_events: droppedEvents
    }
  };
}

export class YellowstoneSlotStream implements SlotStream {
  private client: YellowstoneClient | null = null;
  private stream: ClientDuplexStream | null = null;
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

    const Client = await loadYellowstoneClient();
    const client = new Client(
      this.options.endpoint,
      looksMissing(this.options.token) ? undefined : this.options.token,
      undefined,
      {
        enabled: true,
        backoff: {
          initialIntervalMs: this.options.reconnectBackoffMs,
          maxRetries: this.options.reconnectMaxAttempts
        }
      }
    );
    this.client = client;
    await client.connect();
    const stream = await client.subscribe(buildSlotSubscribeRequest(this.options.commitment));
    this.stream = stream;

    stream.on("data", (update: SubscribeUpdate) => {
      this.enqueue(update, onSlot);
    });

    stream.on("error", (error: Error) => {
      console.error(`Yellowstone slot stream error: ${error.message}`);
    });

    stream.on("close", () => {
      if (!this.stopping) {
        void this.reconnect(onSlot, attempt + 1);
      }
    });
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

    await new Promise((resolve) => setTimeout(resolve, this.options.reconnectBackoffMs * attempt));
    await this.connect(onSlot, attempt);
  }
}
