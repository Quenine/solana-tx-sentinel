import type { JitoRpcClient } from "./jito-rpc-client.js";
import type {
  BundleFinalStatusSource,
  BundleStatusObservation,
  BundleStatusResult,
  BundleStatusSource
} from "./types.js";

export type WaitForBundleStatusOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  stopOnFirstInvalid?: boolean;
};

type ParsedStatus = {
  status: string | null;
  landedSlot: number | null;
  failedReason: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conciseRaw(value: unknown): unknown {
  const serialized = JSON.stringify(value);

  if (serialized.length <= 500) {
    return value;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function findBundleStatus(raw: unknown, bundleId: string): Record<string, unknown> | null {
  const root = asRecord(raw);
  const result = asRecord(root?.result) ?? root;
  const value = result?.value;

  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    const record = asRecord(item);

    if (!record) {
      continue;
    }

    if (record.bundle_id === bundleId || record.bundleId === bundleId || value.length === 1) {
      return record;
    }
  }

  return null;
}

function parseStatus(raw: unknown, bundleId: string): ParsedStatus {
  const status = findBundleStatus(raw, bundleId);

  if (!status) {
    return {
      status: null,
      landedSlot: null,
      failedReason: null
    };
  }

  const landedSlot = typeof status.landed_slot === "number" ? status.landed_slot : null;
  const failedReason =
    typeof status.failed_reason === "string"
      ? status.failed_reason
      : typeof status.err === "string"
        ? status.err
        : null;
  const statusValue =
    typeof status.status === "string"
      ? status.status
      : typeof status.confirmation_status === "string"
        ? status.confirmation_status
        : landedSlot !== null
          ? "Landed"
          : null;

  return {
    status: statusValue,
    landedSlot,
    failedReason
  };
}

function observe(source: BundleStatusSource, bundleId: string, raw: unknown): BundleStatusObservation {
  const parsed = parseStatus(raw, bundleId);
  const rawResponse = conciseRaw(raw);

  return {
    observed_at: new Date().toISOString(),
    source,
    status: parsed.status,
    landed_slot: parsed.landedSlot,
    failed_reason: parsed.failedReason,
    ...(rawResponse === undefined ? {} : { raw_response: rawResponse })
  };
}

function isTerminal(observation: BundleStatusObservation): boolean {
  const status = observation.status?.toLowerCase();

  return status === "landed" || status === "failed" || status === "invalid";
}

function isLanded(observation: BundleStatusObservation): boolean {
  return observation.status?.toLowerCase() === "landed";
}

function isFailedOrInvalid(observation: BundleStatusObservation): boolean {
  const status = observation.status?.toLowerCase();

  return status === "failed" || status === "invalid";
}

function latestStatus(observations: BundleStatusObservation[]): BundleStatusObservation | undefined {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (observations[index]?.status) {
      return observations[index];
    }
  }

  return undefined;
}

function resultFrom(input: {
  bundleId: string;
  observedStatuses: BundleStatusObservation[];
  finalObservation?: BundleStatusObservation;
  finalStatusSource: BundleFinalStatusSource;
  timedOut: boolean;
}): BundleStatusResult {
  return {
    bundle_id: input.bundleId,
    observed_statuses: input.observedStatuses,
    ...(input.finalObservation?.status ? { final_bundle_status: input.finalObservation.status } : {}),
    final_status_source: input.finalStatusSource,
    ...(input.finalObservation?.landed_slot !== null && input.finalObservation?.landed_slot !== undefined
      ? { landed_slot: input.finalObservation.landed_slot }
      : {}),
    ...(input.finalObservation?.failed_reason ? { failed_reason: input.finalObservation.failed_reason } : {}),
    timed_out: input.timedOut
  };
}

export async function waitForBundleStatus(
  client: JitoRpcClient,
  bundleId: string,
  options: WaitForBundleStatusOptions = {}
): Promise<BundleStatusResult> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;
  const observedStatuses: BundleStatusObservation[] = [];
  let finalObservation: BundleStatusObservation | undefined;
  let finalStatusSource: BundleFinalStatusSource | undefined;

  while (Date.now() <= deadline) {
    const inflight = await client.getInflightBundleStatuses([bundleId]);
    const inflightObservation = observe("inflight", bundleId, inflight);
    observedStatuses.push(inflightObservation);

    if (isLanded(inflightObservation)) {
      finalObservation = inflightObservation;
      finalStatusSource = "inflight";
      break;
    }

    const finalStatus = await client.getBundleStatuses([bundleId]);
    const finalObservationCandidate = observe("final", bundleId, finalStatus);
    observedStatuses.push(finalObservationCandidate);

    if (isTerminal(finalObservationCandidate)) {
      finalObservation = finalObservationCandidate;
      finalStatusSource = "final";
      break;
    }

    await sleep(pollIntervalMs);
  }

  if (!finalObservation) {
    const latestObservation = latestStatus(observedStatuses);

    if (latestObservation?.status?.toLowerCase() === "invalid") {
      finalObservation = latestObservation;
      finalStatusSource = "timeout";
    }
  }

  return resultFrom({
    bundleId,
    observedStatuses,
    ...(finalObservation === undefined ? {} : { finalObservation }),
    finalStatusSource: finalStatusSource ?? "timeout",
    timedOut: finalStatusSource === "timeout" || finalObservation === undefined
  });
}
