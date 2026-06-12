import type { Commitment, Connection, TransactionError } from "@solana/web3.js";

import { systemClock, type Clock } from "./clock.js";
import type {
  LifecycleFailure,
  LifecycleLatencies,
  LifecycleStage,
  SendAndTrackTransactionOptions,
  StageObservation,
  TrackLifecycleOptions,
  TransactionLifecycleResult
} from "./types.js";

const stages: LifecycleStage[] = ["processed", "confirmed", "finalized"];
const defaultTimeoutMs = 60_000;

const stageRank: Record<LifecycleStage, number> = {
  processed: 0,
  confirmed: 1,
  finalized: 2
};

type SignatureStatusObservation = {
  slot: number;
  error: TransactionError | null;
  confirmationStatus: LifecycleStage;
};

function emptyStages(): Record<LifecycleStage, StageObservation> {
  return {
    processed: { reached: false },
    confirmed: { reached: false },
    finalized: { reached: false }
  };
}

function hasReachedStage(status: LifecycleStage, target: LifecycleStage): boolean {
  return stageRank[status] >= stageRank[target];
}

async function getCurrentSignatureStatus(
  connection: Connection,
  signature: string
): Promise<SignatureStatusObservation | null> {
  const response = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true
  });
  const status = response.value[0];

  if (!status?.confirmationStatus) {
    return null;
  }

  return {
    slot: status.slot,
    error: status.err,
    confirmationStatus: status.confirmationStatus
  };
}

function waitForSignatureSubscription(
  connection: Connection,
  signature: string,
  commitment: LifecycleStage,
  timeoutMs: number,
  clock: Clock
): Promise<StageObservation> {
  return new Promise((resolve, reject) => {
    let subscriptionId: number | undefined;

    const timer = setTimeout(() => {
      if (subscriptionId !== undefined) {
        void connection.removeSignatureListener(subscriptionId);
      }

      reject(new Error(`Timed out waiting for ${commitment} commitment`));
    }, timeoutMs);

    subscriptionId = connection.onSignature(
      signature,
      (notification, context) => {
        clearTimeout(timer);

        resolve({
          reached: notification.err === null,
          observedAtMs: clock.nowMs(),
          slot: context.slot,
          error: notification.err
        });
      },
      commitment
    );
  });
}

async function waitForStage(
  connection: Connection,
  signature: string,
  stage: LifecycleStage,
  timeoutMs: number,
  clock: Clock
): Promise<StageObservation> {
  const currentStatus = await getCurrentSignatureStatus(connection, signature);

  if (currentStatus && hasReachedStage(currentStatus.confirmationStatus, stage)) {
    return {
      reached: currentStatus.error === null,
      observedAtMs: clock.nowMs(),
      slot: currentStatus.slot,
      error: currentStatus.error
    };
  }

  return waitForSignatureSubscription(connection, signature, stage, timeoutMs, clock);
}

function calculateLatencies(
  submittedAtMs: number,
  observations: Record<LifecycleStage, StageObservation>
): LifecycleLatencies {
  const processedAt = observations.processed.observedAtMs;
  const confirmedAt = observations.confirmed.observedAtMs;
  const finalizedAt = observations.finalized.observedAtMs;
  const latencies: LifecycleLatencies = {};

  if (processedAt !== undefined) {
    latencies.submittedToProcessedMs = processedAt - submittedAtMs;
  }

  if (processedAt !== undefined && confirmedAt !== undefined) {
    latencies.processedToConfirmedMs = confirmedAt - processedAt;
  }

  if (confirmedAt !== undefined && finalizedAt !== undefined) {
    latencies.confirmedToFinalizedMs = finalizedAt - confirmedAt;
  }

  if (finalizedAt !== undefined) {
    latencies.submittedToFinalizedMs = finalizedAt - submittedAtMs;
  }

  return latencies;
}

export async function trackExistingSignatureLifecycle(
  connection: Connection,
  options: TrackLifecycleOptions,
  clock: Clock = systemClock
): Promise<TransactionLifecycleResult> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const deadlineMs = clock.nowMs() + timeoutMs;
  const observations = emptyStages();
  let failure: LifecycleFailure | undefined;

  for (const stage of stages) {
    const remainingMs = deadlineMs - clock.nowMs();

    if (remainingMs <= 0) {
      failure = {
        stage,
        message: `Timed out waiting for ${stage} commitment`
      };
      break;
    }

    try {
      observations[stage] = await waitForStage(connection, options.signature, stage, remainingMs, clock);

      if (!observations[stage].reached) {
        failure = {
          stage,
          message: `Transaction failed at ${stage} commitment`
        };
        break;
      }
    } catch (error) {
      failure = {
        stage,
        message: error instanceof Error ? error.message : `Failed while waiting for ${stage} commitment`
      };
      break;
    }
  }

  return {
    signature: options.signature,
    submittedAtMs: options.submittedAtMs,
    stages: observations,
    latencies: calculateLatencies(options.submittedAtMs, observations),
    ...(failure ? { failure } : {})
  };
}

export async function sendAndTrackTransaction(
  connection: Connection,
  options: SendAndTrackTransactionOptions,
  clock: Clock = systemClock
): Promise<TransactionLifecycleResult> {
  const signature = await connection.sendRawTransaction(options.serializedTransaction);
  const submittedAtMs = clock.nowMs();

  return trackExistingSignatureLifecycle(
    connection,
    {
      signature,
      submittedAtMs,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
    },
    clock
  );
}
