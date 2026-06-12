import type { Connection } from "@solana/web3.js";

import { getLeaderForSlot, loadCurrentLeaderSchedule } from "../leaders/leader-schedule.js";
import { loadObservedJitoLeaders, type ObservedJitoLeader } from "../leaders/observed-jito-leaders.js";
import type { LoadedLeaderSchedule } from "../leaders/types.js";
import type { SubmissionTimingOptions, TimingDecision } from "./types.js";

const defaultPollIntervalMs = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateOptions(options: SubmissionTimingOptions): void {
  if (!Number.isSafeInteger(options.lookaheadSlots) || options.lookaheadSlots <= 0) {
    throw new Error("SUBMISSION_LOOKAHEAD_SLOTS must be a positive integer.");
  }

  if (!Number.isSafeInteger(options.targetDistanceMin) || options.targetDistanceMin < 0) {
    throw new Error("SUBMISSION_TARGET_DISTANCE_MIN must be a non-negative integer.");
  }

  if (!Number.isSafeInteger(options.targetDistanceMax) || options.targetDistanceMax < options.targetDistanceMin) {
    throw new Error("SUBMISSION_TARGET_DISTANCE_MAX must be greater than or equal to SUBMISSION_TARGET_DISTANCE_MIN.");
  }

  if (!Number.isSafeInteger(options.observedJitoLeaderMinLandings) || options.observedJitoLeaderMinLandings <= 0) {
    throw new Error("OBSERVED_JITO_LEADER_MIN_LANDINGS must be a positive integer.");
  }
}

function shouldReloadSchedule(schedule: LoadedLeaderSchedule, currentSlot: number, lookaheadSlots: number): boolean {
  return currentSlot < schedule.firstSlot || currentSlot + lookaheadSlots > schedule.lastSlot;
}

function inspectTimingWindow(input: {
  schedule: LoadedLeaderSchedule;
  currentSlot: number;
  lookaheadSlots: number;
  targetDistanceMin: number;
  targetDistanceMax: number;
  observedLeaders: Map<string, ObservedJitoLeader>;
}): TimingDecision {
  const currentLeader = getLeaderForSlot(input.schedule, input.currentSlot);
  const maxDistance = Math.min(input.lookaheadSlots, input.targetDistanceMax);
  const observedLeaderCount = input.observedLeaders.size;

  if (observedLeaderCount > 0) {
    for (let distance = input.targetDistanceMin; distance <= input.lookaheadSlots; distance += 1) {
      const slot = input.currentSlot + distance;
      const leader = getLeaderForSlot(input.schedule, slot);
      const observedLeader = leader ? input.observedLeaders.get(leader) : undefined;

      if (leader && observedLeader) {
        if (distance > input.targetDistanceMax) {
          return {
            decision: "wait",
            strategy: "observed_jito_leader",
            current_slot: input.currentSlot,
            ...(currentLeader === undefined ? {} : { current_leader: currentLeader }),
            target_slot: slot,
            target_leader: leader,
            slots_until_target: distance,
            observed_leader_count: observedLeaderCount,
            target_leader_landing_count: observedLeader.landing_count,
            reason: `Observed landed Jito leader is ${distance} slots away, outside target distance ${input.targetDistanceMin}-${input.targetDistanceMax}.`,
            observed_at: new Date().toISOString()
          };
        }

        return {
          decision: "submit_now",
          strategy: "observed_jito_leader",
          current_slot: input.currentSlot,
          ...(currentLeader === undefined ? {} : { current_leader: currentLeader }),
          target_slot: slot,
          target_leader: leader,
          slots_until_target: distance,
          observed_leader_count: observedLeaderCount,
          target_leader_landing_count: observedLeader.landing_count,
          reason: `Observed landed Jito leader is ${distance} slots away.`,
          observed_at: new Date().toISOString()
        };
      }
    }

    return {
      decision: "wait",
      strategy: "observed_jito_leader",
      current_slot: input.currentSlot,
      ...(currentLeader === undefined ? {} : { current_leader: currentLeader }),
      observed_leader_count: observedLeaderCount,
      reason: `No observed landed Jito leader found ${input.targetDistanceMin}-${input.targetDistanceMax} slots ahead.`,
      observed_at: new Date().toISOString()
    };
  }

  for (let distance = input.targetDistanceMin; distance <= maxDistance; distance += 1) {
    const slot = input.currentSlot + distance;
    const leader = getLeaderForSlot(input.schedule, slot);

    if (!leader) {
      continue;
    }

    const previousLeader = getLeaderForSlot(input.schedule, slot - 1);
    const nextLeader = getLeaderForSlot(input.schedule, slot + 1);
    const isLeaderTransition = previousLeader !== undefined && previousLeader !== leader;
    const isStableLeaderWindow = nextLeader === leader;

    if (isLeaderTransition || isStableLeaderWindow) {
      return {
        decision: "submit_now",
        strategy: "generic_leader_window",
        current_slot: input.currentSlot,
        ...(currentLeader === undefined ? {} : { current_leader: currentLeader }),
        target_slot: slot,
        target_leader: leader,
        slots_until_target: distance,
        observed_leader_count: 0,
        reason: isLeaderTransition
          ? `Leader transition is ${distance} slots away.`
          : `Stable leader window is ${distance} slots away.`,
        observed_at: new Date().toISOString()
      };
    }
  }

  return {
    decision: "wait",
    strategy: "generic_leader_window",
    current_slot: input.currentSlot,
    ...(currentLeader === undefined ? {} : { current_leader: currentLeader }),
    observed_leader_count: 0,
    reason: `No leader transition or stable window found ${input.targetDistanceMin}-${input.targetDistanceMax} slots ahead.`,
    observed_at: new Date().toISOString()
  };
}

