import { readFile } from "node:fs/promises";

import { appendAgentDecision, toDecisionLogEntry } from "../agent/decision-log.js";
import { localFailureDecisionAgent } from "../agent/local-agent.js";
import type { FailureDecisionInput, FailureDecisionLogEntry } from "../agent/types.js";
import type { ControlledJitoBundleFailureLog } from "../evidence/failure-evidence.js";
import type { FailureLogEntry } from "../failures/types.js";
import { failureLogPath } from "../lifecycle/log-writer.js";

const jitoBundleFailureLogPath = "data/lifecycle/jito-bundle-failures.jsonl";

type FailureSource = {
  sourceFile: NonNullable<FailureDecisionLogEntry["source_file"]>;
  createdAt: string | null;
  input: FailureDecisionInput;
};

async function readJsonLines<T>(path: string): Promise<T[]> {
  try {
    const file = await readFile(path, "utf8");

    return file
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function toJitoDecisionSource(entry: ControlledJitoBundleFailureLog): FailureSource {
  const input: FailureDecisionInput = {
    run_id: entry.run_id,
    network: entry.network,
    mode: entry.mode,
    failure_type: entry.failure.type,
    failure_message: entry.failure.message,
    original_blockhash: entry.blockhash,
    original_last_valid_block_height: entry.last_valid_block_height,
    ...(entry.current_block_height_at_submit === undefined
      ? {}
      : { current_block_height_at_send: entry.current_block_height_at_submit }),
    ...(entry.current_slot_at_submit === undefined ? {} : { current_slot: entry.current_slot_at_submit }),
    previous_tip_lamports: entry.tip_lamports,
    recent_tip_lamports: entry.tip_lamports,
    leader_window_status: "unknown"
  };

  return {
    sourceFile: "jito-bundle-failures",
    createdAt: entry.created_at,
    input
  };
}

function toDevnetDecisionSource(entry: FailureLogEntry): FailureSource {
  return {
    sourceFile: "devnet-failures",
    createdAt: entry.created_at,
    input: {
      run_id: entry.run_id,
      network: entry.network,
      mode: entry.mode,
      failure_type: entry.failure.type,
      failure_message: entry.failure.message,
      original_blockhash: entry.original_blockhash,
      original_last_valid_block_height: entry.original_last_valid_block_height,
      current_block_height_at_send: entry.current_block_height_at_send
    }
  };
}

function newest(entries: FailureSource[]): FailureSource | null {
  const [entry] = [...entries].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));

  return entry ?? null;
}

async function readLatestFailure(): Promise<FailureSource> {
  const jitoFailures = (await readJsonLines<ControlledJitoBundleFailureLog>(jitoBundleFailureLogPath)).map(toJitoDecisionSource);
  const devnetFailures = (await readJsonLines<FailureLogEntry>(failureLogPath)).map(toDevnetDecisionSource);
  const preferredJitoExpired = newest(jitoFailures.filter((entry) => entry.input.failure_type === "expired_blockhash"));

  if (preferredJitoExpired) {
    return preferredJitoExpired;
  }

  const preferredDevnetExpired = newest(devnetFailures.filter((entry) => entry.input.failure_type === "expired_blockhash"));

  if (preferredDevnetExpired) {
    return preferredDevnetExpired;
  }

  const fallback = newest([...jitoFailures, ...devnetFailures]);

  if (!fallback) {
    throw new Error(`No failure entries found in ${jitoBundleFailureLogPath} or ${failureLogPath}`);
  }

  return fallback;
}

async function main(): Promise<void> {
  const failure = await readLatestFailure();
  const decision = localFailureDecisionAgent.decide(failure.input);
  const entry = toDecisionLogEntry(failure.input, decision, {
    sourceFile: failure.sourceFile
  });

  await appendAgentDecision(entry);
  console.log(JSON.stringify(entry, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown agent diagnosis error";
  console.error(message);
  process.exitCode = 1;
});
