import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { Connection } from "@solana/web3.js";

import type { JitoBundleSubmitLog } from "../jito/bundle-sender.js";
import { jitoBundleLogPath } from "../lifecycle/log-writer.js";
import { getLeaderForSlot, loadCurrentLeaderSchedule } from "./leader-schedule.js";
import type { LoadedLeaderSchedule } from "./types.js";

export type ObservedJitoLeader = {
  leader: string;
  landing_count: number;
  landed_slots: number[];
  first_seen_at: string;
  last_seen_at: string;
};

export type ObservedJitoLeadersFile = {
  generated_at: string;
  source_path: string;
  observed_leader_count: number;
  unresolved_landed_slot_count: number;
  leaders: ObservedJitoLeader[];
  notes: string[];
};

type LeaderAccumulator = {
  leader: string;
  landedSlots: number[];
  firstSeenAt: string;
  lastSeenAt: string;
};

function isLandedBundle(entry: JitoBundleSubmitLog): boolean {
  return entry.bundle_status?.final_bundle_status === "Landed" || entry.bundle_status?.landed_slot !== undefined;
}

function landedSlot(entry: JitoBundleSubmitLog): number | null {
  return entry.bundle_status?.landed_slot ?? null;
}

async function readBundleLogs(path: string): Promise<JitoBundleSubmitLog[]> {
  const content = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as JitoBundleSubmitLog;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown parse error";
        throw new Error(`Could not parse ${path} line ${index + 1}: ${message}`);
      }
    });
}

function recordLeader(accumulators: Map<string, LeaderAccumulator>, leader: string, slot: number, seenAt: string): void {
  const current = accumulators.get(leader);

  if (!current) {
    accumulators.set(leader, {
      leader,
      landedSlots: [slot],
      firstSeenAt: seenAt,
      lastSeenAt: seenAt
    });
    return;
  }

  current.landedSlots.push(slot);

  if (seenAt < current.firstSeenAt) {
    current.firstSeenAt = seenAt;
  }

  if (seenAt > current.lastSeenAt) {
    current.lastSeenAt = seenAt;
  }
}

function toObservedLeader(accumulator: LeaderAccumulator): ObservedJitoLeader {
  const landedSlots = [...new Set(accumulator.landedSlots)].sort((a, b) => a - b);

  return {
    leader: accumulator.leader,
    landing_count: accumulator.landedSlots.length,
    landed_slots: landedSlots,
    first_seen_at: accumulator.firstSeenAt,
    last_seen_at: accumulator.lastSeenAt
  };
}

export async function learnObservedJitoLeaders(input: {
  connection: Connection;
  outputPath: string;
  sourcePath?: string;
  schedule?: LoadedLeaderSchedule;
}): Promise<ObservedJitoLeadersFile> {
  const sourcePath = input.sourcePath ?? jitoBundleLogPath;
  const schedule = input.schedule ?? (await loadCurrentLeaderSchedule(input.connection));
  const entries = await readBundleLogs(sourcePath);
  const leaders = new Map<string, LeaderAccumulator>();
  let landedWithoutSlotCount = 0;
  let unresolvedLandedSlotCount = 0;

  for (const entry of entries) {
    if (!isLandedBundle(entry)) {
      continue;
    }

    const slot = landedSlot(entry);

    if (slot === null) {
      landedWithoutSlotCount += 1;
      continue;
    }

    const leader = getLeaderForSlot(schedule, slot);

    if (!leader) {
      unresolvedLandedSlotCount += 1;
      continue;
    }

    recordLeader(leaders, leader, slot, entry.created_at);
  }

  const observedLeaders = [...leaders.values()]
    .map(toObservedLeader)
    .sort((a, b) => b.landing_count - a.landing_count || a.leader.localeCompare(b.leader));
  const notes: string[] = [];

  if (observedLeaders.length === 0) {
    notes.push("No landed bundle slots could be resolved to leaders from the available schedule.");
  }

  if (landedWithoutSlotCount > 0) {
    notes.push(`${landedWithoutSlotCount} landed bundle entries did not include landed_slot.`);
  }

  if (unresolvedLandedSlotCount > 0) {
    notes.push(`${unresolvedLandedSlotCount} landed slots were outside the loaded leader schedule.`);
  }

  const result: ObservedJitoLeadersFile = {
    generated_at: new Date().toISOString(),
    source_path: sourcePath,
    observed_leader_count: observedLeaders.length,
    unresolved_landed_slot_count: unresolvedLandedSlotCount,
    leaders: observedLeaders,
    notes
  };

  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  return result;
}

export async function loadObservedJitoLeaders(path: string): Promise<ObservedJitoLeadersFile | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ObservedJitoLeadersFile;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
