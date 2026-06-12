import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { FailureLogEntry } from "../failures/types.js";
import type { JitoBundleSubmitLog } from "../jito/bundle-sender.js";
import type { AutonomousRecoveryResult } from "../recovery/types.js";
import type { LifecycleLogEntry } from "./types.js";

export const normalTransferLogPath = "data/lifecycle/devnet-normal-transfers.jsonl";
export const failureLogPath = "data/lifecycle/devnet-failures.jsonl";
export const autonomousRecoveryLogPath = "data/lifecycle/autonomous-recovery.jsonl";
export const jitoBundleLogPath = "data/lifecycle/jito-bundles.jsonl";

async function appendJsonLine(path: string, entry: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function appendLifecycleLog(entry: LifecycleLogEntry): Promise<void> {
  await appendJsonLine(normalTransferLogPath, entry);
}

export async function appendFailureLog(entry: FailureLogEntry): Promise<void> {
  await appendJsonLine(failureLogPath, entry);
}

export async function appendAutonomousRecoveryLog(entry: AutonomousRecoveryResult): Promise<void> {
  await appendJsonLine(autonomousRecoveryLogPath, entry);
}

export async function appendJitoBundleLog(entry: JitoBundleSubmitLog): Promise<void> {
  await appendJsonLine(jitoBundleLogPath, entry);
}