async function loadEligibleObservedLeaders(options: SubmissionTimingOptions): Promise<Map<string, ObservedJitoLeader>> {
  if (!options.observedJitoLeadersEnabled) {
    return new Map();
  }

  const observed = await loadObservedJitoLeaders(options.observedJitoLeadersPath);

  if (!observed) {
    return new Map();
  }

  return new Map(
    observed.leaders
      .filter((leader) => leader.landing_count >= options.observedJitoLeaderMinLandings)
      .map((leader) => [leader.leader, leader])
  );
}

export async function getSubmissionTimingDecision(
  connection: Connection,
  options: SubmissionTimingOptions,
  schedule?: LoadedLeaderSchedule
): Promise<{ decision: TimingDecision; schedule: LoadedLeaderSchedule | null }> {
  validateOptions(options);

  const currentSlot = await connection.getSlot("confirmed");

  if (!options.enabled) {
    return {
      decision: {
        decision: "submit_now",
        strategy: "immediate",
        current_slot: currentSlot,
        observed_leader_count: 0,
        reason: "Submission timing controller is disabled.",
        observed_at: new Date().toISOString()
      },
      schedule: schedule ?? null
    };
  }

  const activeSchedule =
    schedule && !shouldReloadSchedule(schedule, currentSlot, options.lookaheadSlots)
      ? schedule
      : await loadCurrentLeaderSchedule(connection);
  const observedLeaders = await loadEligibleObservedLeaders(options);

  return {
    decision: inspectTimingWindow({
      schedule: activeSchedule,
      currentSlot,
      lookaheadSlots: options.lookaheadSlots,
      targetDistanceMin: options.targetDistanceMin,
      targetDistanceMax: options.targetDistanceMax,
      observedLeaders
    }),
    schedule: activeSchedule
  };
}

export async function waitForSubmissionWindow(
  connection: Connection,
  options: SubmissionTimingOptions
): Promise<{ decision: TimingDecision; waitMs: number }> {
  const startedAtMs = Date.now();
  let schedule: LoadedLeaderSchedule | null = null;

  while (true) {
    const result = await getSubmissionTimingDecision(connection, options, schedule ?? undefined);
    const elapsedMs = Date.now() - startedAtMs;

    schedule = result.schedule;

    if (!options.enabled || result.decision.decision === "submit_now") {
      return {
        decision: result.decision,
        waitMs: elapsedMs
      };
    }

    if (elapsedMs >= options.maxWaitMs) {
      return {
        decision: {
          ...result.decision,
          decision: "skip",
          reason: `No favorable submission window found within ${options.maxWaitMs}ms.`
        },
        waitMs: elapsedMs
      };
    }

    options.onProgress?.(result.decision, elapsedMs);
    await sleep(options.pollIntervalMs ?? defaultPollIntervalMs);
  }
}
