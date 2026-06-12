import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { FailureDecisionInput, FailureDecisionLogEntry } from "./types.js";
import type { FailureDecision } from "./types.js";

export const agentDecisionLogPath = "data/lifecycle/agent-decisions.jsonl";

export function toDecisionLogEntry(
  input: FailureDecisionInput,
  decision: FailureDecision,
  options: { sourceFile?: FailureDecisionLogEntry["source_file"] } = {}
): FailureDecisionLogEntry {
  return {
    run_id: input.run_id,
    network: input.network,
    mode: input.mode,
    failure_type: input.failure_type,
    ...(options.sourceFile === undefined ? {} : { source_file: options.sourceFile }),
    ...decision
  };
}

export async function appendAgentDecision(entry: FailureDecisionLogEntry): Promise<void> {
  await mkdir(dirname(agentDecisionLogPath), { recursive: true });
  await appendFile(agentDecisionLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}
