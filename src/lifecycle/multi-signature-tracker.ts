import type { Connection } from "@solana/web3.js";

import { trackExistingSignatureLifecycle } from "./lifecycle-tracker.js";
import type { LifecycleFailure, TransactionLifecycleResult } from "./types.js";

export type SignatureToTrack = {
  role: "workload" | "tip" | "combined" | string;
  signature: string;
};

export type TrackedSignatureLifecycle = {
  role: string;
  signature: string;
  lifecycle: TransactionLifecycleResult;
  observed: boolean;
  finalized: boolean;
  failure?: LifecycleFailure;
};

function wasObserved(lifecycle: TransactionLifecycleResult): boolean {
  return (
    lifecycle.stages.processed.observedAtMs !== undefined ||
    lifecycle.stages.confirmed.observedAtMs !== undefined ||
    lifecycle.stages.finalized.observedAtMs !== undefined
  );
}

export async function trackBundleSignatures(input: {
  connection: Connection;
  signatures: SignatureToTrack[];
  submittedAtMs: number;
  timeoutMs?: number;
}): Promise<TrackedSignatureLifecycle[]> {
  const results: TrackedSignatureLifecycle[] = [];

  for (const item of input.signatures) {
    const lifecycle = await trackExistingSignatureLifecycle(input.connection, {
      signature: item.signature,
      submittedAtMs: input.submittedAtMs,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });

    results.push({
      role: item.role,
      signature: item.signature,
      lifecycle,
      observed: wasObserved(lifecycle),
      finalized: lifecycle.stages.finalized.reached,
      ...(lifecycle.failure === undefined ? {} : { failure: lifecycle.failure })
    });
  }

  return results;
}
