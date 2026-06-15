import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Connection } from "@solana/web3.js";

import { getEnv } from "../config/env.js";
import { getLeaderForSlot, loadCurrentLeaderSchedule } from "../leaders/leader-schedule.js";
import { createSlotStream } from "../streaming/create-slot-stream.js";
import type { SlotUpdate } from "../streaming/types.js";
import { defaultCommitment } from "../types/solana.js";

const evidencePath = "data/stream/slot-stream-evidence.jsonl";
const summaryPath = "data/stream/latest-stream-evidence-summary.json";

type StreamEvidenceEntry = {
  source: SlotUpdate["source"];
  transport: SlotUpdate["transport"] | null;
  slot: number;
  parent: number | null;
  root: number | null;
  leader: string | null;
  observed_at: string;
  provider_created_at?: string | null;
  timestamp_ms: number;
  debug?: SlotUpdate["debug"];
};

type StreamEvidenceSummary = {
  source: SlotUpdate["source"];
  transport: SlotUpdate["transport"] | null;
  requested_count: number;
  captured_count: number;
  first_slot: number | null;
  last_slot: number | null;
  unique_leader_count: number;
  started_at: string;
  finished_at: string;
};

async function appendJsonLine(path: string, entry: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const env = getEnv();
  const requestedCount = env.STREAM_EVIDENCE_EVENT_COUNT;
  const startedAt = new Date().toISOString();
  const connection = new Connection(env.SOLANA_RPC_URL, {
    commitment: defaultCommitment,
    wsEndpoint: env.SOLANA_WS_URL
  });
  const schedule = await loadCurrentLeaderSchedule(connection);
  const stream = await createSlotStream(connection, env);
  const entries: StreamEvidenceEntry[] = [];
  const leaders = new Set<string>();
  const pendingWrites: Array<Promise<void>> = [];

  console.error(`Capturing ${requestedCount} slot updates from ${env.SLOT_STREAM_SOURCE}.`);

  await new Promise<void>((resolve, reject) => {
    let resolved = false;

    void stream
      .start((update) => {
        if (entries.length >= requestedCount) {
          return;
        }

        const leader = getLeaderForSlot(schedule, update.slot) ?? null;
        const entry: StreamEvidenceEntry = {
          source: update.source,
          transport: update.transport ?? null,
          slot: update.slot,
          parent: update.parent ?? null,
          root: update.root ?? null,
          leader,
          observed_at: update.observed_at,
          ...(update.provider_created_at === undefined ? {} : { provider_created_at: update.provider_created_at }),
          timestamp_ms: update.timestamp_ms,
          ...(update.debug === undefined ? {} : { debug: update.debug })
        };

        entries.push(entry);

        if (leader) {
          leaders.add(leader);
        }

        pendingWrites.push(appendJsonLine(evidencePath, entry));

        if (!resolved && entries.length >= requestedCount) {
          resolved = true;
          void stream.stop().then(resolve).catch(reject);
        }
      }, (error) => {
        if (resolved) {
          return;
        }

        resolved = true;
        reject(error);
      })
      .catch(reject);
  });

  await Promise.all(pendingWrites);

  const finishedAt = new Date().toISOString();
  const summary: StreamEvidenceSummary = {
    source: entries[0]?.source ?? (env.SLOT_STREAM_SOURCE === "solana_ws" ? "solana_ws" : "yellowstone"),
    transport: entries[0]?.transport ?? null,
    requested_count: requestedCount,
    captured_count: entries.length,
    first_slot: entries[0]?.slot ?? null,
    last_slot: entries.at(-1)?.slot ?? null,
    unique_leader_count: leaders.size,
    started_at: startedAt,
    finished_at: finishedAt
  };

  await writeJson(summaryPath, summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown stream evidence capture error";
  console.error(message);
  process.exitCode = 1;
});
